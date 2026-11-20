import { describe, expect, it, vi } from 'vitest';
import { keccak256, type Hex } from 'viem';
import { MemoryLimiter } from '../src/ratelimit.js';
import { handleSponsor, handleSponsorStatus, poolLinkDigest, pqMessage, sponsorRules, type SponsorChain, type SponsorDeps, type SponsorSend } from '../src/sponsor.js';
import { V4_INSTANCES } from '../src/v4.js';

const ME = '0x1111111111111111111111111111111111111111' as Hex;
const PAYTO = '0x2222222222222222222222222222222222222222' as Hex;
const POCKET = '0x3333333333333333333333333333333333333333' as Hex;
const LINKPK = ('0x' + 'ab'.repeat(32)) as Hex;
const SIG = ('0x' + 'cd'.repeat(16)) as Hex;
const NOW = Date.UTC(2026, 10, 20, 12, 0, 0);
const QOR = 10n ** 18n;

function fakeChain(o: Partial<Record<string, unknown>> = {}) {
  const sends: SponsorSend[] = (o.sends as SponsorSend[]) ?? [];
  const state = {
    registered: false, balance: 0n, sponsored: false, claimed: false, pocketCode: false, pocketBal: QOR / 5n, sponsorBal: 3n * QOR, sigOk: true,
    pool: { host: PAYTO, perSlot: QOR / 50n, slots: 3, taken: 0, expiry: BigInt(NOW / 1000 + 3600), closed: false, linkKeyHash: keccak256(LINKPK) } as unknown,
    ...o,
  } as Record<string, unknown>;
  const send = vi.fn(async (to: Hex, _amt: bigint, memo: string) => { sends.unshift({ to, memo, time: NOW }); return { hash: 'ABCDEF' }; });
  const pqVerify = vi.fn(async (_pk: Hex, _sig: Hex, msg: Uint8Array) => (state.sigOk as boolean) && msg.length === 66);
  const c: SponsorChain = {
    sponsorAddress: '0x9999999999999999999999999999999999999999',
    balance: async (a) => (a.toLowerCase() === POCKET ? (state.pocketBal as bigint) : (state.balance as bigint)),
    hasCode: async () => state.pocketCode as boolean,
    keyRegistered: async () => state.registered as boolean,
    getPool: async () => state.pool as never,
    poolClaimed: async () => state.claimed as boolean,
    pqVerify,
    predictPocket: async () => POCKET,
    recentSends: async () => sends,
    everSponsored: async (a) => (state.sponsored as boolean) || sends.some((s) => s.to.toLowerCase() === a.toLowerCase()),
    sponsorBalanceWei: async () => state.sponsorBal as bigint,
    now: () => NOW,
    send,
  };
  return { c, send, pqVerify, sends };
}
const deps = (chain: SponsorChain | null, env: Record<string, string> = {}): SponsorDeps => ({
  rules: sponsorRules({ SPONSOR_ENABLED: '1', SPONSOR_SECP_KEY: 'x', SPONSOR_PQC_SECRET: 'y', SPONSOR_IP_PER_MINUTE: '100', SPONSOR_IP_PER_DAY: '100', ...env }),
  limiter: new MemoryLimiter(() => NOW), chain,
});
const poolReq = (o: Record<string, unknown> = {}) => ({ kind: 'pool', env: 'prod', poolId: '7', recipient: ME, payTo: PAYTO, linkPk: LINKPK, linkSig: SIG, ...o });
const senderReq = (o: Record<string, unknown> = {}) => ({ kind: 'sender', env: 'prod', owner: ME, guardians: [], threshold: 0, dailyLimit: '5000000000000000000', userSalt: '0x' + '00'.repeat(32), ...o });
const errName = (r: { body: Record<string, unknown> }) => (r.body.error as { name: string } | undefined)?.name;

describe('sponsor rules', () => {
  it('defaults: 0.06 QOR, 20 per day, 3 per IP per day, kill switch off unless SPONSOR_ENABLED=1', () => {
    const r = sponsorRules({});
    expect(r.amountUqor).toBe(60_000n); expect(r.dailyCap).toBe(20); expect(r.ipPerDay).toBe(3); expect(r.enabled).toBe(false);
    expect(sponsorRules({ SPONSOR_ENABLED: 'true' }).enabled).toBe(false);
  });
  it('pqMessage is the 66 ASCII bytes of the lowercase digest; the link digest is bound to the recipient', () => {
    const d = poolLinkDigest(V4_INSTANCES.prod.pool as Hex, 7n, ME, PAYTO);
    expect(pqMessage(d).length).toBe(66);
    expect(poolLinkDigest(V4_INSTANCES.prod.pool as Hex, 7n, PAYTO, PAYTO)).not.toBe(d);
  });
});

describe('POST /api/sponsor', () => {
  it('kill switch: off sends nothing', async () => {
    const { c, send } = fakeChain();
    const r = await handleSponsor(poolReq(), '1.1.1.1', deps(c, { SPONSOR_ENABLED: '0' }));
    expect(r.status).toBe(503); expect(errName(r)).toBe('SponsorOff'); expect(r.body.fallback).toBe('faucet'); expect(send).not.toHaveBeenCalled();
  });
  it('not configured', async () => {
    expect((await handleSponsor(poolReq(), '1.1.1.1', deps(null))).status).toBe(503);
  });
  it('pool: a valid link signature for an open pool sponsors exactly 0.06 QOR, once', async () => {
    const { c, send, pqVerify } = fakeChain();
    const r = await handleSponsor(poolReq(), '1.1.1.1', deps(c));
    expect(r.status).toBe(200); expect(r.body.sponsored).toBe(true); expect(r.body.amountWei).toBe('60000000000000000');
    expect(send).toHaveBeenCalledWith(ME.toLowerCase(), 60_000n, 'pd-sponsor pool:prod:7');
    const msg = pqVerify.mock.calls[0][2];
    expect(new TextDecoder().decode(msg)).toBe(poolLinkDigest(V4_INSTANCES.prod.pool as Hex, 7n, ME.toLowerCase() as Hex, PAYTO).toLowerCase());
    const again = await handleSponsor(poolReq(), '1.1.1.1', deps(c));
    expect(errName(again)).toBe('AlreadySponsored'); expect(send).toHaveBeenCalledTimes(1);
  });
  it.each([
    ['registered key', { registered: true }, 'AlreadyRegistered'],
    ['account already holds QOR', { balance: QOR / 100n }, 'NotNew'],
    ['sponsored before (on chain)', { sponsored: true }, 'AlreadySponsored'],
    ['pool missing', { pool: null }, 'PoolNotFound'],
    ['already took a slot', { claimed: true }, 'AlreadyClaimed'],
    ['bad link signature', { sigOk: false }, 'BadProof'],
  ])('pool refuses: %s', async (_n, o, name) => {
    const { c, send } = fakeChain(o);
    const r = await handleSponsor(poolReq(), '1.1.1.1', deps(c));
    expect(errName(r)).toBe(name); expect(send).not.toHaveBeenCalled();
  });
  it.each([
    ['closed', { closed: true }], ['full', { taken: 3 }], ['expired', { expiry: BigInt(NOW / 1000 - 1) }],
  ])('pool refuses a %s pool', async (_n, p) => {
    const base = await fakeChain().c.getPool('prod', 7n);
    const { c, send } = fakeChain({ pool: { ...base!, ...p } });
    const r = await handleSponsor(poolReq(), '1.1.1.1', deps(c));
    expect(errName(r)).toBe('PoolNotOpen'); expect(send).not.toHaveBeenCalled();
  });
  it('pool refuses a link key that is not the pool\'s', async () => {
    const { c, send } = fakeChain();
    const r = await handleSponsor(poolReq({ linkPk: '0x' + 'ee'.repeat(32) }), '1.1.1.1', deps(c));
    expect(errName(r)).toBe('BadProof'); expect(send).not.toHaveBeenCalled();
  });
  it('per-link cap: min(slots, poolCap) sponsorships per pool per UTC day', async () => {
    const sends = [1, 2, 3].map((i) => ({ to: `qor${i}`, memo: 'pd-sponsor pool:prod:7', time: NOW - 1000 }));
    const { c, send } = fakeChain({ sends });
    const r = await handleSponsor(poolReq(), '1.1.1.1', deps(c));
    expect(errName(r)).toBe('LinkCapReached'); expect(send).not.toHaveBeenCalled();
    const { c: y } = fakeChain({ sends: sends.map((s) => ({ ...s, time: NOW - 86_400_000 })) });
    expect((await handleSponsor(poolReq(), '1.1.1.1', deps(y))).status).toBe(200);
  });
  it('global daily cap counts the sponsor\'s own sends since 00:00 UTC', async () => {
    const sends = Array.from({ length: 2 }, (_, i) => ({ to: `q${i}`, memo: 'pd-sponsor sender:prod', time: NOW - 60_000 }));
    const { c, send } = fakeChain({ sends });
    const r = await handleSponsor(poolReq(), '1.1.1.1', deps(c, { SPONSOR_DAILY_CAP: '2' }));
    expect(errName(r)).toBe('DailyCapReached'); expect(r.status).toBe(429); expect(send).not.toHaveBeenCalled();
  });
  it('per-IP caps (minute and day)', async () => {
    const { c } = fakeChain();
    const d = deps(c, { SPONSOR_IP_PER_MINUTE: '1', SPONSOR_IP_PER_DAY: '5' });
    await handleSponsor({ kind: 'nope' }, '9.9.9.9', d);
    const r = await handleSponsor(poolReq(), '9.9.9.9', d);
    expect(r.status).toBe(429); expect(errName(r)).toBe('RateLimited');
    expect((await handleSponsor(poolReq(), '8.8.8.8', d)).status).toBe(200);
    const d2 = deps(fakeChain().c, { SPONSOR_IP_PER_MINUTE: '100', SPONSOR_IP_PER_DAY: '2' });
    await handleSponsor({ kind: 'nope' }, '7.7.7.7', d2); await handleSponsor({ kind: 'nope' }, '7.7.7.7', d2);
    expect(errName(await handleSponsor(poolReq(), '7.7.7.7', d2))).toBe('RateLimited');
  });
  it('sponsor wallet low', async () => {
    const { c, send } = fakeChain({ sponsorBal: 10n ** 16n });
    const r = await handleSponsor(poolReq(), '1.1.1.1', deps(c));
    expect(errName(r)).toBe('SponsorLow'); expect(send).not.toHaveBeenCalled();
  });
  it('sender: a funded, not-yet-deployed Pocket covers the key setup', async () => {
    const { c, send } = fakeChain();
    const r = await handleSponsor(senderReq(), '1.1.1.1', deps(c));
    expect(r.status).toBe(200); expect(send).toHaveBeenCalledWith(ME.toLowerCase(), 60_000n, 'pd-sponsor sender:prod');
  });
  it('sender refuses an unfunded or already-used Pocket', async () => {
    const a = fakeChain({ pocketBal: QOR / 20n });
    const r1 = await handleSponsor(senderReq(), '1.1.1.1', deps(a.c));
    expect(errName(r1)).toBe('PocketNotFunded'); expect(r1.body.needWei).toBe('100000000000000000');
    const b = fakeChain({ pocketCode: true });
    expect(errName(await handleSponsor(senderReq(), '1.1.1.1', deps(b.c)))).toBe('NotNew');
    expect(a.send).not.toHaveBeenCalled(); expect(b.send).not.toHaveBeenCalled();
  });
  it('validation errors', async () => {
    const { c } = fakeChain();
    expect((await handleSponsor(poolReq({ recipient: 'nope' }), '1.1.1.1', deps(c))).status).toBe(400);
    expect((await handleSponsor('{bad', '1.1.1.1', deps(c))).status).toBe(400);
    expect((await handleSponsor(poolReq({ env: 'mainnet' }), '1.1.1.1', deps(c))).status).toBe(400);
  });
  it('two parallel requests for one account: only one send', async () => {
    const { c, send } = fakeChain();
    const d = deps(c);
    const [a, b] = await Promise.all([handleSponsor(poolReq(), '1.1.1.1', d), handleSponsor(poolReq(), '1.1.1.2', d)]);
    expect([a.status, b.status].sort()).toEqual([200, 409]); expect(send).toHaveBeenCalledTimes(1);
  });
  it('a failed send answers 502 with the faucet fallback', async () => {
    const { c } = fakeChain();
    c.send = async () => { throw new Error('boom'); };
    const r = await handleSponsor(poolReq(), '1.1.1.1', deps(c));
    expect(r.status).toBe(502); expect(r.body.fallback).toBe('faucet');
  });
});

describe('GET /api/sponsor', () => {
  it('reports off, on with what is left today, and cap reached', async () => {
    expect((await handleSponsorStatus(deps(null, { SPONSOR_ENABLED: '0' }))).body.enabled).toBe(false);
    const { c } = fakeChain({ sends: [{ to: 'q', memo: 'pd-sponsor sender:prod', time: NOW - 10 }] });
    const on = await handleSponsorStatus(deps(c, { SPONSOR_DAILY_CAP: '3' }));
    expect(on.body.enabled).toBe(true); expect(on.body.remainingToday).toBe(2); expect(on.body.amountWei).toBe('60000000000000000');
    const full = await handleSponsorStatus(deps(c, { SPONSOR_DAILY_CAP: '1' }));
    expect(full.body.enabled).toBe(false); expect(full.body.reason).toBe('daily cap reached');
  });
});

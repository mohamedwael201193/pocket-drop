import { describe, expect, it, vi } from 'vitest';
import { decodeFunctionData, type Hex } from 'viem';
import { routerAbi } from '../src/lib/abi4';
import { ApiError } from '../src/lib/api';
import { relayerUnavailable, routeWithFallback, routerCalldata, selfRelayNeedWei, selfRelayPreferred, setSelfRelayPreferred, windowReusable, SELF_WINDOW, type RouteBody } from '../src/lib/selfRelayCore';
import evidence from '../evidence/v4/e2e/self-relay-v5.json';
import v4 from '../src/data/v4.json';

const ROUTER = '0x13B8E379E50DA657b943781D2816FC17473AE376';
const T = '0x00000000000000000000000000000000000000aa';
const body = (x: Partial<RouteBody> = {}): RouteBody => ({ env: 'prod', target: T, data: '0x1234', ...x });
const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }; };

describe('self-relay calldata', () => {
  it('a known target goes through relay(target, data)', () => {
    const d = decodeFunctionData({ abi: routerAbi, data: routerCalldata(body()) });
    expect(d.functionName).toBe('relay');
    expect((d.args?.[0] as string).toLowerCase()).toBe(T);
    expect(d.args?.[1]).toBe('0x1234');
  });
  it('an undeployed Pocket goes through deployAndRelay(config, data)', () => {
    const owner = '0x00000000000000000000000000000000000000bb';
    const d = decodeFunctionData({ abi: routerAbi, data: routerCalldata(body({ target: undefined, pocket: { owner, guardians: [], threshold: 0, dailyLimit: '1000', userSalt: ('0x' + '11'.repeat(32)) as Hex } })) });
    expect(d.functionName).toBe('deployAndRelay');
    expect((d.args?.[0] as string).toLowerCase()).toBe(owner);
    expect(d.args?.[3]).toBe(1000n);
    expect(d.args?.[5]).toBe('0x1234');
  });
  it('no target and no config is refused', () => expect(() => routerCalldata(body({ target: undefined }))).toThrow());
});

describe('self-relay window and fees', () => {
  it('reuses only a live, router-only window with a tx left', () => {
    expect(windowReusable({ live: true, allowedTargets: [ROUTER.toLowerCase()], remainingTxs: 1n }, ROUTER)).toBe(true);
    expect(windowReusable({ live: true, allowedTargets: [], remainingTxs: 3n }, ROUTER)).toBe(false); // unscoped: never reused
    expect(windowReusable({ live: true, allowedTargets: [ROUTER, T], remainingTxs: 3n }, ROUTER)).toBe(false);
    expect(windowReusable({ live: true, allowedTargets: [ROUTER], remainingTxs: 0n }, ROUTER)).toBe(false);
    expect(windowReusable({ live: false, allowedTargets: [ROUTER], remainingTxs: 3n }, ROUTER)).toBe(false);
    expect(windowReusable(null, ROUTER)).toBe(false);
  });
  it('the window is short and small', () => { expect(SELF_WINDOW.blocks).toBeLessThanOrEqual(600); expect(SELF_WINDOW.maxTxs).toBeLessThanOrEqual(3); });
  it('need = native fees still due + one tx at the gas cap', () => {
    const gp = 100n * 10n ** 9n;
    expect(selfRelayNeedWei({ registered: true, windowReady: true, gasPriceWei: gp })).toBe(SELF_WINDOW.txGasCap * gp);
    expect(selfRelayNeedWei({ registered: false, windowReady: false, gasPriceWei: gp })).toBe(160_000n * 10n ** 12n + SELF_WINDOW.txGasCap * gp);
  });
});

describe('relayer first, then the offer', () => {
  it('classifies relayer outages, not refusals', () => {
    expect(relayerUnavailable(new TypeError('Failed to fetch'))).toBe(true);
    expect(relayerUnavailable(Object.assign(new Error('t'), { name: 'TimeoutError' }))).toBe(true);
    expect(relayerUnavailable(new ApiError('RelayerWindowUnavailable', 'x', 503))).toBe(true);
    expect(relayerUnavailable(new ApiError('HttpError', 'x', 502))).toBe(true);
    expect(relayerUnavailable(new ApiError('BadSignature', 'x', 422))).toBe(false);
    expect(relayerUnavailable(new ApiError('BadRequest', 'x', 400))).toBe(false);
    expect(relayerUnavailable(null)).toBe(false);
  });
  it('relayer ok: self-relay never runs', async () => {
    const self = vi.fn();
    expect(await routeWithFallback(body(), async () => 'relayer', self, { preferred: false, offer: async () => true })).toBe('relayer');
    expect(self).not.toHaveBeenCalled();
  });
  it('relayer down + user accepts: the same body goes to self-relay', async () => {
    const self = vi.fn(async (b: RouteBody) => `self:${b.target}`);
    const offer = vi.fn(async () => true);
    expect(await routeWithFallback(body(), async () => { throw new TypeError('Failed to fetch'); }, self, { preferred: false, offer })).toBe(`self:${T}`);
    expect(offer).toHaveBeenCalledOnce();
  });
  it('relayer down + user declines: the relayer error is thrown', async () => {
    await expect(routeWithFallback(body(), async () => { throw new ApiError('RelayerWindowUnavailable', 'paused', 503); }, vi.fn(), { preferred: false, offer: async () => false })).rejects.toThrow('paused');
  });
  it('a refused call (422) is never retried by self-relay', async () => {
    const offer = vi.fn(async () => true);
    await expect(routeWithFallback(body(), async () => { throw new ApiError('BadSignature', 'no', 422); }, vi.fn(), { preferred: false, offer })).rejects.toThrow('no');
    expect(offer).not.toHaveBeenCalled();
  });
  it('the Advanced setting skips the relayer', async () => {
    const relayer = vi.fn();
    expect(await routeWithFallback(body(), relayer, async () => 'self', { preferred: true })).toBe('self');
    expect(relayer).not.toHaveBeenCalled();
    const s = mem();
    expect(selfRelayPreferred(s)).toBe(false);
    setSelfRelayPreferred(true, s); expect(selfRelayPreferred(s)).toBe(true);
    setSelfRelayPreferred(false, s); expect(selfRelayPreferred(s)).toBe(false);
  });
});

describe('recorded live self-relay run (TEAM-RUN, v5 prod)', () => {
  const rows = evidence.rows as { step: string; lane?: string; hash?: string; status?: string; code?: number; submitter?: string; to?: string; window?: { allowedTargets: string[]; maxTxs: number; blocks: number; expiryHeight: string } }[];
  it('targets the deployed v5 prod router', () => expect(evidence.router.toLowerCase()).toBe(v4.instances.prodV5.router.address.toLowerCase()));
  it('both windows are router-only, short and hybrid-signed, and closed afterwards', () => {
    const opens = rows.filter((r) => r.window);
    expect(opens).toHaveLength(2);
    for (const o of opens) { expect(o.code).toBe(0); expect(o.window!.allowedTargets.map((a) => a.toLowerCase())).toEqual([ROUTER.toLowerCase()]); expect(o.window!.maxTxs).toBe(3); expect(o.window!.blocks).toBeLessThanOrEqual(600); }
    expect(rows.filter((r) => /closes its window/.test(r.step) && r.code === 0)).toHaveLength(2);
  });
  it('the claim and the spend were submitted by the recipient itself, to the router', () => {
    const mine = rows.filter((r) => r.lane === 'evm' && r.submitter?.startsWith('recipient'));
    expect(mine.map((r) => r.step.slice(0, 2))).toEqual(['U2', 'U3']);
    for (const r of mine) { expect(r.status).toBe('success'); expect(r.to?.toLowerCase()).toBe(ROUTER.toLowerCase()); expect(r.submitter).toContain(evidence.accounts.recipient); }
  });
});

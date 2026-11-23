import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES, fmt, parseRefills, planRefill, refillFunder, refillStatus, sumLast24h, REFILL_FUNDER_DEFAULT } from '../src/refill.js';

const Q = (x: number) => BigInt(Math.round(x * 1e6));
const RELAYER = 'qor17mn0ktfnhmesgd5zvk8zk60n5tuxzmxdc8ymnl';
const FUNDER = REFILL_FUNDER_DEFAULT;
const tx = (h: number, time: string, amt: number, memo = 'pd refill low 2.5', code = 0, to = RELAYER) => ({
  txhash: `ab${h}`, height: String(h), code, timestamp: time,
  tx: { body: { memo, messages: [{ '@type': '/cosmos.bank.v1beta1.MsgSend', from_address: FUNDER, to_address: to, amount: [{ denom: 'uqor', amount: String(Q(amt)) }] }] } },
});

describe('planRefill', () => {
  it('skips a healthy relayer', () => {
    expect(planRefill({ relayerUqor: Q(3), funderUqor: Q(10), sentLast24hUqor: 0n })).toMatchObject({ action: 'skip', reason: 'healthy' });
  });
  it('tops up to the target, capped per send', () => {
    expect(planRefill({ relayerUqor: Q(2.9), funderUqor: Q(10), sentLast24hUqor: 0n })).toMatchObject({ action: 'send', amountUqor: Q(1.1) });
    expect(planRefill({ relayerUqor: Q(0.2), funderUqor: Q(10), sentLast24hUqor: 0n })).toMatchObject({ action: 'send', amountUqor: DEFAULT_RULES.maxPerSendUqor });
  });
  it('never exceeds the rolling 24 h cap', () => {
    expect(planRefill({ relayerUqor: Q(0.2), funderUqor: Q(10), sentLast24hUqor: Q(2.5) })).toMatchObject({ action: 'send', amountUqor: Q(0.5) });
    expect(planRefill({ relayerUqor: Q(0.2), funderUqor: Q(10), sentLast24hUqor: Q(3) })).toMatchObject({ action: 'skip', reason: 'daily-cap' });
    expect(planRefill({ relayerUqor: Q(0.2), funderUqor: Q(10), sentLast24hUqor: Q(9) })).toMatchObject({ action: 'skip', reason: 'daily-cap' });
  });
  it('keeps the refill wallet fee reserve', () => {
    expect(planRefill({ relayerUqor: Q(1), funderUqor: Q(0.3), sentLast24hUqor: 0n })).toMatchObject({ action: 'skip', reason: 'funder-empty' });
    expect(planRefill({ relayerUqor: Q(1), funderUqor: Q(0.8), sentLast24hUqor: 0n })).toMatchObject({ action: 'send', amountUqor: Q(0.5) });
  });
  it('a forced top-up is still capped', () => {
    expect(planRefill({ relayerUqor: Q(5), funderUqor: Q(10), sentLast24hUqor: 0n, force: Q(9) })).toMatchObject({ action: 'send', amountUqor: DEFAULT_RULES.maxPerSendUqor });
    expect(planRefill({ relayerUqor: Q(5), funderUqor: Q(10), sentLast24hUqor: Q(3), force: Q(1) })).toMatchObject({ action: 'skip', reason: 'daily-cap' });
  });
  it('refuses dust', () => {
    expect(planRefill({ relayerUqor: Q(3) - 1n, funderUqor: Q(10), sentLast24hUqor: 0n }, { ...DEFAULT_RULES, targetUqor: Q(3) })).toMatchObject({ action: 'skip', reason: 'too-small' });
  });
});

describe('refill reads', () => {
  const now = Date.parse('2026-11-23T18:00:00Z');
  const rows = parseRefills([
    tx(10, '2026-11-23T17:00:00Z', 1),
    tx(9, '2026-11-23T10:00:00Z', 0.5, 'pd refill low 2.9', 5), // failed: not counted
    tx(8, '2026-11-22T12:00:00Z', 1.5), // older than 24 h
    tx(7, '2026-11-23T16:00:00Z', 2, 'hello'), // not a refill memo
    tx(6, '2026-11-23T16:30:00Z', 2, 'pd refill low 1', 0, 'qor1someoneelse0000000000000000000000000'), // not to the relayer
  ] as never, RELAYER);
  it('keeps only refill-memo sends to the relayer', () => {
    expect(rows.map((r) => r.height)).toEqual([10, 9, 8]);
  });
  it('sums successful sends of the last 24 h', () => {
    expect(fmt(sumLast24h(rows, now))).toBe('1');
  });
  it('health block shows the last refill and the 24 h total', async () => {
    const f = (async (u: string) => ({ ok: true, json: async () => (u.includes('/balances/') ? { balances: [{ denom: 'uqor', amount: '2700000' }] } : { tx_responses: [tx(10, '2026-11-23T17:00:00Z', 1)] }) })) as unknown as typeof fetch;
    const s = await refillStatus('https://api', FUNDER, RELAYER, now, f);
    expect(s).toMatchObject({ configured: true, funderBalance: '2.7', sentLast24h: '1', lastRefill: { tx: 'AB10', amount: '1' }, rules: { lineQor: '3', dailyCapQor: '3' } });
  });
  it('a read error is reported, not thrown', async () => {
    const f = (async () => ({ ok: false, status: 500 })) as unknown as typeof fetch;
    expect(await refillStatus('https://api', FUNDER, RELAYER, now, f)).toMatchObject({ configured: true, error: 'tx search HTTP 500' });
  });
  it('funder address: default, override, off', async () => {
    expect(refillFunder({})).toBe(FUNDER);
    expect(refillFunder({ REFILL_FUNDER_ADDRESS: 'none' })).toBeNull();
    expect(refillFunder({ REFILL_FUNDER_ADDRESS: 'bad' })).toBe(FUNDER);
    expect(await refillStatus('x', null, RELAYER)).toEqual({ configured: false });
  });
  it('formats uqor', () => { expect(fmt(1_500_000n)).toBe('1.5'); expect(fmt(3_000_000n)).toBe('3'); expect(fmt(10_000n)).toBe('0.01'); });
});

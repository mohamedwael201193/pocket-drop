import { describe, expect, it } from 'vitest';
import delta from '../evidence/v4/e2e/delta-run-2026-11-26.json';
import own from '../src/data/own.json';

const ownSet = new Set(Object.values(own.accounts as Record<string, string>).map((a) => a.toLowerCase()));
const hash = /^(0x[0-9a-f]{64}|[0-9A-F]{64})$/;

describe('measured-delta run (TEAM-RUN, delta-run-2026-11-26.json)', () => {
  it('Path A: every fresh test account started empty and made a first spend, with every tx recorded', () => {
    expect(delta.pathA).toHaveLength(delta.n);
    for (const r of delta.pathA) {
      expect(r.startBalanceQor).toBe('0');
      expect(r.keyRegisteredAtStart).toBe(false);
      expect(r.spent).toBe(true);
      expect(r.possessionProven).toBe(true);
      for (const k of ['createDrop', 'bind', 'registerKey', 'claim', 'firstSpend'] as const) expect(r.txs[k]).toMatch(hash);
    }
  });
  it('Path B: the same amount sent directly could not be spent, and the refusals are recorded', () => {
    expect(delta.pathB).toHaveLength(delta.n);
    for (const r of delta.pathB) {
      expect(r.startBalanceQor).toBe('0');
      expect(r.txs.directSend).toMatch(hash);
      expect(r.spent).toBe(false);
      expect(r.balanceAfterAttemptsQor).toBe(delta.amountQor);
      expect(r.attempts.every((a) => a.accepted === false)).toBe(true);
      expect(r.attempts.some((a) => /no usable registered post-quantum key/.test(a.error ?? ''))).toBe(true);
      expect(r.attempts.some((a) => /classical fallback not allowed/.test(a.error ?? ''))).toBe(true);
    }
  });
  it('every test account and Pocket in the run is listed as own, so it is never counted as external', () => {
    for (const a of [delta.sender.pocket, ...delta.pathA.flatMap((r) => [r.account, r.pocket]), ...delta.pathB.map((r) => r.account)]) expect(ownSet.has(a.toLowerCase()), a).toBe(true);
  });
  it('the summary matches the rows', () => {
    expect(delta.summary.pathA).toBe(`${delta.pathA.filter((r) => r.spent).length} of ${delta.n} fresh accounts made a first PQ-signed spend`);
    expect(delta.summary.pathB).toBe(`0 of ${delta.n} could spend the direct transfer`);
  });
});

import { describe, expect, it } from 'vitest';
import { ago, cumulativeSeries, safetyChecks, safetyScore, sparkPath } from '../src/lib/overview';
import type { Health } from '../src/lib/api';

const health = (mode: 'hybrid' | 'evm', classicalPathOpen = false) => ({ ok: true, network: 'diana-testnet', headBlock: '1', relayer: null, window: { queryable: true },
  relay: { mode, signature: 'x', fallback: 'evm-window', classicalPathOpen } }) as unknown as Health;

describe('overview: quantum-safety checks', () => {
  it('without a key only the relay lane is judged', () => {
    const c = safetyChecks(false, undefined, health('hybrid'));
    expect(c.map((x) => x.state)).toEqual(['nokey', 'nokey', 'ok']);
    expect(safetyScore(c)).toEqual({ pct: 100, passed: 1, judged: 1 });
  });
  it('a registered key without possession proof scores 2 of 3', () => {
    const c = safetyChecks(true, { registered: true, algoId: 1, possessionProven: false }, health('hybrid'));
    expect(c.map((x) => x.state)).toEqual(['ok', 'no', 'ok']);
    expect(safetyScore(c)).toEqual({ pct: 67, passed: 2, judged: 3 });
  });
  it('a key registered with another algorithm id is not counted as ML-DSA-87', () => {
    expect(safetyChecks(true, { registered: true, algoId: 2, possessionProven: true }, health('hybrid'))[0].state).toBe('no');
  });
  it('the EVM window lane fails the hybrid check; health still loading is unknown', () => {
    expect(safetyChecks(true, undefined, health('evm'))[2].state).toBe('no');
    const c = safetyChecks(true, undefined, undefined);
    expect(c.map((x) => x.state)).toEqual(['unknown', 'unknown', 'unknown']);
    expect(safetyScore(c)).toEqual({ pct: 0, passed: 0, judged: 0 });
  });
  it('the relay detail says the ECDSA-only path is closed only when it is', () => {
    expect(safetyChecks(false, undefined, health('hybrid', false))[2].detail).toContain('closed');
    expect(safetyChecks(false, undefined, health('hybrid', true))[2].detail).not.toContain('closed');
  });
});

describe('overview: sparkline from event blocks', () => {
  it('is cumulative, ends at the event count and never decreases', () => {
    const s = cumulativeSeries([100, 105, 150, 150n, 199, 200], 10);
    expect(s).toHaveLength(10);
    expect(s[s.length - 1]).toBe(6);
    for (let i = 1; i < s.length; i++) expect(s[i]).toBeGreaterThanOrEqual(s[i - 1]);
  });
  it('no events gives no series and no path', () => {
    expect(cumulativeSeries([])).toEqual([]);
    expect(sparkPath([])).toEqual({ line: '', area: '' });
  });
  it('the path stays inside its box', () => {
    const { line, area } = sparkPath([0, 3, 1, 9], 200, 50);
    const nums = line.match(/[\d.]+/g)!.map(Number);
    for (const n of nums) { expect(n).toBeGreaterThanOrEqual(0); expect(n).toBeLessThanOrEqual(200); }
    expect(area.endsWith('Z')).toBe(true);
  });
});

describe('overview: ages', () => {
  it('formats seconds, minutes, hours and days', () => {
    expect(ago(1000, 1030)).toBe('30s ago');
    expect(ago(1000, 1000 + 180)).toBe('3 min ago');
    expect(ago(1000, 1000 + 7200)).toBe('2 h ago');
    expect(ago(1000, 1000 + 86400 * 3)).toBe('3 d ago');
    expect(ago(undefined)).toBe('');
  });
});

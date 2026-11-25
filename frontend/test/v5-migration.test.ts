import { describe, expect, it } from 'vitest';
import { planPreviousMove } from '../src/components/previousPocket';
import { ALL_ENVS, CURRENT_ENVS, INST, LINK_PREFIX, genOf, previousOf } from '../src/lib/v4';
import v4 from '../src/data/v4.json';

describe('v5 is current, v4 is kept as the previous contracts', () => {
  it('prod / lab point at the v5 deployment, prodV4 / labV4 at the v4 one, all distinct', () => {
    expect(v4.current).toBe('v5');
    expect(CURRENT_ENVS).toEqual(['prod', 'lab']);
    const routers = ALL_ENVS.map((e) => INST[e].router.toLowerCase());
    expect(new Set(routers).size).toBe(4);
    expect(INST.prod.router.toLowerCase()).toBe('0x13b8e379e50da657b943781d2816fc17473ae376');
    expect(INST.prodV4.router.toLowerCase().startsWith('0xb0d8fd23')).toBe(true);
  });
  it('generation helpers', () => {
    expect(genOf('prod')).toBe('v5'); expect(genOf('labV4')).toBe('v4');
    expect(previousOf('prod')).toBe('prodV4'); expect(previousOf('lab')).toBe('labV4'); expect(previousOf('prodV4')).toBe('prodV4');
    expect(new Set(Object.values(LINK_PREFIX)).size).toBe(4);
  });
  it('a move from the v4 Pocket sends up to today\'s allowance and reports the rest', () => {
    expect(planPreviousMove(5n, 10n)).toEqual({ now: 5n, later: 0n });
    expect(planPreviousMove(15n, 10n)).toEqual({ now: 10n, later: 5n });
    expect(planPreviousMove(3n, 0n)).toEqual({ now: 0n, later: 3n });
  });
});

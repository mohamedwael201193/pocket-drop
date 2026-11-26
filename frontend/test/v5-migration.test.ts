import { describe, expect, it } from 'vitest';
import { planPreviousMove } from '../src/components/previousPocket';
import { ALL_ENVS, CURRENT_ENVS, INST, LINK_PREFIX, bindSignsFeeTo, finalizeNeedsAuthorization, genOf, previousOf } from '../src/lib/v4';
import v4 from '../src/data/v4.json';

describe('v5.2 is current, v5.1, v5 and v4 are kept as previous contracts', () => {
  it('prod / lab point at the v5.2 deployment, prodV51 / labV51 at v5.1, prodV5 / labV5 at v5, prodV4 / labV4 at v4, all distinct', () => {
    expect(v4.current).toBe('v5.2');
    expect(CURRENT_ENVS).toEqual(['prod', 'lab']);
    const routers = ALL_ENVS.map((e) => INST[e].router.toLowerCase());
    expect(new Set(routers).size).toBe(8);
    expect(INST.prod.router.toLowerCase()).toBe('0xe0a2679ae760a843880489c8cf8da15c00559a88');
    expect(INST.lab.router.toLowerCase()).toBe('0xa52d5c5eeb65e564f5a76cc6cc8f518c735c7bee');
    expect(INST.prodV51.router.toLowerCase()).toBe('0x99711daaa39f2f03901950486c70641eca5261cb');
    expect(INST.prodV5.router.toLowerCase()).toBe('0x13b8e379e50da657b943781d2816fc17473ae376');
    expect(INST.prodV4.router.toLowerCase().startsWith('0xb0d8fd23')).toBe(true);
  });
  it('generation helpers', () => {
    expect(genOf('prod')).toBe('v5.2'); expect(genOf('labV51')).toBe('v5.1'); expect(genOf('labV5')).toBe('v5'); expect(genOf('labV4')).toBe('v4');
    expect(bindSignsFeeTo('prod')).toBe(true); expect(bindSignsFeeTo('prodV51')).toBe(true); expect(bindSignsFeeTo('prodV5')).toBe(false); expect(bindSignsFeeTo('prodV4')).toBe(false);
    expect(finalizeNeedsAuthorization('prod')).toBe(true); expect(finalizeNeedsAuthorization('lab')).toBe(true); expect(finalizeNeedsAuthorization('prodV51')).toBe(false);
    expect(previousOf('prod')).toBe('prodV51'); expect(previousOf('lab')).toBe('labV51'); expect(previousOf('prodV4')).toBe('prodV4');
    expect(new Set(Object.values(LINK_PREFIX)).size).toBe(8);
  });
  it('a move from the previous Pocket sends up to today\'s allowance and reports the rest', () => {
    expect(planPreviousMove(5n, 10n)).toEqual({ now: 5n, later: 0n });
    expect(planPreviousMove(15n, 10n)).toEqual({ now: 10n, later: 5n });
    expect(planPreviousMove(3n, 0n)).toEqual({ now: 0n, later: 3n });
  });
});

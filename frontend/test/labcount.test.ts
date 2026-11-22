import { describe, expect, it } from 'vitest';
import v4 from '../src/data/v4.json';
import { LAB_REFUSED } from '../src/lib/labcount';

describe('LAB_REFUSED', () => {
  it('counts every recorded v4 attack (reverted or refused at broadcast), stolen-key scenario included', () => {
    const rows = v4.liveRows as { section: string; status: string }[];
    const isAttack = (r: { status: string }) => r.status === 'reverted' || r.status === 'refused';
    const stolen = rows.filter((r) => r.section.startsWith('Guardian freeze and unanimous recovery'));
    const rest = rows.filter((r) => !r.section.startsWith('Guardian freeze and unanimous recovery'));
    expect(LAB_REFUSED).toBe(rest.filter(isAttack).length + stolen.filter(isAttack).length);
    expect(LAB_REFUSED).toBeGreaterThanOrEqual(31);
  });
});

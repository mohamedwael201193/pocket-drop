import { describe, expect, it } from 'vitest';

describe('legacy move plan', async () => {
  const { planMove, UPGRADE_KEY_FUNDING_WEI: F } = await import('../src/components/upgrade');
  const q = (x: number) => BigInt(Math.round(x * 1e6)) * 10n ** 12n;
  it('funds the new key first, sends the rest within the allowance, reports what stays behind', () => {
    expect(planMove(q(1), q(5))).toEqual({ fund: F, rest: q(0.9), leftBehind: 0n });
    expect(planMove(q(8), q(5))).toEqual({ fund: F, rest: q(4.9), leftBehind: q(3) });
    expect(planMove(q(0.05), q(5))).toEqual({ fund: q(0.05), rest: 0n, leftBehind: 0n });
    expect(planMove(0n, q(5))).toEqual({ fund: 0n, rest: 0n, leftBehind: 0n });
  });
});

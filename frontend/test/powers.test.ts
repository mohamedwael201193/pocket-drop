// "Who can do what": the table follows the Pocket's live state (guardians, freeze, recovery); delays come from the vault.
import { describe, expect, it } from 'vitest';
import type { Hex } from 'viem';
import { powersOf, readDelays, type VaultDelays } from '../src/lib/powers';
import { INST, type PocketView } from '../src/lib/v4';
import v4 from '../src/data/v4.json';

const D: VaultDelays = { timelock: 86400, recoveryDelay: 172800, freezePeriod: 259200, unanimousDelay: 604800, maxFreezeStreak: 2, freezeCooldownPeriods: 1 };
const G = ['0x1111111111111111111111111111111111111111', '0x2222222222222222222222222222222222222222', '0x3333333333333333333333333333333333333333'] as Hex[];
const base: PocketView = {
  address: '0x4444444444444444444444444444444444444444', env: 'prod', deployed: true, balance: 10n ** 18n, owner: G[0], nonce: 3n, dailyLimit: 5n * 10n ** 18n,
  allowanceLeft: 2n * 10n ** 18n, guardians: [], threshold: 0, frozen: false, frozenUntil: 0, freezeNonce: 0n, freezeStreak: 0, queue: [], pendingLimit: 0n,
  pendingLimitAt: 0, pendingGuardians: [], pendingThreshold: 0, pendingGuardiansAt: 0, recovery: null, unanimous: null, recoveryNonce: 0n,
};
const state = (pv: PocketView) => Object.fromEntries(powersOf(pv, D, 1_000).map((p) => [p.id, p.state]));

describe('powersOf', () => {
  it('a Pocket without guardians: owner powers open, guardian powers not possible, classical key never', () => {
    const s = state(base);
    expect(s).toMatchObject({ 'spend-now': 'open', 'spend-queued': 'open', 'limit-up': 'open', guardians: 'open', freeze: 'unavailable', recover: 'unavailable', 'recover-all': 'unavailable', classical: 'unavailable', relayer: 'unavailable' });
    expect(powersOf(base, D, 1_000).find((p) => p.id === 'spend-now')!.power).toContain('2 QOR left');
    expect(powersOf(base, D, 1_000).find((p) => p.id === 'spend-queued')!.delay).toBe('24 h');
  });
  it('2 of 3 guardians, not frozen: freeze and both recoveries open', () => {
    const pv = { ...base, guardians: G, threshold: 2 };
    expect(state(pv)).toMatchObject({ freeze: 'open', recover: 'open', 'recover-all': 'open' });
    expect(powersOf(pv, D, 1_000).find((p) => p.id === 'freeze')!.who).toBe('2 of 3 guardians, each with an ML-DSA-87 signature');
  });
  it('frozen: spending, raises, guardian changes and new drops pause; lowering the limit and cancelling stay open', () => {
    const pv = { ...base, guardians: G, threshold: 2, frozen: true, frozenUntil: 4_600 };
    const s = state(pv);
    expect(s).toMatchObject({ 'spend-now': 'paused', 'spend-queued': 'paused', 'limit-up': 'paused', guardians: 'paused', drops: 'paused', freeze: 'paused', 'limit-down': 'open', recover: 'open' });
    expect(powersOf(pv, D, 1_000).find((p) => p.id === 'spend-now')!.why).toBe('frozen for another 60 min');
  });
  it('threshold recovery pending: a second one waits; the unanimous one may replace it', () => {
    const pv = { ...base, guardians: G, threshold: 2, recovery: { newOwner: G[1], keyHash: ('0x' + '00'.repeat(32)) as Hex, at: 9_999 } };
    expect(state(pv)).toMatchObject({ recover: 'paused', 'recover-all': 'open' });
    expect(powersOf(pv, D, 1_000).find((p) => p.id === 'recover-all')!.why).toMatch(/replace the pending/);
  });
  it('unanimous recovery needs at least 2 guardians', () => {
    expect(state({ ...base, guardians: [G[0]], threshold: 1 })['recover-all']).toBe('unavailable');
  });
});

describe('readDelays (LIVE)', () => {
  it.each(['prod', 'lab'] as const)('%s vault delays equal the recorded deployment read-back', async (env) => {
    const d = await readDelays(INST[env].vaultImpl);
    const rb = v4.instances[env].readBack as Record<string, string>;
    expect(d.timelock).toBe(Number(rb.TIMELOCK));
    expect(d.recoveryDelay).toBe(Number(rb.RECOVERY_DELAY));
    expect(d.freezePeriod).toBe(Number(rb.FREEZE_PERIOD));
    expect(d.unanimousDelay).toBe(Number(rb.UNANIMOUS_RECOVERY_DELAY));
    expect(d.maxFreezeStreak).toBeGreaterThan(0);
  }, 30_000);
});

// "Who can do what" for one Pocket: every power the PocketVault contract grants, which key it needs, the contract function
// that checks it, the delay, and whether it is open right now. Built from a live chain read (readPocket + the vault's own
// immutable delays), so the table changes when the Pocket's state changes (frozen, recovery pending, guardians set).
import { fmtQor, pub } from './chain';
import { vaultAbi } from './abi4';
import type { PocketView } from './v4';
import type { Hex } from 'viem';

export interface VaultDelays { timelock: number; recoveryDelay: number; freezePeriod: number; unanimousDelay: number; maxFreezeStreak: number; freezeCooldownPeriods: number }

/** The delays are immutables in the PocketVault implementation; a clone returns them too. */
export async function readDelays(address: Hex): Promise<VaultDelays> {
  const r = (fn: string) => pub.readContract({ address, abi: vaultAbi, functionName: fn } as never) as Promise<bigint>;
  const [timelock, recoveryDelay, freezePeriod, unanimousDelay, maxFreezeStreak, freezeCooldownPeriods] = await Promise.all(
    ['TIMELOCK', 'RECOVERY_DELAY', 'FREEZE_PERIOD', 'UNANIMOUS_RECOVERY_DELAY', 'MAX_FREEZE_STREAK', 'FREEZE_COOLDOWN_PERIODS'].map(r));
  return { timelock: Number(timelock), recoveryDelay: Number(recoveryDelay), freezePeriod: Number(freezePeriod), unanimousDelay: Number(unanimousDelay),
    maxFreezeStreak: Number(maxFreezeStreak), freezeCooldownPeriods: Number(freezeCooldownPeriods) };
}

export const dur = (s: number) => (s <= 0 ? 'none' : s < 90 ? `${s} s` : s < 5400 ? `${Math.round(s / 60)} min` : s < 172800 ? `${Math.round(s / 3600)} h` : `${Math.round(s / 86400)} days`);

export type State = 'open' | 'paused' | 'unavailable';
export interface Power { id: string; power: string; who: string; check: string; delay: string; undo: string; state: State; why?: string }

export function powersOf(pv: PocketView, d: VaultDelays, now: number): Power[] {
  const g = pv.guardians.length;
  const thr = pv.threshold;
  const frozen = pv.frozen;
  const recovering = !!pv.recovery;
  const noG = g === 0;
  const frozenWhy = pv.unanimous ? 'frozen while a unanimous recovery is pending' : `frozen for another ${dur(pv.frozenUntil - now)}`;
  const p = (x: Power) => x;
  return [
    p({ id: 'spend-now', power: `Send up to today's allowance (${fmtQor(pv.deployed ? pv.allowanceLeft : pv.dailyLimit)} QOR left)`, who: "owner's ML-DSA-87 key", check: 'spend → _auth (pqcVerify, pinned key hash, nonce)', delay: 'none', undo: 'no', state: frozen ? 'paused' : 'open', why: frozen ? frozenWhy : undefined }),
    p({ id: 'spend-queued', power: 'Send more than the allowance', who: "owner's ML-DSA-87 key, then anyone executes", check: 'spend queues it; executeQueued after the delay', delay: dur(d.timelock), undo: 'owner can veto (vetoQueued) the whole time', state: frozen ? 'paused' : 'open', why: frozen ? frozenWhy : recovering ? 'can be queued; execution waits until the recovery is settled' : undefined }),
    p({ id: 'limit-down', power: 'Lower the daily limit', who: "owner's ML-DSA-87 key", check: 'setLimit (new ≤ current)', delay: 'none', undo: 'raise again (waits)', state: 'open' }),
    p({ id: 'limit-up', power: 'Raise the daily limit', who: "owner's ML-DSA-87 key, then anyone applies", check: 'setLimit queues; applyLimit after the delay', delay: dur(d.timelock), undo: 'owner can cancel (cancelPending)', state: frozen ? 'paused' : 'open', why: frozen ? frozenWhy : undefined }),
    p({ id: 'guardians', power: 'Change the guardians or the threshold', who: "owner's ML-DSA-87 key, then anyone applies", check: 'setGuardians queues; applyGuardians after the delay', delay: dur(d.timelock), undo: 'owner can cancel (cancelPending)', state: frozen ? 'paused' : 'open', why: frozen ? frozenWhy : undefined }),
    p({ id: 'drops', power: 'Create a drop link or a pool from the Pocket', who: "owner's ML-DSA-87 key", check: 'createDrop / createPool → _auth', delay: 'none', undo: 'cancelDrop / closePool (also while frozen)', state: frozen ? 'paused' : 'open', why: frozen ? frozenWhy : undefined }),
    p({ id: 'freeze', power: `Freeze the Pocket for ${dur(d.freezePeriod)}`, who: noG ? 'guardians (none set)' : `${thr} of ${g} guardians, each with an ML-DSA-87 signature`, check: 'guardianFreeze → _checkGuardianSigs', delay: 'none', undo: `nobody, it ends by itself; at most ${d.maxFreezeStreak} in a row, then ${d.freezeCooldownPeriods} periods of quiet`, state: noG ? 'unavailable' : frozen ? 'paused' : 'open', why: noG ? 'no guardians on this Pocket' : frozen ? 'already frozen' : undefined }),
    p({ id: 'recover', power: 'Move the Pocket to a new owner key', who: noG ? 'guardians (none set)' : `${thr} of ${g} guardians`, check: 'proposeRecovery, then finalizeRecovery after the delay', delay: dur(d.recoveryDelay), undo: 'owner can veto (vetoRecovery)', state: noG ? 'unavailable' : recovering || pv.unanimous ? 'paused' : 'open', why: noG ? 'no guardians on this Pocket' : recovering || pv.unanimous ? 'a recovery is already pending' : undefined }),
    p({ id: 'recover-all', power: 'Move the Pocket when the owner key is stolen', who: g < 2 ? 'all guardians (needs at least 2)' : `all ${g} guardians`, check: 'proposeRecoveryUnanimous, then finalizeRecoveryUnanimous', delay: dur(d.unanimousDelay), undo: 'no veto (a stolen key must not stop it); the Pocket stays frozen meanwhile', state: g < 2 ? 'unavailable' : 'open', why: g < 2 ? 'needs at least 2 guardians' : recovering ? 'would replace the pending threshold recovery' : undefined }),
    p({ id: 'classical', power: "Anything with the owner's secp256k1 (classical) key alone", who: 'a Q-Day attacker who knows that key', check: 'every action above needs an ML-DSA-87 signature', delay: '–', undo: '–', state: 'unavailable', why: 'the classical key signs nothing the Pocket accepts' }),
    p({ id: 'relayer', power: 'The relayer', who: 'Pocket Drop relayer', check: 'only submits intents already signed by the keys above', delay: '–', undo: '–', state: 'unavailable', why: 'can delay or refuse to submit; cannot change an amount or a payee' }),
  ];
}

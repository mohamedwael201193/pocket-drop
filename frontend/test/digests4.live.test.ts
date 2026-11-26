// LIVE (Diana testnet, eth_call): every digest this app signs must equal the deployed contract's own view function.
// The vault views are read on each instance's PocketVault implementation (same code and constants as every Pocket clone;
// the digest depends on address(this), which the test passes to the JS side as the same address).
import { describe, expect, it } from 'vitest';
import { keccak256, parseAbi, toBytes, type Hex } from 'viem';
const BIND_V5_DIGEST = parseAbi(['function bindDigest(uint256, address, bytes32, address) view returns (bytes32)']);
import { dropAbi, poolAbi, vaultAbi } from '../src/lib/abi4';
import { pub } from '../src/lib/chain';
import { ACT, dropBindDigest, finalizeDigest, dropClaimDigest, freezeDigest, intentDigest, params, poolClaimDigest, poolLinkDigest, recoveryDigest } from '../src/lib/intents';
import { INST, type Env } from '../src/lib/v4';

const R = '0xbeCce1e181BD39C0E2aD32E82D71DF04b7a701AE' as Hex;
const P = '0x8ab5CE4fcd45cC69FEe31Ea6E9e6222C1e18bBDd' as Hex;
const KH = ('0x' + '5a'.repeat(32)) as Hex;
const LKH = keccak256(toBytes('link key'));
const DL = 1_900_000_000n;

describe.each(['prod', 'lab'] as Env[])('digests equal the %s contracts', (env) => {
  const i = INST[env];
  const vault = i.vaultImpl;
  const onchain = (fn: string, args: unknown[]) => pub.readContract({ address: vault, abi: vaultAbi, functionName: fn, args } as never) as Promise<Hex>;

  it('every owner intent: intentDigest(action, nonce, deadline, params)', async () => {
    const cases: [string, Hex, Hex][] = [
      ['SPEND', ACT.SPEND, params.spend(P, 10n ** 17n)],
      ['VETO_QUEUED', ACT.VETO_QUEUED, params.id(3n)],
      ['SET_LIMIT', ACT.SET_LIMIT, params.limit(2n * 10n ** 18n)],
      ['SET_GUARDIANS', ACT.SET_GUARDIANS, params.guardians([P, R], 2)],
      ['CANCEL_PENDING', ACT.CANCEL_PENDING, params.none()],
      ['VETO_RECOVERY', ACT.VETO_RECOVERY, params.none()],
      ['CREATE_DROP', ACT.CREATE_DROP, params.createDrop(i.drop, LKH, 0, 1_900_000_000n, 10n ** 17n, 6n * 10n ** 16n, 46n * 10n ** 16n)],
      ['CONFIRM_DROP', ACT.CONFIRM_DROP, params.confirm(i.drop, 7n, KH)],
      ['CANCEL_DROP', ACT.CANCEL_DROP, params.cancel(i.drop, 7n)],
      ['CREATE_POOL', ACT.CREATE_POOL, params.createPool(i.pool, LKH, 3, 2n * 10n ** 16n, 1_900_000_000n)],
      ['CLOSE_POOL', ACT.CLOSE_POOL, params.closePool(i.pool, 2n)],
    ];
    for (const [name, action, p] of cases) {
      for (const nonce of [0n, 5n]) {
        expect(intentDigest({ action, vault, nonce, deadline: DL, params: p }), `${name} nonce ${nonce}`).toBe(await onchain('intentDigest', [action, nonce, DL, p]));
      }
    }
  });
  it('the action tags equal the vault constants', async () => {
    const names: Record<string, Hex> = { ACT_SPEND: ACT.SPEND, ACT_CREATE_DROP: ACT.CREATE_DROP, ACT_CONFIRM_DROP: ACT.CONFIRM_DROP, ACT_CREATE_POOL: ACT.CREATE_POOL, ACT_FREEZE: ACT.GUARDIAN_FREEZE, ACT_RECOVER: ACT.RECOVER, ACT_RECOVER_UNANIMOUS: ACT.RECOVER_UNANIMOUS, ACT_SET_GUARDIANS: ACT.SET_GUARDIANS };
    for (const [fn, v] of Object.entries(names)) expect(v, fn).toBe(await pub.readContract({ address: vault, abi: vaultAbi, functionName: fn } as never));
  });
  it('guardian freeze, threshold recovery and unanimous recovery', async () => {
    for (const nonce of [0n, 1n]) expect(freezeDigest({ vault, nonce, deadline: DL })).toBe(await onchain('freezeDigest', [nonce, DL]));
    expect(recoveryDigest({ vault, recNonce: 0n, newOwner: R, newKeyHash: KH, deadline: DL })).toBe(await onchain('recoveryDigest', [R, KH, DL]));
    expect(recoveryDigest({ vault, recNonce: 0n, newOwner: R, newKeyHash: KH, deadline: DL, unanimous: true })).toBe(await onchain('unanimousDigest', [R, KH, DL]));
  });
  it('v5.2 finalize authorization (both paths, authorizer and deadline bound)', async () => {
    const Z = '0x0000000000000000000000000000000000000000' as Hex; const Z32 = ('0x' + '00'.repeat(32)) as Hex;
    expect(await onchain('ACT_FINALIZE_RECOVERY', [])).toBe(ACT.FINALIZE_RECOVERY);
    expect(await onchain('ACT_FINALIZE_RECOVERY_UNANIMOUS', [])).toBe(ACT.FINALIZE_RECOVERY_UNANIMOUS);
    for (const unanimous of [false, true]) for (const who of [R, P]) {
      const action = unanimous ? ACT.FINALIZE_RECOVERY_UNANIMOUS : ACT.FINALIZE_RECOVERY;
      // the implementation has no pending recovery: nonce 0, pending owner and key hash zero
      expect(finalizeDigest({ vault, unanimous, recNonce: 0n, newOwner: Z, newKeyHash: Z32, authorizer: who, deadline: DL })).toBe(await onchain('finalizeDigest', [action, who, DL]));
    }
  });
  it('drop bind and claim', async () => {
    for (const id of [1n, 7n, 123456n]) {
      expect(dropBindDigest({ drop: i.drop, id, recipient: R, keyHash: KH, payTo: P, feeTo: R })).toBe(await pub.readContract({ address: i.drop, abi: dropAbi, functionName: 'bindDigest', args: [id, R, KH, P, R] }));
      // the v5 contracts (no feeTo) still answer the v5 bind digest
      const v5 = INST.prodV5.drop;
      expect(dropBindDigest({ drop: v5, id, recipient: R, keyHash: KH, payTo: P })).toBe(await pub.readContract({ address: v5, abi: BIND_V5_DIGEST, functionName: 'bindDigest', args: [id, R, KH, P] }));
      expect(dropClaimDigest({ drop: i.drop, id, recipient: R, payTo: P })).toBe(await pub.readContract({ address: i.drop, abi: dropAbi, functionName: 'claimDigest', args: [id, R, P] }));
    }
  });
  it('pool link and claim', async () => {
    for (const id of [1n, 9n]) {
      expect(poolLinkDigest({ pool: i.pool, id, recipient: R, payTo: P })).toBe(await pub.readContract({ address: i.pool, abi: poolAbi, functionName: 'linkDigest', args: [id, R, P] }));
      expect(poolClaimDigest({ pool: i.pool, id, recipient: R, payTo: P })).toBe(await pub.readContract({ address: i.pool, abi: poolAbi, functionName: 'claimDigest', args: [id, R, P] }));
    }
  });
});

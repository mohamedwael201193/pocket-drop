// Pure v4 protocol helpers (viem only): every digest an owner, guardian, link key or recipient signs. Each one is checked
// against the contract's own view function in test/digests4.live.test.ts (eth_call) and against fixtures from contracts-v4.
//   signed bytes = "qorechain-msg-v1|qorechain-diana|0x" + lowercase hex(digest)   (PqcLib.pqMessage)
import { encodeAbiParameters, keccak256, toBytes, toHex, type Hex } from 'viem';

export const CHAIN_ID = 9800n;
export const CHAIN_STR = 'qorechain-diana';
export const MSG_PREFIX = 'qorechain-msg-v1|';

const tag = (s: string) => keccak256(toBytes(s));
export const ACT = {
  SPEND: tag('POCKET_SPEND_V1'),
  VETO_QUEUED: tag('POCKET_VETO_QUEUED_V1'),
  SET_LIMIT: tag('POCKET_SET_LIMIT_V1'),
  SET_GUARDIANS: tag('POCKET_SET_GUARDIANS_V1'),
  CANCEL_PENDING: tag('POCKET_CANCEL_PENDING_V1'),
  VETO_RECOVERY: tag('POCKET_VETO_RECOVERY_V1'),
  CREATE_DROP: tag('POCKET_CREATE_DROP_V1'),
  CONFIRM_DROP: tag('POCKET_CONFIRM_DROP_V1'),
  CANCEL_DROP: tag('POCKET_CANCEL_DROP_V1'),
  CREATE_POOL: tag('POCKET_CREATE_POOL_V1'),
  CLOSE_POOL: tag('POCKET_CLOSE_POOL_V1'),
  RECOVER: tag('POCKET_RECOVER_V1'),
  GUARDIAN_FREEZE: tag('POCKET_GUARDIAN_FREEZE_V1'),
  RECOVER_UNANIMOUS: tag('POCKET_RECOVER_UNANIMOUS_V1'),
  FINALIZE_RECOVERY: tag('POCKET_FINALIZE_RECOVERY_V1'), // v5.2
  FINALIZE_RECOVERY_UNANIMOUS: tag('POCKET_FINALIZE_RECOVERY_UNANIMOUS_V1'), // v5.2
} as const;

const enc = (types: string[], values: unknown[]): Hex => encodeAbiParameters(types.map((type) => ({ type })) as never, values as never);

/** The exact bytes a key signs for `digest`. */
export const pqMessageText = (digest: Hex, chain: string = CHAIN_STR): string => `${MSG_PREFIX}${chain}|${digest.toLowerCase()}`;
export const pqMessageBytes = (digest: Hex, chain: string = CHAIN_STR): Uint8Array => toBytes(pqMessageText(digest, chain));
export const pqMessageHex = (digest: Hex): Hex => toHex(pqMessageBytes(digest));

/** Owner intent digest: keccak(abi.encode(action, chainid, vault, nonce, deadline, params)). */
export const intentDigest = (a: { action: Hex; vault: Hex; nonce: bigint; deadline: bigint; params: Hex; chainId?: bigint }): Hex =>
  keccak256(enc(['bytes32', 'uint256', 'address', 'uint256', 'uint256', 'bytes'], [a.action, a.chainId ?? CHAIN_ID, a.vault, a.nonce, a.deadline, a.params]));

/** Threshold recovery (action RECOVER) or unanimous recovery (action RECOVER_UNANIMOUS): same shape, own tag, shared recovery nonce. */
export const recoveryDigest = (a: { vault: Hex; recNonce: bigint; newOwner: Hex; newKeyHash: Hex; deadline: bigint; unanimous?: boolean }): Hex =>
  keccak256(enc(['bytes32', 'uint256', 'address', 'uint256', 'uint256', 'address', 'bytes32'],
    [a.unanimous ? ACT.RECOVER_UNANIMOUS : ACT.RECOVER, CHAIN_ID, a.vault, a.recNonce, a.deadline, a.newOwner, a.newKeyHash]));

/** v5.2 PocketVault.finalizeDigest: keccak(abi.encode(action, chainid, vault, recoveryNonce, pending owner, pending key hash,
 *  authorizer, deadline)). The authorizer (owner, guardian or approved new owner) signs it to finish a recovery. */
export const finalizeDigest = (a: { vault: Hex; unanimous: boolean; recNonce: bigint; newOwner: Hex; newKeyHash: Hex; authorizer: Hex; deadline: bigint }): Hex =>
  keccak256(enc(['bytes32', 'uint256', 'address', 'uint256', 'address', 'bytes32', 'address', 'uint256'],
    [a.unanimous ? ACT.FINALIZE_RECOVERY_UNANIMOUS : ACT.FINALIZE_RECOVERY, CHAIN_ID, a.vault, a.recNonce, a.newOwner, a.newKeyHash, a.authorizer, a.deadline]));

export const freezeDigest = (a: { vault: Hex; nonce: bigint; deadline: bigint }): Hex =>
  keccak256(enc(['bytes32', 'uint256', 'address', 'uint256', 'uint256'], [ACT.GUARDIAN_FREEZE, CHAIN_ID, a.vault, a.nonce, a.deadline]));

/** PocketDrop.bindDigest. With `feeTo` (v5.1): POCKETDROP_BIND_V3 and the fee address is signed. Without (v5, v4): POCKETDROP_BIND_V2. */
export const dropBindDigest = (a: { drop: Hex; id: bigint; recipient: Hex; keyHash: Hex; payTo: Hex; feeTo?: Hex }): Hex =>
  a.feeTo
    ? keccak256(enc(['string', 'uint256', 'address', 'uint256', 'address', 'bytes32', 'address', 'address'], ['POCKETDROP_BIND_V3', CHAIN_ID, a.drop, a.id, a.recipient, a.keyHash, a.payTo, a.feeTo]))
    : keccak256(enc(['string', 'uint256', 'address', 'uint256', 'address', 'bytes32', 'address'], ['POCKETDROP_BIND_V2', CHAIN_ID, a.drop, a.id, a.recipient, a.keyHash, a.payTo]));
export const dropClaimDigest = (a: { drop: Hex; id: bigint; recipient: Hex; payTo: Hex }): Hex =>
  keccak256(enc(['string', 'uint256', 'address', 'uint256', 'address', 'address'], ['POCKETDROP_CLAIM_V2', CHAIN_ID, a.drop, a.id, a.recipient, a.payTo]));
export const poolLinkDigest = (a: { pool: Hex; id: bigint; recipient: Hex; payTo: Hex }): Hex =>
  keccak256(enc(['string', 'uint256', 'address', 'uint256', 'address', 'address'], ['POCKET_POOL_LINK_V1', CHAIN_ID, a.pool, a.id, a.recipient, a.payTo]));
export const poolClaimDigest = (a: { pool: Hex; id: bigint; recipient: Hex; payTo: Hex }): Hex =>
  keccak256(enc(['string', 'uint256', 'address', 'uint256', 'address', 'address'], ['POCKET_POOL_CLAIM_V1', CHAIN_ID, a.pool, a.id, a.recipient, a.payTo]));

/** abi.encode of each intent's params, as PocketVault passes them to `intentDigest`. */
export const params = {
  spend: (to: Hex, amount: bigint) => enc(['address', 'uint256'], [to, amount]),
  id: (id: bigint) => enc(['uint256'], [id]),
  limit: (v: bigint) => enc(['uint256'], [v]),
  guardians: (g: Hex[], t: number) => enc(['address[]', 'uint8'], [g, t]),
  none: (): Hex => '0x',
  createDrop: (drop: Hex, linkKeyHash: Hex, mode: number, expiry: bigint, drip: bigint, fee: bigint, value: bigint) =>
    enc(['address', 'bytes32', 'uint8', 'uint64', 'uint96', 'uint96', 'uint256'], [drop, linkKeyHash, mode, expiry, drip, fee, value]),
  confirm: (drop: Hex, id: bigint, expectedKeyHash: Hex) => enc(['address', 'uint256', 'bytes32'], [drop, id, expectedKeyHash]),
  cancel: (drop: Hex, id: bigint) => enc(['address', 'uint256'], [drop, id]),
  createPool: (pool: Hex, linkKeyHash: Hex, slots: number, perSlot: bigint, expiry: bigint) =>
    enc(['address', 'bytes32', 'uint32', 'uint96', 'uint64'], [pool, linkKeyHash, slots, perSlot, expiry]),
  closePool: (pool: Hex, id: bigint) => enc(['address', 'uint256'], [pool, id]),
};

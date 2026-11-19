// Shared helpers for fixture generation / verification. All encodings use viem, independently of the contracts.
import { encodeAbiParameters, encodePacked, keccak256, toHex, toBytes, getAddress } from 'viem';

export const CHAIN_ID = 9800n;
export const CHAIN_STR = 'qorechain-diana';
export const T0 = 1800000000; // foundry.toml block_timestamp
export const DL = 1900000000; // deadline on every fixture intent
export const EXP = T0 + 7 * 86400; // link / pool expiry on fixtures

// Fixed addresses the Foundry tests deploy at (deployCodeTo / etch).
export const A = (n) => getAddress('0x' + BigInt(n).toString(16).padStart(40, '0'));
export const ADDR = {
  IMPL: A(0x1110), FACTORY: A(0xfac70), DROP: A(0xd0d0d0), POOL: A(0xb00100), ROUTER: A(0x70070), COUNTER: A(0xc0de0),
  SINK: A(0x5151), ZERO: A(0),
};
export const ACCOUNTS = {
  OA: A(0xa0a01), OB: A(0xa0a02),
  G0: A(0x6700), G1: A(0x6701), G2: A(0x6702), G3: A(0x6703),
  R0: A(0xb0b01), R1: A(0xb0b02), R2: A(0xb0b03),
  C0: A(0xc0c01), C1: A(0xc0c02), C2: A(0xc0c03), C3: A(0xc0c04),
};
export const NUM_LINKS = 8;
export const ETH = 10n ** 18n;

export const tag = (s) => keccak256(toBytes(s));
export const ACT = Object.fromEntries(
  ['SPEND', 'VETO_QUEUED', 'SET_LIMIT', 'SET_GUARDIANS', 'CANCEL_PENDING', 'VETO_RECOVERY', 'CREATE_DROP', 'CONFIRM_DROP',
    'CANCEL_DROP', 'CREATE_POOL', 'CLOSE_POOL', 'RECOVER', 'GUARDIAN_FREEZE', 'RECOVER_UNANIMOUS'].map((k) => [k, tag(`POCKET_${k}_V1`)]),
);

const enc = (types, values) => encodeAbiParameters(types.map((type) => ({ type })), values);

/** Pocket address: factory CREATE2 over the EIP-1167 clone of IMPL, salt = keccak(abi.encode(config)). */
export function pocketAddr({ owner, guardians, threshold, limit, userSalt }) {
  const salt = keccak256(enc(['address', 'address[]', 'uint8', 'uint256', 'bytes32'], [owner, guardians, threshold, limit, userSalt]));
  const init = encodePacked(['bytes', 'address', 'bytes'], ['0x3d602d80600a3d3981f3363d3d373d3d3d363d73', ADDR.IMPL, '0x5af43d82803e903d91602b57fd5bf3']);
  const h = keccak256(init);
  return getAddress('0x' + keccak256(encodePacked(['bytes1', 'address', 'bytes32', 'bytes32'], ['0xff', ADDR.FACTORY, salt, h])).slice(26));
}
const sl = (n) => '0x' + n.toString(16).padStart(64, '0');
export const POCKET_CFG = {
  PA: { owner: ACCOUNTS.OA, guardians: [ACCOUNTS.G0, ACCOUNTS.G1, ACCOUNTS.G2], threshold: 2, limit: 2n * ETH, userSalt: sl(1) },
  PA2: { owner: ACCOUNTS.OA, guardians: [ACCOUNTS.G0, ACCOUNTS.G1, ACCOUNTS.G2], threshold: 2, limit: 2n * ETH, userSalt: sl(2) },
  PB: { owner: ACCOUNTS.OB, guardians: [], threshold: 0, limit: 5n * ETH, userSalt: sl(3) },
  PR0: { owner: ACCOUNTS.R0, guardians: [], threshold: 0, limit: ETH, userSalt: sl(4) },
  PR1: { owner: ACCOUNTS.R1, guardians: [], threshold: 0, limit: ETH, userSalt: sl(4) },
  PR2: { owner: ACCOUNTS.R2, guardians: [], threshold: 0, limit: ETH, userSalt: sl(4) },
  PC0: { owner: ACCOUNTS.C0, guardians: [], threshold: 0, limit: ETH, userSalt: sl(5) },
  PC1: { owner: ACCOUNTS.C1, guardians: [], threshold: 0, limit: ETH, userSalt: sl(5) },
  PC2: { owner: ACCOUNTS.C2, guardians: [], threshold: 0, limit: ETH, userSalt: sl(5) },
  PC3: { owner: ACCOUNTS.C3, guardians: [], threshold: 0, limit: ETH, userSalt: sl(5) },
};
export const POCKETS = Object.fromEntries(Object.entries(POCKET_CFG).map(([k, c]) => [k, pocketAddr(c)]));

/** The bytes a QoreX / browser key signs for a digest: "qorechain-msg-v1|qorechain-diana|" + 0x-hex digest. */
export const pqMessage = (digest, chain = CHAIN_STR) => toHex(toBytes(`qorechain-msg-v1|${chain}|${digest}`));
export const rawMessage = (digest) => toHex(toBytes(digest));

/** Owner intent digest: keccak(abi.encode(action, chainid, vault, nonce, deadline, params)). */
export const intentDigest = ({ action, vault, nonce, deadline = DL, params, chainId = CHAIN_ID }) =>
  keccak256(enc(['bytes32', 'uint256', 'address', 'uint256', 'uint256', 'bytes'], [action, chainId, vault, BigInt(nonce), BigInt(deadline), params]));

export const recoveryDigest = ({ vault, recNonce, newOwner, newKeyHash, deadline = DL, action = ACT.RECOVER }) =>
  keccak256(enc(['bytes32', 'uint256', 'address', 'uint256', 'uint256', 'address', 'bytes32'], [action, CHAIN_ID, vault, BigInt(recNonce), BigInt(deadline), newOwner, newKeyHash]));

/** Unanimous recovery: same shape as recoveryDigest under its own action tag (shares the recovery nonce). */
export const unanimousDigest = (a) => recoveryDigest({ ...a, action: ACT.RECOVER_UNANIMOUS });

/** Guardian freeze digest: keccak(abi.encode(ACT_FREEZE, chainid, vault, freezeNonce, deadline)). */
export const freezeDigest = ({ vault, nonce, deadline = DL }) =>
  keccak256(enc(['bytes32', 'uint256', 'address', 'uint256', 'uint256'], [ACT.GUARDIAN_FREEZE, CHAIN_ID, vault, BigInt(nonce), BigInt(deadline)]));

export const dropBindDigest = ({ domain = 'POCKETDROP_BIND_V2', chainId = CHAIN_ID, drop = ADDR.DROP, id, recipient, keyHash, payTo }) =>
  keccak256(enc(['string', 'uint256', 'address', 'uint256', 'address', 'bytes32', 'address'], [domain, chainId, drop, BigInt(id), recipient, keyHash, payTo]));
export const dropClaimDigest = ({ domain = 'POCKETDROP_CLAIM_V2', chainId = CHAIN_ID, drop = ADDR.DROP, id, recipient, payTo }) =>
  keccak256(enc(['string', 'uint256', 'address', 'uint256', 'address', 'address'], [domain, chainId, drop, BigInt(id), recipient, payTo]));
export const poolDigest = ({ domain, pool = ADDR.POOL, id, recipient, payTo }) =>
  keccak256(enc(['string', 'uint256', 'address', 'uint256', 'address', 'address'], [domain, CHAIN_ID, pool, BigInt(id), recipient, payTo]));
export const counterDigest = ({ account, count }) =>
  keccak256(enc(['string', 'uint256', 'address', 'address', 'uint256'], ['PQ_GUARDED_COUNTER_V1', CHAIN_ID, ADDR.COUNTER, account, BigInt(count)]));

export const params = {
  spend: (to, amount) => enc(['address', 'uint256'], [to, amount]),
  id: (id) => enc(['uint256'], [BigInt(id)]),
  limit: (v) => enc(['uint256'], [v]),
  guardians: (g, t) => enc(['address[]', 'uint8'], [g, t]),
  none: () => '0x',
  createDrop: (drop, lkh, mode, expiry, drip, fee, value) => enc(['address', 'bytes32', 'uint8', 'uint64', 'uint96', 'uint96', 'uint256'], [drop, lkh, mode, BigInt(expiry), drip, fee, value]),
  confirm: (drop, id, h) => enc(['address', 'uint256', 'bytes32'], [drop, BigInt(id), h]),
  cancel: (drop, id) => enc(['address', 'uint256'], [drop, BigInt(id)]),
  createPool: (pool, lkh, slots, perSlot, expiry) => enc(['address', 'bytes32', 'uint32', 'uint96', 'uint64'], [pool, lkh, slots, perSlot, BigInt(expiry)]),
  closePool: (pool, id) => enc(['address', 'uint256'], [pool, BigInt(id)]),
};

export const tripleHash = (pk, sig, msg) => keccak256(enc(['bytes', 'bytes', 'bytes'], [pk, sig, msg]));
export const hex = (u8) => toHex(u8);
export const unhex = (h) => Uint8Array.from(Buffer.from(h.slice(2), 'hex'));
export { keccak256, toHex, toBytes };

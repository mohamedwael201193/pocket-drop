// Recipient side of drops and pools. v3 link ids are plain numbers (/c/17). v4 (previous contracts) ids: p12 = prod, l12 = lab.
// v5 (current contracts) ids: q12 = prod, k12 = lab. Old v4 links keep working against the v4 contracts.
import { decodeFunctionResult, encodeFunctionData, parseAbi, type Hex } from 'viem';
import { dropAbi, poolAbi } from './abi4';
import { pub } from './chain';
import { signDigest, keyHashOfAccount, type KeyAccount } from './identity';
import { bytesToHex } from './protocol';
import { dropBindDigest, dropClaimDigest, poolClaimDigest, poolLinkDigest } from './intents';
import { INST, LINK_PREFIX, relayTo, type Env } from './v4';
import { postRoute, type RouteResult } from './api';

export type ParsedId = { v: 3; id: string } | { v: 4; env: Env; id: bigint };
export function parseLinkId(raw: string): ParsedId | null {
  if (/^\d+$/.test(raw)) return { v: 3, id: raw };
  const m = /^([plqk])(\d{1,18})$/.exec(raw);
  return m && BigInt(m[2]) > 0n ? { v: 4, env: PREFIX_ENV[m[1]], id: BigInt(m[2]) } : null;
}
const PREFIX_ENV: Record<string, Env> = { q: 'prod', k: 'lab', p: 'prodV4', l: 'labV4' };
export const linkId4 = (env: Env, id: bigint | string) => `${LINK_PREFIX[env]}${id}`;
export const claimUrl4 = (origin: string, env: Env, id: bigint | string, seed: Uint8Array, kind: 'c' | 'pool' = 'c') =>
  `${origin}/${kind}/${linkId4(env, id)}#k=${bytesToHex(seed).slice(2)}`;

export const DROP_STATES = ['None', 'Open', 'Bound', 'Confirmed', 'Claimed', 'Cancelled', 'Refunded'] as const;
export type DropState = (typeof DROP_STATES)[number];
export interface DropLink4 {
  id: bigint; env: Env; sender: Hex; mode: 'Confirmed' | 'Open'; state: DropState; dripPaid: boolean; expiry: number; amount: bigint; drip: bigint;
  bindDeadline: number; relayerFee: bigint; recipient: Hex; payTo: Hex; linkKeyHash: Hex; recipientKeyHash: Hex;
}
export async function readDrop(env: Env, id: bigint): Promise<DropLink4 | null> {
  const l = (await pub.readContract({ address: INST[env].drop, abi: dropAbi, functionName: 'getLink', args: [id] })) as {
    sender: Hex; mode: number; state: number; dripPaid: boolean; expiry: bigint; amount: bigint; drip: bigint; bindDeadline: bigint; relayerFee: bigint;
    recipient: Hex; payTo: Hex; linkKeyHash: Hex; recipientKeyHash: Hex;
  };
  if (Number(l.state) === 0) return null;
  return {
    id, env, sender: l.sender, mode: Number(l.mode) === 0 ? 'Confirmed' : 'Open', state: DROP_STATES[Number(l.state)], dripPaid: l.dripPaid,
    expiry: Number(l.expiry), amount: l.amount, drip: l.drip, bindDeadline: Number(l.bindDeadline), relayerFee: l.relayerFee,
    recipient: l.recipient, payTo: l.payTo, linkKeyHash: l.linkKeyHash, recipientKeyHash: l.recipientKeyHash,
  };
}

export interface Pool4 { id: bigint; env: Env; host: Hex; perSlot: bigint; slots: number; taken: number; expiry: number; closed: boolean; linkKeyHash: Hex }
export async function readPool(env: Env, id: bigint): Promise<Pool4 | null> {
  const p = (await pub.readContract({ address: INST[env].pool, abi: poolAbi, functionName: 'getPool', args: [id] })) as {
    host: Hex; perSlot: bigint; slots: number; taken: number; expiry: bigint; closed: boolean; linkKeyHash: Hex;
  };
  if (/^0x0+$/.test(p.host)) return null;
  return { id, env, host: p.host, perSlot: p.perSlot, slots: Number(p.slots), taken: Number(p.taken), expiry: Number(p.expiry), closed: p.closed, linkKeyHash: p.linkKeyHash };
}
export const poolClaimed = (env: Env, id: bigint, who: Hex) =>
  pub.readContract({ address: INST[env].pool, abi: poolAbi, functionName: 'claimed', args: [id, who] }) as Promise<boolean>;

const KS = parseAbi(['function pqcKeyStatus(address) view returns (bool, uint8, bytes, bool)']);
export interface KeyStatus { registered: boolean; algoId: number; possessionProven: boolean }
export async function keyStatus(addr: Hex): Promise<KeyStatus> {
  const data = encodeFunctionData({ abi: KS, functionName: 'pqcKeyStatus', args: [addr] });
  const r = await pub.call({ to: '0x0000000000000000000000000000000000000a02', data });
  const [registered, algoId, , possessionProven] = decodeFunctionResult({ abi: KS, functionName: 'pqcKeyStatus', data: r.data ?? '0x' });
  return { registered, algoId: Number(algoId), possessionProven };
}

async function linkKey(seed: Uint8Array) { const { mldsa } = await import('@qorechain/pqc'); return mldsa.keygen(seed); }

/** bind(): signed by the LINK key (the seed in the URL fragment); the relayer submits; the drip lands in the recipient's key account. */
export async function bindDrop(env: Env, id: bigint, seed: Uint8Array, acct: KeyAccount, payTo: Hex): Promise<RouteResult> {
  const lk = await linkKey(seed);
  const keyHash = keyHashOfAccount(acct);
  const digest = dropBindDigest({ drop: INST[env].drop, id, recipient: acct.evm as Hex, keyHash, payTo });
  const sig = await signDigest(lk.secretKey, digest);
  return relayTo(env, INST[env].drop, encodeFunctionData({ abi: dropAbi, functionName: 'bind', args: [id, acct.evm as Hex, keyHash, payTo, bytesToHex(lk.publicKey), sig] }));
}
/** claim(): signed by the recipient's ML-DSA key; the amount is paid into payTo (the recipient's Pocket). */
export async function claimDrop(env: Env, id: bigint, acct: KeyAccount, payTo: Hex): Promise<RouteResult> {
  const digest = dropClaimDigest({ drop: INST[env].drop, id, recipient: acct.evm as Hex, payTo });
  const sig = await signDigest(acct.pqc.secretKey, digest);
  return relayTo(env, INST[env].drop, encodeFunctionData({ abi: dropAbi, functionName: 'claim', args: [id, sig] }));
}
/** The pool link key's signature for (pool, recipient, payTo): what the slot claim uses, and what proves a pool link to the sponsor. */
export async function poolLinkProof(env: Env, id: bigint, seed: Uint8Array, recipient: Hex, payTo: Hex): Promise<{ linkPk: Hex; linkSig: Hex }> {
  const lk = await linkKey(seed);
  return { linkPk: bytesToHex(lk.publicKey), linkSig: await signDigest(lk.secretKey, poolLinkDigest({ pool: INST[env].pool, id, recipient, payTo })) };
}
/** Pool slot: link-key signature plus the claimer's own signature, both over the pool digests. */
export async function claimPoolSlot(env: Env, id: bigint, seed: Uint8Array, acct: KeyAccount, payTo: Hex): Promise<RouteResult> {
  const lk = await linkKey(seed);
  const pool = INST[env].pool;
  const linkSig = await signDigest(lk.secretKey, poolLinkDigest({ pool, id, recipient: acct.evm as Hex, payTo }));
  const mySig = await signDigest(acct.pqc.secretKey, poolClaimDigest({ pool, id, recipient: acct.evm as Hex, payTo }));
  return postRoute({ env, target: pool, data: encodeFunctionData({ abi: poolAbi, functionName: 'claim', args: [id, acct.evm as Hex, payTo, bytesToHex(lk.publicKey), linkSig, mySig] }) });
}

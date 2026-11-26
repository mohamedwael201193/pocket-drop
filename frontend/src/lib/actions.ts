// Every real Pocket action: sign an ML-DSA intent in this browser, relay it through /api/route (PocketRouter).
import { encodeFunctionData, keccak256, parseAbi, type Hex } from 'viem';
import { ACT, finalizeDigest, freezeDigest, intentDigest, params, recoveryDigest } from './intents';
import { signDigest, keyHashOfAccount, type KeyAccount } from './identity';
import { bytesToHex, hexToBytes } from './protocol';
import { INST, chainTimestamp, dropCall, finalizeNeedsAuthorization, nextNonce, poolCall, relayTo, relayToPocket, vaultCall, type Env, type PocketCfg } from './v4';
import type { RouteResult } from './api';
import { vaultAbi } from './abi4';
import { pub } from './chain';
import { describeIntent } from './clearsign';
import { SignCancelled, reviewIntent } from './signReview';

export interface Ctx { env: Env; cfg: PocketCfg; address: Hex; acct: KeyAccount }

/** Sign one owner intent against the Pocket's CURRENT nonce (0 while undeployed) and relay it. Lazy-deploys the Pocket first if needed. */
async function owner(c: Ctx, action: Hex, p: Hex, fn: string, mk: (deadline: bigint, sig: Hex) => unknown[]): Promise<RouteResult> {
  const nonce = await nextNonce(c.address);
  const deadline = BigInt((await chainTimestamp()) + 3600);
  const digest = intentDigest({ action, vault: c.address, nonce, deadline, params: p });
  // clear signing: the user sees what these exact fields mean before the key signs their digest
  const clear = describeIntent({ action, vault: c.address, nonce, deadline, params: p });
  if (clear.digest !== digest) throw new Error('The readable summary does not match the hash to sign, so nothing was signed. Reload and try again.');
  if (!(await reviewIntent(clear))) throw new SignCancelled();
  const sig = await signDigest(c.acct.pqc.secretKey, digest);
  return relayToPocket(c.env, c.cfg, c.address, vaultCall(fn, mk(deadline, sig)));
}

export const spend = (c: Ctx, to: Hex, amount: bigint) => owner(c, ACT.SPEND, params.spend(to, amount), 'spend', (d, s) => [to, amount, d, s]);
export const vetoQueued = (c: Ctx, id: bigint) => owner(c, ACT.VETO_QUEUED, params.id(id), 'vetoQueued', (d, s) => [id, d, s]);
export const setLimit = (c: Ctx, v: bigint) => owner(c, ACT.SET_LIMIT, params.limit(v), 'setLimit', (d, s) => [v, d, s]);
export const setGuardians = (c: Ctx, g: Hex[], t: number) => owner(c, ACT.SET_GUARDIANS, params.guardians(g, t), 'setGuardians', (d, s) => [g, t, d, s]);
export const cancelPending = (c: Ctx) => owner(c, ACT.CANCEL_PENDING, params.none(), 'cancelPending', (d, s) => [d, s]);
export const vetoRecovery = (c: Ctx) => owner(c, ACT.VETO_RECOVERY, params.none(), 'vetoRecovery', (d, s) => [d, s]);
export const confirmDrop = (c: Ctx, id: bigint, expectedKeyHash: Hex) =>
  owner(c, ACT.CONFIRM_DROP, params.confirm(INST[c.env].drop, id, expectedKeyHash), 'confirmDrop', (d, s) => [INST[c.env].drop, id, expectedKeyHash, d, s]);
export const cancelDrop = (c: Ctx, id: bigint) => owner(c, ACT.CANCEL_DROP, params.cancel(INST[c.env].drop, id), 'cancelDrop', (d, s) => [INST[c.env].drop, id, d, s]);
export const closePool = (c: Ctx, id: bigint) => owner(c, ACT.CLOSE_POOL, params.closePool(INST[c.env].pool, id), 'closePool', (d, s) => [INST[c.env].pool, id, d, s]);

export interface DropParams { mode: 'Confirmed' | 'Open'; amount: bigint; drip: bigint; relayerFee: bigint; ttlSeconds: number }

/** Deterministic link seed: sha256(root | "|link|" | vault nonce). The same root always re-derives the link, so nothing has to be stored. */
export async function linkSeed(root: string, nonce: bigint): Promise<Uint8Array> {
  const data = new TextEncoder().encode(`${root}|link|${nonce}`);
  return new Uint8Array(await crypto.subtle.digest('SHA-256', data as unknown as BufferSource));
}
const linkKeyHashOf = async (seed: Uint8Array): Promise<Hex> => {
  const { mldsa } = await import('@qorechain/pqc');
  return keccak256(bytesToHex(mldsa.keygen(seed).publicKey));
};
export { linkKeyHashOf };

export async function createDrop(c: Ctx, root: string, p: DropParams): Promise<{ res: RouteResult; seed: Uint8Array; nonce: bigint; expiry: bigint }> {
  const nonce = await nextNonce(c.address);
  const seed = await linkSeed(root, nonce);
  const lkh = await linkKeyHashOf(seed);
  const expiry = BigInt((await chainTimestamp()) + p.ttlSeconds);
  const value = p.amount + p.drip + p.relayerFee;
  const mode = p.mode === 'Confirmed' ? 0 : 1;
  const drop = INST[c.env].drop;
  const res = await owner(c, ACT.CREATE_DROP, params.createDrop(drop, lkh, mode, expiry, p.drip, p.relayerFee, value), 'createDrop',
    (d, s) => [drop, lkh, mode, expiry, p.drip, p.relayerFee, value, d, s]);
  return { res, seed, nonce, expiry };
}

export async function createPool(c: Ctx, root: string, slots: number, perSlot: bigint, ttlSeconds: number): Promise<{ res: RouteResult; seed: Uint8Array; nonce: bigint }> {
  const nonce = await nextNonce(c.address);
  const seed = await linkSeed(root, nonce);
  const lkh = await linkKeyHashOf(seed);
  const expiry = BigInt((await chainTimestamp()) + ttlSeconds);
  const pool = INST[c.env].pool;
  const res = await owner(c, ACT.CREATE_POOL, params.createPool(pool, lkh, slots, perSlot, expiry), 'createPool', (d, s) => [pool, lkh, slots, perSlot, expiry, d, s]);
  return { res, seed, nonce };
}

/* ---- permissionless calls (no signature: anyone may trigger them once their condition holds) ---- */
export const executeQueued = (env: Env, pocket: Hex, id: bigint) => relayTo(env, pocket, vaultCall('executeQueued', [id]));
export const applyLimit = (env: Env, pocket: Hex) => relayTo(env, pocket, vaultCall('applyLimit', []));
export const applyGuardians = (env: Env, pocket: Hex) => relayTo(env, pocket, vaultCall('applyGuardians', []));
/* ---- finishing a recovery ---- */
const FINALIZE_V51 = parseAbi(['function finalizeRecovery()', 'function finalizeRecoveryUnanimous()']);

/** The digest `acct` signs to finish the pending recovery of a v5.2 Pocket. Computed here from the chain state and checked
 *  against the Pocket's own `finalizeDigest` view, so a mismatch stops before anything is signed. */
export async function finalizeAuthorization(pocket: Hex, unanimous: boolean, authorizer: Hex, deadline: bigint): Promise<Hex> {
  const read = <T,>(functionName: string, args: unknown[] = []) => pub.readContract({ address: pocket, abi: vaultAbi, functionName, args } as never) as Promise<T>;
  const [recNonce, newOwner, newKeyHash] = await Promise.all([
    read<bigint>('recoveryNonce'),
    read<Hex>(unanimous ? 'uRecoveryOwner' : 'recoveryOwner'),
    read<Hex>(unanimous ? 'uRecoveryKeyHash' : 'recoveryKeyHash'),
  ]);
  const local = finalizeDigest({ vault: pocket, unanimous, recNonce, newOwner, newKeyHash, authorizer, deadline });
  const onChain = await read<Hex>('finalizeDigest', [unanimous ? ACT.FINALIZE_RECOVERY_UNANIMOUS : ACT.FINALIZE_RECOVERY, authorizer, deadline]);
  if (onChain.toLowerCase() !== local.toLowerCase()) throw new Error('The recovery to finish does not match the chain state, so nothing was signed. Reload and try again.');
  return local;
}

/**
 * Finish a recovery after its delay. v5.2: the call carries an ML-DSA-87 authorization from the owner (threshold path only),
 * a guardian, or the approved new owner; this browser's key signs as the authorizer. Earlier generations take no arguments.
 */
export async function finalizeRecovery(env: Env, pocket: Hex, unanimous: boolean, acct?: KeyAccount | null): Promise<RouteResult> {
  const fn = unanimous ? 'finalizeRecoveryUnanimous' : 'finalizeRecovery';
  if (!finalizeNeedsAuthorization(env)) return relayTo(env, pocket, encodeFunctionData({ abi: FINALIZE_V51, functionName: fn }));
  if (!acct) throw new Error('Open your key first: finishing a recovery needs a signature from the owner, a guardian or the new owner.');
  const deadline = BigInt((await chainTimestamp()) + 3600);
  const digest = await finalizeAuthorization(pocket, unanimous, acct.evm as Hex, deadline);
  const sig = await signDigest(acct.pqc.secretKey, digest);
  return relayTo(env, pocket, vaultCall(fn, [acct.evm, deadline, sig]));
}
export const refundDrop = (env: Env, id: bigint) => relayTo(env, INST[env].drop, dropCall('refund', [id]));

/* ---------------- guardians: request -> share -> submit (every guardian signs on their own device) ---------------- */

export type GuardianKind = 'freeze' | 'recover' | 'recover-unanimous';
export interface GuardianRequest { v: 1; kind: GuardianKind; env: Env; pocket: Hex; nonce: string; deadline: string; newOwner?: Hex; newKeyHash?: Hex }
export interface GuardianShare extends GuardianRequest { signer: Hex; sig: Hex }

const b64e = (s: string) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64d = (s: string) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));
export const encodeCode = (prefix: 'pdreq1' | 'pdshare1' | 'pdnew1', o: unknown) => `${prefix}.${b64e(JSON.stringify(o))}`;
export function decodeCode<T>(prefix: 'pdreq1' | 'pdshare1' | 'pdnew1', text: string): T {
  const m = new RegExp(`${prefix}\\.([A-Za-z0-9_-]+)`).exec(text.trim());
  if (!m) throw new Error('That is not a valid code.');
  try { return JSON.parse(b64d(m[1])) as T; } catch { throw new Error('That code is damaged. Copy it again in full.'); }
}

/** What the friend (on a new key) shares so guardians know who to hand the Pocket to. */
export const newOwnerCode = (acct: KeyAccount) => encodeCode('pdnew1', { owner: acct.evm, keyHash: keyHashOfAccount(acct) });

export async function makeRequest(a: { kind: GuardianKind; env: Env; pocket: Hex; newOwner?: Hex; newKeyHash?: Hex }): Promise<GuardianRequest> {
  const read = <T,>(fn: string) => pub.readContract({ address: a.pocket, abi: vaultAbi, functionName: fn } as never) as Promise<T>;
  const nonce = a.kind === 'freeze' ? await read<bigint>('freezeNonce') : await read<bigint>('recoveryNonce');
  const deadline = BigInt((await chainTimestamp()) + 3600);
  return { v: 1, kind: a.kind, env: a.env, pocket: a.pocket, nonce: nonce.toString(), deadline: deadline.toString(), newOwner: a.newOwner, newKeyHash: a.newKeyHash };
}

export function requestDigest(r: GuardianRequest): Hex {
  if (r.kind === 'freeze') return freezeDigest({ vault: r.pocket, nonce: BigInt(r.nonce), deadline: BigInt(r.deadline) });
  if (!r.newOwner || !r.newKeyHash) throw new Error('A recovery request needs the new owner and key hash.');
  return recoveryDigest({ vault: r.pocket, recNonce: BigInt(r.nonce), newOwner: r.newOwner, newKeyHash: r.newKeyHash, deadline: BigInt(r.deadline), unanimous: r.kind === 'recover-unanimous' });
}

export async function signRequest(r: GuardianRequest, acct: KeyAccount): Promise<GuardianShare> {
  const sig = await signDigest(acct.pqc.secretKey, requestDigest(r));
  return { ...r, signer: acct.evm as Hex, sig };
}

/** Validate a set of shares against the chain (same request, distinct guardians, enough of them) and submit the matching call. */
export async function submitShares(shares: GuardianShare[]): Promise<RouteResult> {
  if (!shares.length) throw new Error('Paste at least one signature share.');
  const f = shares[0];
  for (const s of shares) {
    if (s.kind !== f.kind || s.pocket.toLowerCase() !== f.pocket.toLowerCase() || s.nonce !== f.nonce || s.deadline !== f.deadline || s.newOwner !== f.newOwner || s.newKeyHash !== f.newKeyHash || s.env !== f.env) {
      throw new Error('These shares are for different requests. Every guardian must sign the same request code.');
    }
  }
  const signers = shares.map((s) => s.signer);
  if (new Set(signers.map((x) => x.toLowerCase())).size !== signers.length) throw new Error('The same guardian is listed twice.');
  const sigs = shares.map((s) => s.sig);
  const data = f.kind === 'freeze'
    ? vaultCall('guardianFreeze', [signers, sigs, BigInt(f.nonce), BigInt(f.deadline)])
    : vaultCall(f.kind === 'recover' ? 'proposeRecovery' : 'proposeRecoveryUnanimous', [f.newOwner, f.newKeyHash, BigInt(f.deadline), signers, sigs]);
  return relayTo(f.env, f.pocket, data);
}

export { hexToBytes, poolCall, dropCall };

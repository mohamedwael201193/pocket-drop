// The browser key path: one random 32-byte root per person, kept in this browser (and exportable as a backup string).
//   secp256k1 key = root        -> the "key account" that owns the Pocket and pays the one-time PQ registration fee
//   ML-DSA-87 key = sha256(root | "|mldsa87")   -> signs every Pocket intent
// The Pocket itself (where the money lives) is a counterfactual ERC-1271 vault owned by that key account.
import type { Hex } from 'viem';
import { bytesToHex, hexToBytes, keyHashOf } from './protocol';
import { pqMessageBytes } from './intents';

const ROOT_KEY = 'pd.root.v4';
const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
  del: (k: string) => { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

export const loadRoot = (): string | null => {
  const v = store.get(ROOT_KEY);
  return v && /^[0-9a-f]{64}$/.test(v) ? v : null;
};
export function createRoot(): string {
  const r = bytesToHex(crypto.getRandomValues(new Uint8Array(32))).slice(2);
  store.set(ROOT_KEY, r);
  return r;
}
export function importRoot(raw: string): string {
  const v = raw.trim().replace(/^0x/, '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(v)) throw new Error('A backup key is 64 hex characters.');
  store.set(ROOT_KEY, v);
  return v;
}
export const forgetRoot = () => store.del(ROOT_KEY);

export type KeyAccount = Awaited<ReturnType<(typeof import('./recipient'))['deriveRecipient']>>;
const cache = new Map<string, Promise<KeyAccount>>();
/** Derive the secp + ML-DSA account from a root (loads the QoreChain SDK on first use). */
export function deriveAccount(root: string): Promise<KeyAccount> {
  let p = cache.get(root);
  if (!p) { p = import('./recipient').then((m) => m.deriveRecipient(hexToBytes(root))); cache.set(root, p); }
  return p;
}

/** Sign a digest with an ML-DSA key over the QoreX-compatible message ("qorechain-msg-v1|qorechain-diana|0x…"). */
export async function signDigest(secretKey: Uint8Array, digest: Hex): Promise<Hex> {
  const { mldsa } = await import('@qorechain/pqc');
  return bytesToHex(mldsa.sign(secretKey, pqMessageBytes(digest)));
}
export const keyHashOfAccount = (a: KeyAccount): Hex => keyHashOf(a.pqc.publicKey);

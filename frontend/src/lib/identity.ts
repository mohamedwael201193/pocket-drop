// The browser key path: one random 32-byte root per person, kept in this browser (and exportable as a backup string).
// New roots are v2 ("pd2:<64 hex>", a master seed): the secp256k1 key and the ML-DSA-87 secret are two independent
// one-way hashes of it (see keyderive.ts), so a stolen or quantum-recovered classical key does not give the ML-DSA key.
// Legacy roots (bare 64 hex, before 20 Nov 2026) still load: there the secp key IS the root, which is why the Pocket
// page offers to move a legacy Pocket to a new v2 key.
//   secp256k1 key  -> the "key account" that owns the Pocket and pays the one-time PQ registration fee
//   ML-DSA-87 key  -> signs every Pocket intent
// The Pocket itself (where the money lives) is a counterfactual ERC-1271 vault owned by that key account.
import type { Hex } from 'viem';
import { bytesToHex, keyHashOf } from './protocol';
import { pqMessageBytes } from './intents';
import { formatRoot, newV2Root, parseRoot } from './keyderive';

const ROOT_KEY = 'pd.root.v4';
const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
  del: (k: string) => { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

/** Event fired on window whenever this tab changes the stored root, so the account context can follow. */
export const ROOT_EVENT = 'pd-root-changed';
const announce = () => { try { window.dispatchEvent(new Event(ROOT_EVENT)); } catch { /* not in a browser */ } };

export const loadRoot = (): string | null => {
  const v = store.get(ROOT_KEY);
  const p = v ? parseRoot(v) : null;
  return p ? formatRoot(p) : null;
};
/** The key of this browser: returns the stored root, and creates one only when none exists.
 *  It never replaces an existing root: that root may own a funded Pocket (a claim or pool page may have created it). */
export function createRoot(): string {
  const existing = loadRoot();
  if (existing) return existing;
  const r = newV2Root();
  store.set(ROOT_KEY, r);
  announce();
  return r;
}

export function importRoot(raw: string, opts: { replace?: boolean } = {}): string {
  const p = parseRoot(raw);
  if (!p) throw new Error('A backup key is "pd2:" followed by 64 hex characters (older backups: 64 hex characters).');
  const v = formatRoot(p);
  const existing = loadRoot();
  if (existing && existing !== v && !opts.replace) throw new Error('This browser already holds a different key. Back it up first, then confirm the replacement.');
  store.set(ROOT_KEY, v);
  announce();
  return v;
}
export const forgetRoot = () => { store.del(ROOT_KEY); announce(); };

/* Legacy-key upgrade bookkeeping. The new v2 root is stored BEFORE any money moves to it, so a closed tab never strands
   funds; the old root is kept after the switch so the user can still open the legacy Pocket. */
const NEXT_KEY = 'pd.root.next.v5';
const LEGACY_LIST = 'pd.root.legacy.v4';
export const pendingUpgradeRoot = (): string => {
  const cur = store.get(NEXT_KEY); const p = cur ? parseRoot(cur) : null;
  if (p && p.version === 2) return formatRoot(p);
  const r = newV2Root(); store.set(NEXT_KEY, r); return r;
};
export const legacyRoots = (): string[] => { try { return JSON.parse(store.get(LEGACY_LIST) || '[]'); } catch { return []; } };
/** Switch this browser to the pending v2 root, remembering the legacy one. */
export function finishUpgrade(legacy: string): string {
  const next = pendingUpgradeRoot();
  const list = [...new Set([...legacyRoots(), legacy])];
  store.set(LEGACY_LIST, JSON.stringify(list));
  store.set(ROOT_KEY, next);
  store.del(NEXT_KEY);
  announce();
  return next;
}
export const ROOT_STORAGE_KEY = ROOT_KEY;

export type KeyAccount = Awaited<ReturnType<(typeof import('./recipient'))['deriveRecipient']>>;
const cache = new Map<string, Promise<KeyAccount>>();
/** Derive the secp + ML-DSA account from a root (loads the QoreChain SDK on first use). */
export function deriveAccount(root: string): Promise<KeyAccount> {
  let p = cache.get(root);
  if (!p) { p = import('./recipient').then((m) => m.deriveFromRoot(root)); cache.set(root, p); }
  return p;
}

/** Sign a digest with an ML-DSA key over the QoreX-compatible message ("qorechain-msg-v1|qorechain-diana|0x…"). */
export async function signDigest(secretKey: Uint8Array, digest: Hex): Promise<Hex> {
  const { mldsa } = await import('@qorechain/pqc');
  return bytesToHex(mldsa.sign(secretKey, pqMessageBytes(digest)));
}
export const keyHashOfAccount = (a: KeyAccount): Hex => keyHashOf(a.pqc.publicKey);

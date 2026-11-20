// At-rest wrapping of the browser key (the pd2 master, the pending upgrade root and legacy roots).
// A random AES-256-GCM key is generated with extractable=false and kept in IndexedDB; localStorage only ever holds
// "pdv1:<iv>:<ciphertext>". Page script on this origin can still ask the browser to decrypt (that is how the app works),
// so this defends against storage scraping (disk images, backups, profile sync, extensions or tools that read
// localStorage files), not against code running in this origin. See THREAT_MODEL.md.
//
// The app reads keys synchronously, so `unlockVault()` runs once before the first render and fills an in-memory cache.
// Writes go to the cache at once, then to localStorage as plaintext synchronously (a closed tab never loses a new key),
// then the plaintext is replaced by ciphertext as soon as encryption finishes. The next unlock migrates any plaintext left.
export const VAULT_KEYS = ['pd.root.v4', 'pd.root.next.v5', 'pd.root.legacy.v4'] as const;
export const ENC_PREFIX = 'pdv1:';
const DB = 'pd-vault', STORE = 'keys', KEY_ID = 'root-wrap-v1';
export type VaultMode = 'encrypted' | 'plaintext' | 'locked';

const cache = new Map<string, string | null>();
let aes: CryptoKey | null = null;
let mode: VaultMode = 'plaintext';
let unlocked = false;
export const vaultMode = () => mode;
export const isVaultKey = (k: string) => (VAULT_KEYS as readonly string[]).includes(k);

const ls = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
  del: (k: string) => { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};
const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

function idb<T>(fn: (s: IDBObjectStore) => IDBRequest<T>, write = false): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => { open.result.createObjectStore(STORE); };
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction(STORE, write ? 'readwrite' : 'readonly');
      const req = fn(tx.objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => db.close();
    };
  });
}

/** The wrapping key: loaded from IndexedDB, or generated non-extractable and stored there on first use. */
export async function wrappingKey(): Promise<CryptoKey> {
  const have = await idb<CryptoKey | undefined>((s) => s.get(KEY_ID));
  if (have) return have;
  const k = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  await idb((s) => s.add(k, KEY_ID), true).catch(() => undefined); // another tab may have won the race
  return (await idb<CryptoKey | undefined>((s) => s.get(KEY_ID))) ?? k;
}

const AD = new TextEncoder().encode('pocketdrop/vault/v1');
export async function seal(key: CryptoKey, name: string, plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new Uint8Array([...AD, ...new TextEncoder().encode(name)]) }, key, new TextEncoder().encode(plain)));
  return `${ENC_PREFIX}${b64(iv)}:${b64(ct)}`;
}
export async function open(key: CryptoKey, name: string, sealed: string): Promise<string> {
  const [iv, ct] = sealed.slice(ENC_PREFIX.length).split(':');
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv), additionalData: new Uint8Array([...AD, ...new TextEncoder().encode(name)]) }, key, unb64(ct));
  return new TextDecoder().decode(pt);
}

async function absorb(k: string, raw: string | null): Promise<void> {
  if (raw === null) { cache.set(k, null); return; }
  if (!raw.startsWith(ENC_PREFIX)) { // plaintext: use it now, encrypt it in place
    cache.set(k, raw);
    if (aes) { const s = await seal(aes, k, raw); if (ls.get(k) === raw) ls.set(k, s); }
    return;
  }
  if (!aes) { cache.set(k, null); mode = 'locked'; return; }
  try { cache.set(k, await open(aes, k, raw)); } catch {
    // Ciphertext we cannot open (its IndexedDB key is gone). Keep it aside, never overwrite it silently.
    ls.set(`${k}.undecryptable`, raw); cache.set(k, null); mode = 'locked';
  }
}

/** Load the wrapping key, decrypt (or migrate) every stored key into memory. Safe to call more than once. */
export async function unlockVault(): Promise<VaultMode> {
  if (unlocked) return mode;
  try {
    if (typeof indexedDB === 'undefined' || !globalThis.crypto?.subtle) throw new Error('no IndexedDB or WebCrypto');
    aes = await Promise.race([wrappingKey(), new Promise<never>((_, rej) => setTimeout(() => rej(new Error('IndexedDB timeout')), 4000))]);
    mode = 'encrypted';
  } catch { aes = null; mode = 'plaintext'; }
  for (const k of VAULT_KEYS) await absorb(k, ls.get(k));
  unlocked = true;
  if (typeof window !== 'undefined') window.addEventListener('storage', (e) => {
    if (e.key === null) { for (const k of VAULT_KEYS) void absorb(k, ls.get(k)).then(() => window.dispatchEvent(new Event('pd-root-changed'))); return; }
    if (!isVaultKey(e.key)) return;
    const raw = e.newValue;
    if (raw === null || !raw.startsWith(ENC_PREFIX)) cache.set(e.key, raw); // synchronous, so listeners that run next see it
    void absorb(e.key, raw).then(() => window.dispatchEvent(new Event('pd-root-changed')));
  });
  return mode;
}

export function vaultGet(k: string): string | null {
  if (!unlocked) return ls.get(k)?.startsWith(ENC_PREFIX) ? null : ls.get(k);
  return cache.get(k) ?? null;
}
export function vaultSet(k: string, v: string): void {
  cache.set(k, v);
  ls.set(k, v);
  if (aes) void seal(aes, k, v).then((s) => { if (cache.get(k) === v) ls.set(k, s); }).catch(() => undefined);
}
export function vaultDel(k: string): void { cache.set(k, null); ls.del(k); }

/** Test hook: forget everything in memory. */
export function resetVaultForTests() { cache.clear(); aes = null; mode = 'plaintext'; unlocked = false; }

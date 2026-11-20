// The browser key at rest: non-extractable AES-GCM key in IndexedDB, ciphertext in localStorage, plaintext migrated.
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';

class MemStorage {
  m = new Map<string, string>();
  get length() { return this.m.size; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
}
(globalThis as any).localStorage = new MemStorage();
(globalThis as any).window = Object.assign(new EventTarget(), { localStorage: (globalThis as any).localStorage });

const V = await import('../src/lib/vault');
const ID = await import('../src/lib/identity');
const settle = () => new Promise((r) => setTimeout(r, 30));
const R2 = 'pd2:' + 'cd'.repeat(32);
const R1 = 'ab'.repeat(32);

beforeEach(async () => {
  (globalThis as any).localStorage.clear();
  V.resetVaultForTests();
  await new Promise<void>((r) => { const q = indexedDB.deleteDatabase('pd-vault'); q.onsuccess = q.onerror = () => r(); });
});

describe('vault', () => {
  it('generates a non-extractable AES-GCM key and refuses to export it', async () => {
    const k = await V.wrappingKey();
    expect(k.extractable).toBe(false);
    expect(k.algorithm).toMatchObject({ name: 'AES-GCM', length: 256 });
    await expect(crypto.subtle.exportKey('raw', k)).rejects.toThrow();
    expect((await V.wrappingKey()).algorithm).toEqual(k.algorithm); // same key on the next load
  });
  it('migrates a plaintext v2 master and a legacy root list to ciphertext, and still reads them', async () => {
    localStorage.setItem('pd.root.v4', R2);
    localStorage.setItem('pd.root.legacy.v4', JSON.stringify([R1]));
    expect(await V.unlockVault()).toBe('encrypted');
    await settle();
    for (const k of ['pd.root.v4', 'pd.root.legacy.v4']) expect(localStorage.getItem(k)!.startsWith(V.ENC_PREFIX)).toBe(true);
    expect(localStorage.getItem('pd.root.v4')).not.toContain('cd'.repeat(8));
    expect(ID.loadRoot()).toBe(R2);
    expect(ID.legacyRoots()).toEqual([R1]);
  });
  it('migrates a bare legacy (v1) root and reads it back after a reload', async () => {
    localStorage.setItem('pd.root.v4', R1);
    await V.unlockVault(); await settle();
    expect(localStorage.getItem('pd.root.v4')!.startsWith(V.ENC_PREFIX)).toBe(true);
    V.resetVaultForTests(); // a new page load: same IndexedDB key, only ciphertext on disk
    await V.unlockVault();
    expect(ID.loadRoot()).toBe(R1);
  });
  it('writes a new key in plaintext first (a closed tab never loses it), then replaces it with ciphertext', async () => {
    await V.unlockVault();
    const r = ID.createRoot();
    expect(localStorage.getItem('pd.root.v4')).toBe(r);
    await settle();
    expect(localStorage.getItem('pd.root.v4')!.startsWith(V.ENC_PREFIX)).toBe(true);
    expect(ID.loadRoot()).toBe(r);
    expect(ID.createRoot()).toBe(r); // never replaced
  });
  it('binds each ciphertext to its storage key (no swapping values between keys)', async () => {
    const k = await V.wrappingKey();
    const s = await V.seal(k, 'pd.root.v4', R2);
    expect(await V.open(k, 'pd.root.v4', s)).toBe(R2);
    await expect(V.open(k, 'pd.root.next.v5', s)).rejects.toThrow();
  });
  it('keeps ciphertext it cannot open aside instead of overwriting it', async () => {
    const other = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    const foreign = await V.seal(other, 'pd.root.v4', R2);
    localStorage.setItem('pd.root.v4', foreign);
    expect(await V.unlockVault()).toBe('locked');
    expect(ID.loadRoot()).toBeNull();
    expect(localStorage.getItem('pd.root.v4.undecryptable')).toBe(foreign);
  });
  it('falls back to plaintext storage when IndexedDB is unavailable', async () => {
    const saved = (globalThis as any).indexedDB; (globalThis as any).indexedDB = undefined;
    try {
      expect(await V.unlockVault()).toBe('plaintext');
      const r = ID.createRoot(); await settle();
      expect(localStorage.getItem('pd.root.v4')).toBe(r);
    } finally { (globalThis as any).indexedDB = saved; }
  });
});

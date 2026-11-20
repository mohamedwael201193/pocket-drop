// E2E helper: the browser key is stored wrapped (see src/lib/vault.ts). Read it the way the app does: inside the page,
// with the non-extractable IndexedDB key. Plaintext (written just now, not yet sealed) is returned as is.
import type { Page } from '@playwright/test';

export async function readRoot(page: Page, name = 'pd.root.v4'): Promise<string | null> {
  return page.evaluate(async (k) => {
    const raw = localStorage.getItem(k);
    if (!raw || !raw.startsWith('pdv1:')) return raw;
    const key: CryptoKey = await new Promise((res, rej) => {
      const o = indexedDB.open('pd-vault', 1);
      o.onerror = () => rej(o.error);
      o.onsuccess = () => { const r = o.result.transaction('keys').objectStore('keys').get('root-wrap-v1'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); };
    });
    const [iv, ct] = raw.slice(5).split(':');
    const u = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
    const ad = new TextEncoder().encode('pocketdrop/vault/v1' + k);
    return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: u(iv), additionalData: ad }, key, u(ct)));
  }, name);
}
/** True once the stored value is ciphertext (the vault sealed it). */
export const isSealed = (page: Page, name = 'pd.root.v4') => page.evaluate((k) => (localStorage.getItem(k) ?? '').startsWith('pdv1:'), name);

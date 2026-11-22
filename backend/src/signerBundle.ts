// Loads the pre-bundled hybrid signer (vendor/sponsor-signer.mjs, built by scripts/bundle-signer.mjs) by file URL, so the
// Vercel runtime never require()s the ESM-only @noble/@scure packages behind @qorechain/sdk.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export type SignerMod = typeof import('./sponsorSigner.js');
let signerP: Promise<SignerMod> | null = null;

export const loadSigner = (): Promise<SignerMod> => (signerP ??= (async () => {
  const cands = [path.join(process.cwd(), 'vendor', 'sponsor-signer.mjs')];
  try { cands.push(fileURLToPath(new URL('../vendor/sponsor-signer.mjs', import.meta.url))); } catch { /* no file URL */ }
  const file = cands.find((c) => existsSync(c));
  if (!file) { signerP = null; throw new Error('hybrid signer bundle missing'); }
  return (await import(pathToFileURL(file).href)) as SignerMod;
})());

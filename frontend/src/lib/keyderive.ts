// Browser key derivation. Pure functions (no SDK, no storage) so they can be unit-tested.
//
// v1 (legacy, roots created before 20 Nov 2026): the stored root IS the secp256k1 private key and the ML-DSA-87 secret
//   is sha256(root | "|mldsa87"). Whoever learns the classical key (a leak, or a quantum computer working from the
//   public key) can compute the ML-DSA key, so v1 gives no post-quantum protection. Kept only so old Pockets stay usable.
// v2 (every new root): the stored value is a 32-byte MASTER that never leaves the browser and never touches the chain.
//   secp256k1 key = sha256("pocketdrop/key/v2/secp256k1" | master | counter)
//   ML-DSA secret = sha256("pocketdrop/key/v2/mldsa87"   | master)
//   Both are one-way and domain-separated: neither leaf reveals the master or the other leaf.
import { sha256, type Hex } from 'viem';

export const V2_PREFIX = 'pd2:';
export const SECP_TAG = 'pocketdrop/key/v2/secp256k1';
export const MLDSA_TAG = 'pocketdrop/key/v2/mldsa87';
const SECP_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const enc = new TextEncoder();

export type RootVersion = 1 | 2;
export interface ParsedRoot { version: RootVersion; bytes: Uint8Array }

const isHex64 = (s: string) => /^[0-9a-f]{64}$/.test(s);
const toBytes = (hex: string) => Uint8Array.from(hex.match(/../g)!.map((b) => parseInt(b, 16)));
const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const cat = (...parts: Uint8Array[]) => { const o = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let i = 0; for (const p of parts) { o.set(p, i); i += p.length; } return o; };
const h = (b: Uint8Array) => toBytes((sha256(b) as Hex).slice(2));

/** A stored or typed root: `pd2:<64 hex>` (v2) or a bare 64-hex legacy root (v1). Returns null when it is neither. */
export function parseRoot(raw: string): ParsedRoot | null {
  const v = raw.trim().toLowerCase();
  if (v.startsWith(V2_PREFIX)) { const x = v.slice(V2_PREFIX.length); return isHex64(x) ? { version: 2, bytes: toBytes(x) } : null; }
  const x = v.replace(/^0x/, '');
  return isHex64(x) ? { version: 1, bytes: toBytes(x) } : null;
}
/** Canonical string for storage and backups. */
export const formatRoot = (p: ParsedRoot) => (p.version === 2 ? V2_PREFIX : '') + toHex(p.bytes);
export const isLegacyRoot = (raw: string | null | undefined) => !!raw && parseRoot(raw)?.version === 1;
export const newV2Root = (random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))) => V2_PREFIX + toHex(random(32));

/** v2: secp256k1 private key from the master (re-hashed with a counter in the ~2^-128 case that it is out of range). */
export function v2SecpKey(master: Uint8Array): Uint8Array {
  for (let c = 0; c < 256; c++) {
    const k = h(cat(enc.encode(SECP_TAG), master, Uint8Array.of(c)));
    const n = BigInt('0x' + toHex(k));
    if (n > 0n && n < SECP_N) return k;
  }
  throw new Error('unreachable: no valid secp256k1 key');
}
/** v2: the 32-byte ML-DSA-87 secret (passed to the SDK as `pqcSecret`). */
export const v2PqcSecret = (master: Uint8Array) => h(cat(enc.encode(MLDSA_TAG), master));
/** v1 (legacy): secp key = root, ML-DSA secret = sha256(root | "|mldsa87"). */
export const v1PqcSecret = (root: Uint8Array) => h(cat(root, enc.encode('|mldsa87')));

/** The two independent secrets the SDK needs, for either root version. */
export function keyMaterial(p: ParsedRoot): { secp: Uint8Array; pqcSecret: Uint8Array } {
  return p.version === 2 ? { secp: v2SecpKey(p.bytes), pqcSecret: v2PqcSecret(p.bytes) } : { secp: p.bytes, pqcSecret: v1PqcSecret(p.bytes) };
}

// Strict, hand-validated decoder for the raw return data of the QoreChain key-status precompile
//   pqcKeyStatus(address) returns (bool registered, uint8 algoId, bytes pubkey, bool possessionProven)   at 0x...0a02
// It is stricter than the on-chain PqcLib.keyStatus (contracts-v4/src/PqcLib.sol): it accepts only the canonical ABI
// layout the Diana precompile returns (RECORDED in contracts-v4/test/fixtures/keystatus/live-diana.json) and rejects
// everything else instead of guessing. Both decoders are run against the same vectors
// (contracts-v4/test/fixtures/keystatus/vectors.json): in Foundry (PqcLib) and in vitest (this file).
// No imports on purpose: the backend keeps a byte-identical copy (backend/src/keystatus.ts, checked by a test).

/** ML-DSA-87 sizes (FIPS 204). */
export const ML_DSA_87_PK_BYTES = 2592;
export const ML_DSA_87_SIG_BYTES = 4627;
/** Algorithm id of ML-DSA-87 in the key registry. */
export const ALGO_ML_DSA_87 = 1;

export type KeyStatusReject =
  | 'not-hex' | 'short' | 'unaligned' | 'bool-registered' | 'bool-proven' | 'algo-range' | 'offset'
  | 'length-out-of-buffer' | 'trailing-bytes' | 'padding-not-zero' | 'pk-length' | 'unregistered-with-key';

export type StrictKeyStatus =
  | { ok: false; reason: KeyStatusReject }
  | { ok: true; registered: boolean; algoId: number; proven: boolean; pubkey: Uint8Array };

function hexToBytes(raw: string): Uint8Array | null {
  const h = raw.startsWith('0x') || raw.startsWith('0X') ? raw.slice(2) : raw;
  if (h.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(h)) return null;
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(2 * i, 2 * i + 2), 16);
  return out;
}

/** Big-endian 32-byte word at byte offset `at` as a bigint. */
function word(b: Uint8Array, at: number): bigint {
  let v = 0n;
  for (let i = 0; i < 32; i++) v = (v << 8n) | BigInt(b[at + i]);
  return v;
}

/**
 * Decode `pqcKeyStatus` return data. Rules (any failure -> ok: false with the reason):
 * head words registered and possessionProven are exactly 0 or 1; algoId fits uint8; the bytes offset is exactly 0x80;
 * the length word and the padded key fit the buffer, with nothing after them and zero padding; an unregistered account
 * carries no key; a registered ML-DSA-87 key is exactly 2592 bytes.
 */
export function decodeKeyStatusStrict(raw: string): StrictKeyStatus {
  const b = hexToBytes(raw);
  if (!b) return { ok: false, reason: 'not-hex' };
  if (b.length < 160) return { ok: false, reason: 'short' };
  if (b.length % 32 !== 0) return { ok: false, reason: 'unaligned' };
  const registered = word(b, 0);
  const algo = word(b, 32);
  const offset = word(b, 64);
  const proven = word(b, 96);
  if (registered > 1n) return { ok: false, reason: 'bool-registered' };
  if (proven > 1n) return { ok: false, reason: 'bool-proven' };
  if (algo > 255n) return { ok: false, reason: 'algo-range' };
  if (offset !== 0x80n) return { ok: false, reason: 'offset' };
  const len = word(b, 128);
  if (len > BigInt(b.length - 160)) return { ok: false, reason: 'length-out-of-buffer' };
  const n = Number(len);
  const padded = Math.ceil(n / 32) * 32;
  if (160 + padded > b.length) return { ok: false, reason: 'length-out-of-buffer' };
  if (160 + padded !== b.length) return { ok: false, reason: 'trailing-bytes' };
  for (let i = 160 + n; i < b.length; i++) if (b[i] !== 0) return { ok: false, reason: 'padding-not-zero' };
  if (registered === 0n && n !== 0) return { ok: false, reason: 'unregistered-with-key' };
  if (registered === 1n && Number(algo) === ALGO_ML_DSA_87 && n !== ML_DSA_87_PK_BYTES) return { ok: false, reason: 'pk-length' };
  return { ok: true, registered: registered === 1n, algoId: Number(algo), proven: proven === 1n, pubkey: b.slice(160, 160 + n) };
}

/** True only for a registered, possession-proven ML-DSA-87 key of the exact size: what the contracts accept. */
export const isUsableKey = (s: StrictKeyStatus): s is Extract<StrictKeyStatus, { ok: true }> =>
  s.ok && s.registered && s.algoId === ALGO_ML_DSA_87 && s.proven && s.pubkey.length === ML_DSA_87_PK_BYTES;

#!/usr/bin/env node
// Real ML-DSA-87 for Foundry tests through vm.ffi (profile `realcrypto`, see foundry.toml and test-real/).
// Nothing here is mocked: keys, signatures and verification are FIPS 204 ML-DSA-87 from two independent libraries.
//
//   node script/ffi/mldsa.mjs keygen <seed32hex>            -> abi.encode(bytes publicKey)
//   node script/ffi/mldsa.mjs sign   <seed32hex> <msghex>   -> abi.encode(bytes signature)
//   node script/ffi/mldsa.mjs verify <pkhex> <sighex> <msghex> -> abi.encode(bool valid)
//
// sign: signs with @qorechain/pqc and refuses to print a signature that @qorechain/qoresign does not accept.
// verify: true only if BOTH @qorechain/pqc mldsa.verify and @qorechain/qoresign pqVerify return true. A library that
//   throws (bad sizes, malformed input) counts as false. If the two libraries disagree the script exits 2, which fails
//   the calling test, so a library bug can never pass silently.
// Output is a 0x hex string, which forge decodes to bytes.
import { mldsa } from '@qorechain/pqc';
import { pqVerify } from '@qorechain/qoresign';

const unhex = (h) => {
  const s = h.startsWith('0x') ? h.slice(2) : h;
  if (s.length % 2 !== 0 || /[^0-9a-fA-F]/.test(s)) throw new Error('bad hex');
  return Uint8Array.from(Buffer.from(s, 'hex'));
};
const word = (n) => BigInt(n).toString(16).padStart(64, '0');
const encBytes = (b) => {
  const hex = Buffer.from(b).toString('hex');
  return '0x' + word(32) + word(b.length) + hex.padEnd(Math.ceil(hex.length / 64) * 64, '0');
};
const encBool = (v) => '0x' + word(v ? 1 : 0);
const safe = (f) => { try { return f() === true; } catch { return false; } };

const [cmd, a, b, c] = process.argv.slice(2);
if (cmd === 'keygen') {
  const seed = unhex(a);
  if (seed.length !== 32) throw new Error('seed must be 32 bytes');
  process.stdout.write(encBytes(mldsa.keygen(seed).publicKey));
} else if (cmd === 'sign') {
  const kp = mldsa.keygen(unhex(a));
  const msg = unhex(b ?? '0x');
  const sig = mldsa.sign(kp.secretKey, msg);
  if (!pqVerify(kp.publicKey, msg, sig)) { process.stderr.write('qoresign rejected a fresh signature\n'); process.exit(2); }
  process.stdout.write(encBytes(sig));
} else if (cmd === 'verify') {
  const pk = unhex(a); const sig = unhex(b); const msg = unhex(c ?? '0x');
  const v1 = safe(() => mldsa.verify(pk, msg, sig));
  const v2 = safe(() => pqVerify(pk, msg, sig));
  if (v1 !== v2) { process.stderr.write(`library disagreement: pqc=${v1} qoresign=${v2}\n`); process.exit(2); }
  process.stdout.write(encBool(v1));
} else {
  process.stderr.write('usage: mldsa.mjs keygen|sign|verify ...\n');
  process.exit(1);
}

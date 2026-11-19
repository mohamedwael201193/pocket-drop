// Independently re-verifies every fixture with the real ML-DSA-87 verifier and checks that wrong-key and bit-flipped
// inputs are rejected: proves the Foundry mock's accept list holds only real valid triples.
//   node script/verify-fixtures.mjs
import fs from 'node:fs';
import { mldsa } from '@qorechain/pqc';
import { tripleHash, unhex } from './fixtures-lib.mjs';

const dir = new URL('../test/fixtures/', import.meta.url);
const keys = JSON.parse(fs.readFileSync(new URL('keys.json', dir), 'utf8'));
const names = Object.keys(keys.pks);
let ok = 0;
let bad = 0;
for (const group of ['vault', 'drops', 'pool', 'fuzz']) {
  for (const f of fs.readdirSync(new URL(`${group}/`, dir))) {
    const e = JSON.parse(fs.readFileSync(new URL(`${group}/${f}`, dir), 'utf8'));
    const pk = keys.pks[e.key];
    if (!mldsa.verify(unhex(pk), unhex(e.msg), unhex(e.sig))) { console.error('INVALID fixture', group, f); process.exit(1); }
    if (tripleHash(pk, e.sig, e.msg) !== e.h) { console.error('accept hash mismatch', group, f); process.exit(1); }
    ok++;
    const other = keys.pks[names[(names.indexOf(e.key) + 1) % names.length]];
    if (mldsa.verify(unhex(other), unhex(e.msg), unhex(e.sig))) { console.error('verifies under the wrong key', group, f); process.exit(1); }
    const flipped = Buffer.from(e.sig.slice(2), 'hex'); flipped[7] ^= 1;
    if (mldsa.verify(unhex(pk), unhex(e.msg), Uint8Array.from(flipped))) { console.error('bit flip still verifies', group, f); process.exit(1); }
    const m2 = Buffer.from(e.msg.slice(2), 'hex'); m2[m2.length - 1] ^= 1;
    if (mldsa.verify(unhex(pk), Uint8Array.from(m2), unhex(e.sig))) { console.error('mutated message still verifies', group, f); process.exit(1); }
    bad += 3;
  }
}
console.log(`OK: ${ok} fixtures re-verified with real ML-DSA-87; ${bad} negative checks (wrong key / bit flip / mutated message) all rejected`);

// Independently re-verifies every fixture against the real ML-DSA-87 verifier, and checks that wrong-key, wrong-message
// and bit-flipped inputs are rejected. Proves the Foundry mock's accept list holds only real valid triples.
//   node script/verify-fixtures.mjs
import fs from 'node:fs';
import { mldsa } from '@qorechain/pqc';
import { keccak256 } from 'viem';
import { NUM_LINKS, NUM_RECIPIENTS, bindMsg, claimMsg, tripleHash, unhex, linkKeyIndex } from './fixtures-lib.mjs';

const f = JSON.parse(fs.readFileSync(new URL('../test/fixtures/pqc.json', import.meta.url), 'utf8'));
const accepted = new Set(f.accepted);
let ok = 0;
let bad = 0;
const check = (pk, sig, msg, expect, label) => {
  const v = mldsa.verify(unhex(pk), unhex(msg), unhex(sig));
  if (v !== expect) { console.error('MISMATCH', label); process.exit(1); }
  if (expect) {
    ok++;
    if (!accepted.has(tripleHash(pk, sig, msg))) { console.error('valid triple missing from accept list', label); process.exit(1); }
  } else {
    bad++;
    if (accepted.has(tripleHash(pk, sig, msg))) { console.error('INVALID triple present in accept list', label); process.exit(1); }
  }
};
for (let id = 1; id <= NUM_LINKS; id++) {
  for (let r = 0; r < NUM_RECIPIENTS; r++) {
    const rh = keccak256(f.recipPks[r]);
    const bm = bindMsg({ linkId: id, recipient: f.recipAddrs[r], recipientKeyHash: rh });
    const cm = claimMsg({ linkId: id, recipient: f.recipAddrs[r] });
    check(f.linkPks[linkKeyIndex(id)], f.bindSigs[id - 1][r], bm, true, `bind ${id}/${r}`);
    check(f.recipPks[r], f.claimSigs[id - 1][r], cm, true, `claim ${id}/${r}`);
    check(f.linkPks[(linkKeyIndex(id) + 1) % 3], f.bindSigs[id - 1][r], bm, false, `bind wrong key ${id}/${r}`);
    check(f.recipPks[(r + 1) % 3], f.claimSigs[id - 1][r], cm, false, `claim wrong key ${id}/${r}`);
    const flipped = Buffer.from(f.claimSigs[id - 1][r].slice(2), 'hex');
    flipped[7] ^= 1;
    check(f.recipPks[r], '0x' + flipped.toString('hex'), cm, false, `claim flipped ${id}/${r}`);
    check(f.recipPks[r], f.claimSigs[id - 1][r], claimMsg({ linkId: id + 100, recipient: f.recipAddrs[r] }), false, `claim wrong link ${id}/${r}`);
  }
}
const w = f.wrong;
const rh0 = keccak256(f.recipPks[0]);
const L = f.linkPks[linkKeyIndex(1)];
const R = f.recipPks[0];
const realBind = bindMsg({ linkId: 1, recipient: f.recipAddrs[0], recipientKeyHash: rh0 });
const realClaim = claimMsg({ linkId: 1, recipient: f.recipAddrs[0] });
check(L, w.bindDomain, bindMsg({ domain: 'POCKETDROP_BIND_V2', linkId: 1, recipient: f.recipAddrs[0], recipientKeyHash: rh0 }), true, 'wrong bindDomain (own msg)');
check(L, w.bindDomain, realBind, false, 'wrong bindDomain vs real msg');
check(L, w.bindChain, realBind, false, 'wrong bindChain vs real msg');
check(L, w.bindContract, realBind, false, 'wrong bindContract vs real msg');
check(R, w.claimDomain, realClaim, false, 'wrong claimDomain vs real msg');
check(R, w.claimChain, realClaim, false, 'wrong claimChain vs real msg');
check(R, w.claimContract, realClaim, false, 'wrong claimContract vs real msg');
console.log(`OK: ${ok} valid triples re-verified with real ML-DSA-87, ${bad} negative checks rejected; accept list size ${accepted.size}`);

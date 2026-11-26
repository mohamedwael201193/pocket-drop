// Generates test/fixtures/*.json: REAL ML-DSA-87 keys and signatures (via @qorechain/pqc, the library the QoreChain
// SDK uses), deterministic from fixed seeds. Every signature is over the QoreX-prefixed message
//   "qorechain-msg-v1|qorechain-diana|" + 0x-hex(digest)
// The Foundry mock verifier accepts exactly the (pk, sig, msg) triples a test loads from here (by keccak of the triple).
//   node script/gen-fixtures.mjs
import fs from 'node:fs';
import { encodeAbiParameters } from 'viem';
import { mldsa } from '@qorechain/pqc';
import {
  ACCOUNTS, ADDR, POCKETS, POCKET_CFG, ACT, ETH, T0, DL, EXP, NUM_LINKS, params, intentDigest, recoveryDigest, dropBindDigest,
  dropClaimDigest, poolDigest, unanimousDigest, freezeDigest, counterDigest, pqMessage, pqMessageTagged, erc1271Digest, pqGuardDigest, TAG_ERC1271, TAG_PQGUARD, rawMessage, tripleHash, hex, unhex, keccak256, toBytes,
} from './fixtures-lib.mjs';

const keyNames = ['OA', 'OB', 'G0', 'G1', 'G2', 'G3', 'R0', 'R1', 'R2', 'C0', 'C1', 'C2', 'C3', 'LK0', 'LK1', 'LK2', 'PK', 'X'];
const keys = Object.fromEntries(keyNames.map((n) => [n, mldsa.keygen(unhex(keccak256(toBytes('pocketdrop-v4-fixture-' + n))))]));
const pkHex = (n) => hex(keys[n].publicKey);
const keyHash = (n) => keccak256(pkHex(n));
let count = 0;

function makeGroup() {
  const sigs = {};
  const add = (name, keyName, msgHex, { verifies = true } = {}) => {
    if (sigs[name]) throw new Error('dup ' + name);
    const s = mldsa.sign(keys[keyName].secretKey, unhex(msgHex));
    if (!mldsa.verify(keys[keyName].publicKey, unhex(msgHex), s)) throw new Error('self-verify failed ' + name);
    const sigHex = hex(s);
    sigs[name] = { sig: sigHex, h: tripleHash(pkHex(keyName), sigHex, msgHex), key: keyName, msg: msgHex };
    count++;
  };
  return { sigs, add };
}
const SINK = ADDR.SINK;
const lkOf = (id) => `LK${id % 3}`;

/* ---------------- vault + recovery + erc1271 + counter ---------------- */
const vault = makeGroup();
{
  const PA = POCKETS.PA;
  const intent = (name, keyName, action, nonce, p, vaultAddr = PA, extra = {}) =>
    vault.add(name, keyName, pqMessage(intentDigest({ action, vault: vaultAddr, nonce, params: p, ...extra })));
  for (let n = 0; n < 10; n++) {
    intent(`spendS_${n}`, 'OA', ACT.SPEND, n, params.spend(SINK, 8n * ETH / 10n));
    intent(`spendB_${n}`, 'OA', ACT.SPEND, n, params.spend(SINK, 5n * ETH));
  }
  for (let n = 0; n < 5; n++) {
    intent(`vetoQ1_${n}`, 'OA', ACT.VETO_QUEUED, n, params.id(1));
    intent(`vetoQ2_${n}`, 'OA', ACT.VETO_QUEUED, n, params.id(2));
    intent(`limLow_${n}`, 'OA', ACT.SET_LIMIT, n, params.limit(ETH));
    intent(`limHigh_${n}`, 'OA', ACT.SET_LIMIT, n, params.limit(9n * ETH));
    intent(`limSame_${n}`, 'OA', ACT.SET_LIMIT, n, params.limit(2n * ETH));
    intent(`cancelPending_${n}`, 'OA', ACT.CANCEL_PENDING, n, params.none());
  }
  for (let n = 0; n < 2; n++) intent(`vetoQ99_${n}`, 'OA', ACT.VETO_QUEUED, n, params.id(99));
  const G = ACCOUNTS;
  for (let n = 0; n < 4; n++) {
    intent(`gSet_${n}`, 'OA', ACT.SET_GUARDIANS, n, params.guardians([G.G0, G.G1], 2));
    intent(`gEmpty_${n}`, 'OA', ACT.SET_GUARDIANS, n, params.guardians([], 0));
    intent(`vetoRec_${n}`, 'OA', ACT.VETO_RECOVERY, n, params.none());
  }
  const bad = {
    gBadOne: [[G.G0], 1], gBadDup: [[G.G0, G.G0], 2], gBadThr: [[G.G0, G.G1], 1], gBadZero: [['0x0000000000000000000000000000000000000000', G.G1], 2],
    gBadOwner: [[G.OA, G.G1], 2], gBadMany: [[G.G0, G.G1, G.G2, G.G3, G.R0, G.R1], 2], gBadThrHigh: [[G.G0, G.G1], 3], gBadEmptyThr: [[], 1],
  };
  for (const [k, [g, t]] of Object.entries(bad)) intent(`${k}_0`, 'OA', ACT.SET_GUARDIANS, 0, params.guardians(g, t));
  // 5 guardians (the maximum) is valid
  intent('gFive_0', 'OA', ACT.SET_GUARDIANS, 0, params.guardians([G.G0, G.G1, G.G2, G.G3, G.R0], 3));
  intent('spendZero_0', 'OA', ACT.SPEND, 0, params.spend('0x0000000000000000000000000000000000000000', ETH / 10n));
  intent('spendAmt0_0', 'OA', ACT.SPEND, 0, params.spend(SINK, 0n));
  intent('spendToPA_0', 'OA', ACT.SPEND, 0, params.spend(PA, ETH / 10n)); // pays itself (always accepted: receive())
  // negative variants of spendS_0
  const good = intentDigest({ action: ACT.SPEND, vault: PA, nonce: 0, params: params.spend(SINK, 8n * ETH / 10n) });
  vault.add('wrongKey_spendS_0', 'OB', pqMessage(good));
  vault.add('wrongPrefix_spendS_0', 'OA', pqMessage(good, 'qorechain-vladi'));
  vault.add('rawDigest_spendS_0', 'OA', rawMessage(good));
  intent('spendS_dl2_0', 'OA', ACT.SPEND, 0, params.spend(SINK, 8n * ETH / 10n), PA, { deadline: DL + 1 });
  for (let n = 0; n < 4; n++) intent(`spendS_OB_${n}`, 'OB', ACT.SPEND, n, params.spend(SINK, 8n * ETH / 10n));
  intent('pbSpendS_0', 'OB', ACT.SPEND, 0, params.spend(SINK, 8n * ETH / 10n), POCKETS.PB);
  for (const i of [0, 1, 2]) intent(`spendPR${i}_0`, `R${i}`, ACT.SPEND, 0, params.spend(SINK, ETH / 10n), POCKETS[`PR${i}`]);
  // ERC-1271
  const H1 = keccak256(toBytes('erc1271 test'));
  vault.add('e1271_OA', 'OA', pqMessageTagged(TAG_ERC1271, erc1271Digest({ vault: PA, hash: H1 })));
  vault.add('e1271_OB', 'OB', pqMessageTagged(TAG_ERC1271, erc1271Digest({ vault: PA, hash: H1 })));
  // v5.1 F2 regressions: the old untagged ERC-1271 form, a PA2-bound approval used on PA, and an intent used as ERC-1271
  vault.add('e1271Untagged_OA', 'OA', pqMessage(H1));
  vault.add('e1271PA2_OA', 'OA', pqMessageTagged(TAG_ERC1271, erc1271Digest({ vault: POCKETS.PA2, hash: H1 })));
  vault.add('e1271Chain_OA', 'OA', pqMessageTagged(TAG_ERC1271, erc1271Digest({ vault: PA, hash: H1, chainId: 1n })));
  {
    const ig = intentDigest({ action: ACT.SPEND, vault: PA, nonce: 0, params: params.spend(SINK, 8n * ETH / 10n) });
    // an ERC-1271 approval of the intent digest must never pass as the intent itself
    vault.add('e1271OfIntent_OA', 'OA', pqMessageTagged(TAG_ERC1271, erc1271Digest({ vault: PA, hash: ig })));
    vault.add('pqgOfIntent_OA', 'OA', pqMessageTagged(TAG_PQGUARD, pqGuardDigest({ account: ACCOUNTS.OA, digest: ig })));
  }
  // PqGuard counter: through the Pocket (ERC-1271) and directly through a PoP account
  for (let c = 0; c < 2; c++) {
    vault.add(`ctrPA_${c}`, 'OA', pqMessageTagged(TAG_ERC1271, erc1271Digest({ vault: PA, hash: counterDigest({ account: PA, count: c }) })));
    vault.add(`ctrOA_${c}`, 'OA', pqMessageTagged(TAG_PQGUARD, pqGuardDigest({ account: ACCOUNTS.OA, digest: counterDigest({ account: ACCOUNTS.OA, count: c }) })));
    // v5.1 F2 regression: the v5 untagged counter approval of the plain account
    vault.add(`ctrOAUntagged_${c}`, 'OA', pqMessage(counterDigest({ account: ACCOUNTS.OA, count: c })));
  }
  // guardian recovery (new owner OB)
  for (let rn = 0; rn < 2; rn++) {
    for (const g of ['G0', 'G1', 'G2', 'G3']) {
      vault.add(`rec_${g}_${rn}`, g, pqMessage(recoveryDigest({ vault: PA, recNonce: rn, newOwner: ACCOUNTS.OB, newKeyHash: keyHash('OB') })));
    }
  }
  vault.add('recWrong_G1_0', 'G1', pqMessage(recoveryDigest({ vault: PA, recNonce: 0, newOwner: ACCOUNTS.R0, newKeyHash: keyHash('R0') })));
  const badHash = '0x' + 'ba'.repeat(32);
  for (const g of ['G0', 'G1']) vault.add(`recBadHash_${g}_0`, g, pqMessage(recoveryDigest({ vault: PA, recNonce: 0, newOwner: ACCOUNTS.OB, newKeyHash: badHash })));
  // recovery signed for the PA2 vault must not work on PA
  for (const g of ['G0', 'G1']) vault.add(`recPA2_${g}_0`, g, pqMessage(recoveryDigest({ vault: POCKETS.PA2, recNonce: 0, newOwner: ACCOUNTS.OB, newKeyHash: keyHash('OB') })));
  // guardian freeze (nonces 0..5; G3 is NOT a guardian of PA) and unanimous recovery (new owner OB, recovery nonces 0..3)
  for (let n = 0; n < 6; n++) {
    for (const g of ['G0', 'G1', 'G2', 'G3']) vault.add(`frz_${g}_${n}`, g, pqMessage(freezeDigest({ vault: PA, nonce: n })));
  }
  for (const g of ['G0', 'G1']) vault.add(`frzPA2_${g}_0`, g, pqMessage(freezeDigest({ vault: POCKETS.PA2, nonce: 0 })));
  for (let rn = 0; rn < 4; rn++) {
    for (const g of ['G0', 'G1', 'G2', 'G3']) {
      vault.add(`unan_${g}_${rn}`, g, pqMessage(unanimousDigest({ vault: PA, recNonce: rn, newOwner: ACCOUNTS.OB, newKeyHash: keyHash('OB') })));
    }
  }
  for (const g of ['G0', 'G1', 'G2']) vault.add(`unanBadHash_${g}_0`, g, pqMessage(unanimousDigest({ vault: PA, recNonce: 0, newOwner: ACCOUNTS.OB, newKeyHash: badHash })));
  for (const g of ['G0', 'G1', 'G2']) vault.add(`unanPA2_${g}_0`, g, pqMessage(unanimousDigest({ vault: POCKETS.PA2, recNonce: 0, newOwner: ACCOUNTS.OB, newKeyHash: keyHash('OB') })));
  // owner "guardian replay" pieces: the same OB key signing a veto after recovery
  for (let n = 0; n < 3; n++) intent(`vetoRec_OB_${n}`, 'OB', ACT.VETO_RECOVERY, n, params.none());
}

/* ---------------- drops (PA as sender) ---------------- */
const drops = makeGroup();
{
  const PA = POCKETS.PA;
  const intent = (name, keyName, action, nonce, p) => drops.add(name, keyName, pqMessage(intentDigest({ action, vault: PA, nonce, params: p })));
  const D = ADDR.DROP;
  const rk = keyHash('R0');
  for (let id = 1; id <= 4; id++) {
    for (let n = 0; n < 6; n++) {
      const lkh = keyHash(lkOf(id));
      intent(`cdConf_${id}_${n}`, 'OA', ACT.CREATE_DROP, n, params.createDrop(D, lkh, 0, EXP, ETH / 5n, ETH / 20n, 125n * ETH / 100n));
      intent(`cdOpen_${id}_${n}`, 'OA', ACT.CREATE_DROP, n, params.createDrop(D, lkh, 1, EXP, ETH / 5n, ETH / 20n, 125n * ETH / 100n));
      intent(`cf_${id}_${n}`, 'OA', ACT.CONFIRM_DROP, n, params.confirm(D, id, rk));
      intent(`cn_${id}_${n}`, 'OA', ACT.CANCEL_DROP, n, params.cancel(D, id));
    }
  }
  for (let n = 0; n < 3; n++) intent(`cfWrong_1_${n}`, 'OA', ACT.CONFIRM_DROP, n, params.confirm(D, 1, keyHash('R1')));
  intent('cdBig_0', 'OA', ACT.CREATE_DROP, 0, params.createDrop(D, keyHash('LK1'), 0, EXP, 0n, 0n, 3n * ETH));
  intent('cdBadMode_0', 'OA', ACT.CREATE_DROP, 0, params.createDrop(D, keyHash('LK1'), 5, EXP, 0n, 0n, ETH));
  for (let n = 0; n < 5; n++) {
    intent(`cp_${n}`, 'OA', ACT.CREATE_POOL, n, params.createPool(ADDR.POOL, keyHash('PK'), 3, 3n * ETH / 10n, EXP));
    intent(`cl_${n}`, 'OA', ACT.CLOSE_POOL, n, params.closePool(ADDR.POOL, 1));
  }
  for (const n of [0, 1]) intent(`cpBig_${n}`, 'OA', ACT.CREATE_POOL, n, params.createPool(ADDR.POOL, keyHash('PK'), 3, ETH, EXP));
  // bind / claim: link id -> link key LK[id%3]; recipients R0..R2 paying to their Pockets PR0..PR2
  for (let id = 1; id <= NUM_LINKS; id++) {
    for (let r = 0; r < 3; r++) {
      const recipient = ACCOUNTS[`R${r}`];
      const payTo = POCKETS[`PR${r}`];
      drops.add(`bind_${id}_${r}`, lkOf(id), pqMessage(dropBindDigest({ id, recipient, keyHash: keyHash(`R${r}`), payTo })));
      drops.add(`claim_${id}_${r}`, `R${r}`, pqMessage(dropClaimDigest({ id, recipient, payTo })));
    }
  }
  // bind payTo swapped: link-key sig for payTo=PR0 must not authorise payTo=PA (tested by reuse), plus a bind to an
  // un-deployed non-Pocket address (plain account)
  drops.add('bindPlain_1_0', lkOf(1), pqMessage(dropBindDigest({ id: 1, recipient: ACCOUNTS.R0, keyHash: keyHash('R0'), payTo: ACCOUNTS.R0 })));
  drops.add('claimPlain_1_0', 'R0', pqMessage(dropClaimDigest({ id: 1, recipient: ACCOUNTS.R0, payTo: ACCOUNTS.R0 })));
  drops.add('bindRaw_1_0', lkOf(1), rawMessage(dropBindDigest({ id: 1, recipient: ACCOUNTS.R0, keyHash: keyHash('R0'), payTo: POCKETS.PR0 })));
  const b = { id: 1, recipient: ACCOUNTS.R0, keyHash: keyHash('R0'), payTo: POCKETS.PR0 };
  const c = { id: 1, recipient: ACCOUNTS.R0, payTo: POCKETS.PR0 };
  drops.add('wBindDomain', lkOf(1), pqMessage(dropBindDigest({ ...b, domain: 'POCKETDROP_BIND_V1' })));
  drops.add('wBindChain', lkOf(1), pqMessage(dropBindDigest({ ...b, chainId: 1n })));
  drops.add('wBindContract', lkOf(1), pqMessage(dropBindDigest({ ...b, drop: ADDR.COUNTER })));
  drops.add('wClaimDomain', 'R0', pqMessage(dropClaimDigest({ ...c, domain: 'POCKETDROP_BIND_V2' })));
  drops.add('wClaimChain', 'R0', pqMessage(dropClaimDigest({ ...c, chainId: 1n })));
  drops.add('wClaimContract', 'R0', pqMessage(dropClaimDigest({ ...c, drop: ADDR.COUNTER })));
  drops.add('wBindWrongKey', 'X', pqMessage(dropBindDigest(b)));
  // v5.1 F1 regressions: the v5 bind (no feeTo) and a bind signed for another feeTo
  drops.add('wBindV2', lkOf(1), pqMessage(keccak256(encodeAbiParameters(['string', 'uint256', 'address', 'uint256', 'address', 'bytes32', 'address'].map((type) => ({ type })), ['POCKETDROP_BIND_V2', 9800n, ADDR.DROP, 1n, b.recipient, b.keyHash, b.payTo]))));
  drops.add('bindFeeSink_1_0', lkOf(1), pqMessage(dropBindDigest({ ...b, feeTo: ADDR.SINK })));
}

/* ---------------- pool ---------------- */
const pool = makeGroup();
{
  for (let pid = 1; pid <= 2; pid++) {
    for (let ci = 0; ci < 4; ci++) {
      const recipient = ACCOUNTS[`C${ci}`];
      const payTo = POCKETS[`PC${ci}`];
      pool.add(`link_${pid}_${ci}`, 'PK', pqMessage(poolDigest({ domain: 'POCKET_POOL_LINK_V1', id: pid, recipient, payTo })));
      pool.add(`claim_${pid}_${ci}`, `C${ci}`, pqMessage(poolDigest({ domain: 'POCKET_POOL_CLAIM_V1', id: pid, recipient, payTo })));
    }
  }
  pool.add('linkWrongKey_1_0', 'X', pqMessage(poolDigest({ domain: 'POCKET_POOL_LINK_V1', id: 1, recipient: ACCOUNTS.C0, payTo: POCKETS.PC0 })));
  // link sig and claim sig swapped domains: the link key signing the CLAIM digest and the recipient the LINK digest
  pool.add('linkAsClaim_1_0', 'C0', pqMessage(poolDigest({ domain: 'POCKET_POOL_LINK_V1', id: 1, recipient: ACCOUNTS.C0, payTo: POCKETS.PC0 })));
}

/* ---------------- fuzz / invariant pool of vault intents (PA, nonces 0..59) ---------------- */
const fuzz = makeGroup();
{
  const PA = POCKETS.PA;
  for (let n = 0; n < 60; n++) {
    fuzz.add(`spendS_${n}`, 'OA', pqMessage(intentDigest({ action: ACT.SPEND, vault: PA, nonce: n, params: params.spend(SINK, 8n * ETH / 10n) })));
    fuzz.add(`vetoRec_${n}`, 'OA', pqMessage(intentDigest({ action: ACT.VETO_RECOVERY, vault: PA, nonce: n, params: params.none() })));
    fuzz.add(`spendB_${n}`, 'OA', pqMessage(intentDigest({ action: ACT.SPEND, vault: PA, nonce: n, params: params.spend(SINK, 5n * ETH) })));
  }
}

// frozen-state grid for the invariant / fuzz suites: freeze nonces 0..7, unanimous and threshold recovery nonces 0..7 (new owner OB)
{
  const PA = POCKETS.PA;
  for (let n = 0; n < 8; n++) {
    for (const g of ['G0', 'G1', 'G2']) {
      fuzz.add(`frz_${g}_${n}`, g, pqMessage(freezeDigest({ vault: PA, nonce: n })));
      fuzz.add(`unan_${g}_${n}`, g, pqMessage(unanimousDigest({ vault: PA, recNonce: n, newOwner: ACCOUNTS.OB, newKeyHash: keyHash('OB') })));
      fuzz.add(`rec_${g}_${n}`, g, pqMessage(recoveryDigest({ vault: PA, recNonce: n, newOwner: ACCOUNTS.OB, newKeyHash: keyHash('OB') })));
    }
  }
}

const out = (name, obj) => fs.writeFileSync(new URL(`../test/fixtures/${name}.json`, import.meta.url), JSON.stringify(obj));
// One small file per signature (test/fixtures/<group>/<name>.json = {h, sig}) so Foundry never loads megabytes into memory.
for (const [group, g] of Object.entries({ vault, drops, pool, fuzz })) {
  const dir = new URL(`../test/fixtures/${group}/`, import.meta.url);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, v] of Object.entries(g.sigs)) fs.writeFileSync(new URL(`${name}.json`, dir), JSON.stringify(v));
}
out('keys', {
  note: 'Public ML-DSA-87 keys of the fixture identities, their fixed addresses and the Pocket addresses (computed independently in JS).',
  chainId: 9800, chainStr: 'qorechain-diana', t0: T0, deadline: DL, expiry: EXP,
  pks: Object.fromEntries(keyNames.map((n) => [n, pkHex(n)])),
  addrs: ACCOUNTS, fixed: ADDR, pockets: POCKETS,
  pocketCfg: Object.fromEntries(Object.entries(POCKET_CFG).map(([k, v]) => [k, { ...v, limit: v.limit.toString() }])),
});
console.log('fixtures written:', count, 'real ML-DSA-87 signatures');

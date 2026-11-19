// Live suite: every success path and the 6 lab attacks as REAL txs on QoreChain Diana testnet against the deployed
// PocketDrop. Foundry cannot fork native precompiles, so this suite replaces fork tests.
//   node test/live/run.mjs
// Results (tx hashes + outcomes) are appended to deployments/diana.json under "liveTxs" and LIVE_RESULTS.md is written.
import fs from 'node:fs';
import path from 'node:path';
import { mldsa } from '@qorechain/pqc';
import { keccak256, toHex, parseEther, decodeErrorResult, encodeFunctionData, encodeAbiParameters, formatEther } from 'viem';
import {
  loadDeployer, Evm, pub, windowOf, openWindow, loadArtifact, readDeployments, writeDeployments, readSecrets, writeSecrets,
  newAccountRecord, accountFrom, registerWithPoP, keyStatus, bankUqor, loadMain, EXPL, ROOT, sleep, qor,
} from '../../script/lib.mjs';

const art = loadArtifact();
const abi = art.abi;
const dep = readDeployments();
const M = dep.contracts.main.address;
const L = dep.contracts.lab.address;
const deployer = await loadDeployer();
const evm = new Evm(deployer);
dep.liveTxs ??= [];
const ONLY = process.env.ONLY; // e.g. ONLY=H runs just the rebind scenario
const on = (k) => !ONLY || ONLY === k;
const startBal = await pub.getBalance({ address: evm.address });
const log = (...a) => console.log(...a);
const u8 = (h) => Uint8Array.from(Buffer.from(h.slice(2), 'hex'));
const hx = (u) => toHex(u);

function rec(step, hash, status, outcome, extra = {}) {
  dep.liveTxs.push({ step, hash, url: EXPL + hash, status, outcome, ...extra });
  writeDeployments(dep);
  log(`${status === 'success' ? 'OK  ' : 'REV '} ${step} -> ${outcome}  ${hash}`);
}
const chainTs = async () => Number((await pub.getBlock()).timestamp);
async function waitChainTs(t) { while ((await chainTs()) < t) await sleep(1500); }

const call = (to, fn, args = [], value = 0n) => ({ to, data: encodeFunctionData({ abi, functionName: fn, args }), value });
const read = (to, fn, args = []) => pub.readContract({ address: to, abi, functionName: fn, args });

/** Send a call that must succeed. */
async function ok(step, sender, to, fn, args, value = 0n, outcome = 'ok') {
  const c = call(to, fn, args, value);
  const est = await pub.estimateGas({ account: sender.address, ...c });
  const { hash, receipt } = await sender.send({ ...c, gas: (est * 13n) / 10n });
  if (receipt.status !== 'success') throw new Error(step + ' unexpectedly reverted ' + hash);
  rec(step, hash, 'success', outcome);
  return receipt;
}
/** Send a call that must revert with custom error `errName`: eth_call first to decode the reason, then mine it for real. */
async function reverts(step, sender, to, fn, args, errName, value = 0n) {
  const c = call(to, fn, args, value);
  let name = '?';
  try { await pub.call({ account: sender.address, ...c }); name = 'NO REVERT'; } catch (e) {
    const data = e.walk?.((x) => typeof x?.data === 'string')?.data ?? e.data;
    try { name = decodeErrorResult({ abi, data }).errorName; } catch { name = 'undecodable:' + String(data).slice(0, 10); }
  }
  if (name !== errName) throw new Error(`${step}: expected ${errName}, eth_call gave ${name}`);
  const { hash, receipt } = await sender.send({ ...c, gas: 700000n }); // explicit gas so the node mines the revert
  if (receipt.status !== 'reverted') throw new Error(step + ' was not reverted on-chain ' + hash);
  rec(step, hash, 'reverted', errName, { expected: true });
  return hash;
}

const bindMsg = (c, id, recipient, rkh) => encodeAbiParameters(
  [{ type: 'string' }, { type: 'uint256' }, { type: 'address' }, { type: 'uint256' }, { type: 'address' }, { type: 'bytes32' }],
  ['POCKETDROP_BIND_V1', 9800n, c, BigInt(id), recipient, rkh]);
const claimMsg = (c, id, recipient) => encodeAbiParameters(
  [{ type: 'string' }, { type: 'uint256' }, { type: 'address' }, { type: 'uint256' }, { type: 'address' }],
  ['POCKETDROP_CLAIM_V1', 9800n, c, BigInt(id), recipient]);

/** A link: sender creates with a fresh ML-DSA link key; returns what the link carries. */
async function createLink(step, contract, { mode, amount, drip = 0n, fee = 0n, ttl = 3600 }) {
  const lk = mldsa.keygen();
  const expiry = BigInt((await chainTs()) + ttl);
  const receipt = await ok(step, evm, contract, 'create', [keccak256(hx(lk.publicKey)), mode, expiry, drip, fee], amount + drip + fee, 'link created');
  const id = await read(contract, 'linkCount');
  return { id, contract, lk, expiry };
}
const bindArgs = (link, recipient, rkh, sigKey = link.lk) => [
  link.id, recipient, rkh, hx(link.lk.publicKey), hx(mldsa.sign(sigKey.secretKey, u8(bindMsg(link.contract, link.id, recipient, rkh)))),
];
const claimSigBy = (link, recipient, key) => hx(mldsa.sign(key.secretKey, u8(claimMsg(link.contract, link.id, recipient))));
const state = async (c, id) => ['None', 'Open', 'Bound', 'Confirmed', 'Claimed', 'Cancelled', 'Refunded'][Number((await read(c, 'getLink', [id])).state)];

/* ---------------- accounts ---------------- */
const secrets = readSecrets();
secrets.freshRecipients ??= [];
async function fresh(role) {
  const { acc, record } = await newAccountRecord(role);
  secrets.freshRecipients.push(record);
  writeSecrets(secrets);
  return acc;
}
const dripFee = 0.2;
const rhash = (acc) => keccak256(hx(acc.pqc.publicKey));

let w = await windowOf(deployer);
if (!w.live || w.remainingTxs < 60n) { await openWindow(deployer, { maxTxs: 200, valueUqor: 12_000_000n }); log('reopened deployer window'); }

/* attacker B (a second person with a real, proven PQ key and its own EVM window) */
const B = await fresh('attacker-B');
if (on('A')) {
  const { hash, receipt } = await evm.send({ to: B.evm, value: parseEther('0.6'), gas: 40000n });
  rec('fund attacker B 0.6 QOR', hash, receipt.status, 'funded');
  const r = await registerWithPoP(B);
  rec('attacker B registers PQ key (PoP)', r.hash, 'success', 'possessionProven=' + (await keyStatus(B.evm)).possessionProven);
  const o = await openWindow(B, { maxTxs: 6, blocks: 2000, gasCap: 800_000n, valueUqor: 0n });
  rec('attacker B opens EVM window', o.hash, 'success', 'window opened');
}
const evmB = new Evm(B);

/** Recipient with 0 balance: bind pays the drip, then it registers its key from that drip. */
async function bindAndRegister(step, link, R) {
  await ok(`${step}: relayer binds recipient (drip lands)`, evm, link.contract, 'bind', bindArgs(link, R.evm, rhash(R)));
  const r = await registerWithPoP(R);
  rec(`${step}: recipient registers ML-DSA-87 key with PoP (fee paid from drip)`, r.hash, 'success', 'possessionProven=' + (await keyStatus(R.evm)).possessionProven);
}

/* ======== A. Confirmed mode full flow + attacks 1, 5, 6 ======== */
log('\n== A. Confirmed mode');
if (on('A')) {
  const R = await fresh('recipient-confirmed');
  const link = await createLink('A1 create (Confirmed, 1 QOR, drip 0.2)', M, { mode: 0, amount: parseEther('1'), drip: parseEther('0.2'), fee: parseEther('0.02') });
  // Attack 1: mempool thief takes the signed bind for R and swaps in his own address/key.
  const legit = bindArgs(link, R.evm, rhash(R));
  await reverts('ATTACK 1 thief swaps recipient in bind', evmB, M, 'bind', [link.id, B.evm, rhash(B), legit[3], legit[4]], 'BadLinkSignature');
  await bindAndRegister('A2', link, R);
  const fp = (await read(M, 'getLink', [link.id])).recipientKeyHash;
  await ok('A3 sender confirms (checked fingerprint of recipientKeyHash)', evm, M, 'confirmRecipient', [link.id, fp]);
  await reverts('ATTACK 6 sender cancels after confirm', evm, M, 'cancel', [link.id], 'InvalidState');
  await reverts('ATTACK 5 second person (B, own proven key) claims the Confirmed link', evmB, M, 'claim', [link.id, claimSigBy(link, R.evm, B.pqc)], 'BadRecipientSignature');
  const before = await pub.getBalance({ address: R.evm });
  await ok('A4 relayer claims with the recipient signature', evm, M, 'claim', [link.id, claimSigBy(link, R.evm, R.pqc)], 0n, 'amount paid');
  const gain = (await pub.getBalance({ address: R.evm })) - before;
  if (gain !== parseEther('1')) throw new Error('recipient gain ' + gain);
  log('recipient received', formatEther(gain), 'QOR; state', await state(M, link.id));
  await reverts('A5 second claim of a claimed link', evm, M, 'claim', [link.id, claimSigBy(link, R.evm, R.pqc)], 'InvalidState');
}

/* ======== B. Open mode full flow ======== */
log('\n== B. Open mode');
if (on('B')) {
  const R = await fresh('recipient-open');
  const link = await createLink('B1 create (Open, 0.5 QOR, drip 0.2)', M, { mode: 1, amount: parseEther('0.5'), drip: parseEther('0.2'), fee: parseEther('0.01') });
  await bindAndRegister('B2', link, R);
  const before = await pub.getBalance({ address: R.evm });
  await ok('B3 relayer claims', evm, M, 'claim', [link.id, claimSigBy(link, R.evm, R.pqc)], 0n, 'amount paid');
  if ((await pub.getBalance({ address: R.evm })) - before !== parseEther('0.5')) throw new Error('open-mode payout wrong');
  log('state', await state(M, link.id));
}

/* ======== C. Attack 2: signature from a different key ======== */
log('\n== C. Attack 2');
if (on('C')) {
  const R = await fresh('recipient-wrongsig');
  const link = await createLink('C1 create (Open, 0.3 QOR, drip 0.2)', M, { mode: 1, amount: parseEther('0.3'), drip: parseEther('0.2') });
  await bindAndRegister('C2', link, R);
  const other = mldsa.keygen();
  await reverts('ATTACK 2 claim signed by a key other than the registered one', evm, M, 'claim', [link.id, claimSigBy(link, R.evm, other)], 'BadRecipientSignature');
  await ok('C3 honest claim still works afterwards', evm, M, 'claim', [link.id, claimSigBy(link, R.evm, R.pqc)], 0n, 'amount paid');
}

/* ======== D/E. Attacks 3 and 4 (short expiry so the escrow comes back by refund) ======== */
log('\n== D/E. Attacks 3 and 4');
const toRefund = [];
if (on('D')) {
  const main = await loadMain();
  const st = await keyStatus(main.evm);
  const link = await createLink('D1 create (Open, 0.2 QOR, expiry +100s)', M, { mode: 1, amount: parseEther('0.2'), ttl: 100 });
  await ok('D2 bind to main test wallet (legacy key, possessionProven=false)', evm, M, 'bind', [link.id, main.evm, keccak256(st.pubkey), hx(link.lk.publicKey), hx(mldsa.sign(link.lk.secretKey, u8(bindMsg(M, link.id, main.evm, keccak256(st.pubkey)))))]);
  await reverts('ATTACK 3 claim into an account whose key has possessionProven=false', evm, M, 'claim', [link.id, hx(new Uint8Array(4627))], 'PossessionNotProven');
  toRefund.push(link);
  const N = await fresh('recipient-nokey');
  const kg = mldsa.keygen();
  const link2 = await createLink('E1 create (Open, 0.2 QOR, expiry +100s)', M, { mode: 1, amount: parseEther('0.2'), ttl: 100 });
  await ok('E2 bind to an account with no PQ key', evm, M, 'bind', [link2.id, N.evm, keccak256(hx(kg.publicKey)), hx(link2.lk.publicKey), hx(mldsa.sign(link2.lk.secretKey, u8(bindMsg(M, link2.id, N.evm, keccak256(hx(kg.publicKey))))))]);
  await reverts('ATTACK 4 claim into an account with no PQ key', evm, M, 'claim', [link2.id, claimSigBy(link2, N.evm, kg)], 'NotRegistered');
  toRefund.push(link2);
}

/* ======== F. Cancel ======== */
log('\n== F. Cancel');
if (on('F')) {
  const link = await createLink('F1 create (Open, 0.2 QOR, drip 0.1)', M, { mode: 1, amount: parseEther('0.2'), drip: parseEther('0.1') });
  const before = await pub.getBalance({ address: evm.address });
  await ok('F2 sender cancels (refund amount + unpaid drip)', evm, M, 'cancel', [link.id], 0n, 'refunded');
  log('state', await state(M, link.id), 'balance delta (net of gas) QOR', formatEther((await pub.getBalance({ address: evm.address })) - before));
  await reverts('F3 cancel again', evm, M, 'cancel', [link.id], 'InvalidState');
}

/* ======== G. Refund after short expiry ======== */
log('\n== G. Refund');
if (on('G')) {
  const link = await createLink('G1 create (Open, 0.15 QOR, expiry +40s)', M, { mode: 1, amount: parseEther('0.15'), ttl: 40 });
  toRefund.push(link);
  await reverts('G2 refund before expiry', evmB, M, 'refund', [link.id], 'NotExpired');
  const latest = toRefund.reduce((m, l) => (l.expiry > m ? l.expiry : m), 0n);
  await waitChainTs(Number(latest) + 2);
  for (const l of toRefund) {
    const bal = await pub.getBalance({ address: evm.address });
    await ok(`G3 refund link ${l.id} after expiry, by the relayer`, evm, M, 'refund', [l.id], 0n, 'refunded to sender');
    log('state', await state(M, l.id));
  }
  const l0 = toRefund[0];
  await reverts('G4 claim after expiry/refund', evm, M, 'claim', [l0.id, hx(new Uint8Array(4627))], 'InvalidState');
}

/* ======== H. Rebind after timeout (lab instance, BIND_TIMEOUT = 60 s) ======== */
log('\n== H. Rebind (lab)');
if (on('H')) {
  const R1 = await fresh('recipient-rebind-1');
  const R2 = await fresh('recipient-rebind-2');
  const link = await createLink('H1 create on lab (Open, 0.2 QOR, drip 0.2)', L, { mode: 1, amount: parseEther('0.2'), drip: parseEther('0.2') });
  await ok('H2 bind R1', evm, L, 'bind', bindArgs(link, R1.evm, rhash(R1)));
  await reverts('H3 rebind before timeout is refused', evm, L, 'bind', bindArgs(link, R2.evm, rhash(R2)), 'InvalidState');
  const deadline = Number((await read(L, 'getLink', [link.id])).bindDeadline);
  await waitChainTs(deadline + 2);
  await ok('H4 rebind to R2 after timeout (no second drip)', evm, L, 'bind', bindArgs(link, R2.evm, rhash(R2)), 0n, 'rebound');
  log('R2 balance after rebind (no drip expected)', formatEther(await pub.getBalance({ address: R2.evm })));
  // R2 has no money: fund its registration from the deployer (the drip went to R1).
  const f = await evm.send({ to: R2.evm, value: parseEther('0.1'), gas: 40000n });
  rec('H5 deployer tops up R2 for its registration fee', f.hash, f.receipt.status, 'funded');
  const r = await registerWithPoP(R2);
  rec('H6 R2 registers PQ key (PoP)', r.hash, 'success', 'ok');
  await reverts('H7 old recipient R1 signature no longer claims', evm, L, 'claim', [link.id, claimSigBy(link, R1.evm, R1.pqc)], 'BadRecipientSignature');
  const before = await pub.getBalance({ address: R2.evm });
  await ok('H8 R2 claims', evm, L, 'claim', [link.id, claimSigBy(link, R2.evm, R2.pqc)], 0n, 'amount paid');
  if ((await pub.getBalance({ address: R2.evm })) - before !== parseEther('0.2')) throw new Error('rebind payout wrong');
}

/* ======== summary ======== */
const endBal = await pub.getBalance({ address: evm.address });
dep.liveSummary = {
  ranAt: new Date().toISOString(), contractsChecked: { main: M, lab: L },
  deployerSpentQorIncludingEscrowRoundTrips: formatEther(startBal - endBal),
  mainLinkCount: String(await read(M, 'linkCount')), labLinkCount: String(await read(L, 'linkCount')),
  mainContractBalanceQor: formatEther(await pub.getBalance({ address: M })),
  labContractBalanceQor: formatEther(await pub.getBalance({ address: L })),
};
writeDeployments(dep);
const rows = dep.liveTxs.map((t) => `| ${t.step.replace(/\|/g, '/')} | ${t.status} | ${t.outcome} | [${t.hash.slice(0, 12)}...](${t.url}) |`).join('\n');
fs.writeFileSync(path.join(ROOT, 'LIVE_RESULTS.md'), `# Live results (QoreChain Diana testnet, EVM chain id 9800)

Main: \`${M}\`  Lab (same bytecode, BIND_TIMEOUT 60 s): \`${L}\`
Every row is a mined EVM transaction. "reverted" rows are the lab attacks and negative checks: each was first decoded with eth_call, then mined with an explicit gas limit so the revert is on-chain.

| step | receipt status | outcome / custom error | tx |
|---|---|---|---|
${rows}

Summary: ${JSON.stringify(dep.liveSummary, null, 2)}
`);
log('\nDONE', dep.liveSummary);

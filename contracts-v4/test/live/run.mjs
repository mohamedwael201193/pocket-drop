// Live suite (QoreChain Diana TESTNET, EVM 9800): every Pocket Drop v4 success path and every lab attack from
// SPEC_V4 section 3 as REAL mined transactions against the deployed contracts. Foundry cannot fork the native
// precompiles, so this suite is the end-to-end proof. Results go to deployments/diana.json (liveTxs) and LIVE_RESULTS.md.
//   node test/live/run.mjs
// Two deployed instances are used: PROD (24 h timelock, 48 h recovery) for the money flows and the "too early" proof,
// LAB (60 s delays) for the full timelock / veto / recovery cycles.
// Pinned to the v4 deployment (dep.v4): v4 finalize takes no arguments. The v5.2 finalize (signed authorization by the owner,
// a guardian or the approved new owner) is exercised live by script/smoke-v52.mjs (section R) on the v5.2 lab instance.
import fs from 'node:fs';
import path from 'node:path';
import { mldsa } from '@qorechain/pqc';
import { evmToQor } from '@qorechain/sdk';
import {
  keccak256, toHex, parseEther, decodeErrorResult, encodeFunctionData, formatEther, parseAbi, getAddress,
} from 'viem';
import {
  loadDeployer, Evm, pub, windowOf, openWindow, artifact, readDeployments, writeDeployments, readSecrets, writeSecrets,
  newAccountRecord, accountFrom, registerWithPoP, keyStatus, loadMain, fundFromMain, EXPL, ROOT, sleep, qor, bankUqor,
} from '../../script/lib.mjs';
import { ACT, params, intentDigest, pqMessage, poolDigest } from '../../script/fixtures-lib.mjs';

const dep = readDeployments();
const P = dep.v4.prod;
const L = dep.v4.lab;
const COUNTER = dep.v4.shared.counter.address;
const V3 = '0x29F53b4B8031E7bA1785dC8C7a1C0Be413a4bd97';
const A = { vault: artifact('PocketVault').abi, factory: artifact('PocketFactory').abi, drop: artifact('PocketDrop').abi, pool: artifact('DropPool').abi, router: artifact('PocketRouter').abi };
const LIB_ERRORS = parseAbi(['error KeyUnavailable()', 'error NotRegistered()', 'error UnsupportedAlgo()', 'error PossessionNotProven()', 'error KeyMismatch()', 'error PqApprovalFailed()']);
const ALL_ABI = [...A.vault, ...A.factory, ...A.drop, ...A.pool, ...A.router, ...LIB_ERRORS];

const deployer = await loadDeployer();
const evm = new Evm(deployer); // unscoped window: a plain "any submitter" of router calls and a funder
const relayerFile = process.env.RELAYER_SECRET_FILE ?? 'D:/route/QORE/.secrets/pocketdrop-relayer.json';
const relayerAcc = await accountFrom(JSON.parse(fs.readFileSync(relayerFile, 'utf8')));
const relayer = new Evm(relayerAcc); // window scoped to [router prod, router lab, PocketDrop v3]
// an earlier incomplete run is kept (honestly labelled) and the table below shows only this run
if (dep.liveTxs?.length) {
  dep.priorRuns ??= [];
  dep.priorRuns.push({ aborted: process.env.PRIOR_ABORTED === '1', reason: process.env.PRIOR_NOTE ?? 'incomplete run', txs: dep.liveTxs });
}
dep.liveTxs = [];
const log = (...a) => console.log(...a);
const u8 = (h) => Uint8Array.from(Buffer.from(h.slice(2), 'hex'));
const hx = (u) => toHex(u);
const startBal = await pub.getBalance({ address: evm.address });
const startRelayerBal = await pub.getBalance({ address: relayer.address });

function rec(step, hash, status, outcome, extra = {}) {
  dep.liveTxs.push({ step, hash, url: hash ? EXPL + hash : null, status, outcome, ...extra });
  writeDeployments(dep);
  log(`${status === 'success' ? 'OK  ' : status === 'reverted' ? 'REV ' : 'INFO'} ${step} -> ${outcome}  ${hash ?? ''}`);
}
const chainTs = async () => Number((await pub.getBlock()).timestamp);
async function waitChainTs(t) { while ((await chainTs()) < t) await sleep(1500); }
const read = (address, abi, functionName, args = []) => pub.readContract({ address, abi, functionName, args });
const hasCode = async (a) => ((await pub.getCode({ address: a })) ?? '0x') !== '0x';

/** Send a tx that must succeed. */
async function ok(step, sender, to, data, value = 0n, outcome = 'ok') {
  const est = await pub.estimateGas({ account: sender.address, to, data, value });
  const { hash, receipt } = await sender.send({ to, data, value, gas: (est * 13n) / 10n });
  if (receipt.status !== 'success') throw new Error(step + ' unexpectedly reverted ' + hash);
  rec(step, hash, 'success', outcome, { gasUsed: String(receipt.gasUsed), from: sender === relayer ? 'relayer (window scoped to routers)' : 'deployer (unscoped)' });
  return receipt;
}
/** A tx that must revert with custom error `errName`: decode with eth_call first, then mine the revert for real. */
async function reverts(step, sender, to, data, errName, gas = 600000n, value = 0n) {
  let name = '?';
  try { await pub.call({ account: sender.address, to, data, value }); name = 'NO REVERT'; } catch (e) {
    const d = e.walk?.((x) => typeof x?.data === 'string')?.data ?? e.data;
    try { name = decodeErrorResult({ abi: ALL_ABI, data: d }).errorName; } catch { name = 'undecodable:' + String(d).slice(0, 10); }
  }
  if (name !== errName) throw new Error(`${step}: expected ${errName}, eth_call gave ${name}`);
  const { hash, receipt } = await sender.send({ to, data, value, gas });
  if (receipt.status !== 'reverted') throw new Error(step + ' was not reverted on-chain ' + hash);
  rec(step, hash, 'reverted', errName, { expected: true, attack: true });
  return hash;
}

/* ---------------- accounts (fresh, secrets kept in .secrets only) ---------------- */
const secrets = readSecrets();
secrets.v4Accounts ??= [];
async function fresh(role, fundQor = '0.12') {
  const { acc, record } = await newAccountRecord(role);
  secrets.v4Accounts.push(record);
  writeSecrets(secrets);
  if (fundQor !== '0') {
    const f = await evm.send({ to: acc.evm, value: parseEther(fundQor), gas: 40000n });
    rec(`fund ${role} ${fundQor} QOR (for its PQ registration fee)`, f.hash, f.receipt.status, 'funded');
  }
  return acc;
}
async function register(role, acc) {
  const r = await registerWithPoP(acc);
  const ks = await keyStatus(acc.evm);
  rec(`${role} registers its ML-DSA-87 key with proof of possession`, r.hash, 'success', `possessionProven=${ks.possessionProven}`);
}
const keyHash = (acc) => keccak256(hx(acc.pqc.publicKey));
const sign = (key, digest) => hx(mldsa.sign(key.secretKey, u8(pqMessage(digest))));

let w = await windowOf(deployer);
if (!w.live || w.remainingTxs < 120n) { await openWindow(deployer, { maxTxs: 300, valueUqor: 12_000_000n }); log('reopened deployer window'); }

/* ---------------- Pocket + router helpers ---------------- */
const salt = () => keccak256(toHex(crypto.getRandomValues(new Uint8Array(32))));
function pocketCfg(owner, { guardians = [], threshold = 0, limit, userSalt = salt() }) {
  return { owner: owner.evm, guardians: guardians.map((g) => g.evm), threshold, limit, userSalt };
}
const cfgArgs = (c) => [c.owner, c.guardians, c.threshold, c.limit, c.userSalt];
const predict = (inst, c) => read(inst.factory.address, A.factory, 'predict', cfgArgs(c));
const routerRelay = (inst, target, data) => encodeFunctionData({ abi: A.router, functionName: 'relay', args: [target, data] });
const routerDeployRelay = (c, data) => encodeFunctionData({ abi: A.router, functionName: 'deployAndRelay', args: [...cfgArgs(c), data] });
const vcall = (fn, args) => encodeFunctionData({ abi: A.vault, functionName: fn, args });

/** Build + sign an owner intent for `pocket` (a deployed OR counterfactual Pocket). Returns {dl, sig}. */
async function intent(pocket, ownerAcc, action, paramsHex, { nonceOverride } = {}) {
  const nonce = nonceOverride ?? ((await hasCode(pocket)) ? await read(pocket, A.vault, 'nonce') : 0n);
  const dl = BigInt((await chainTs()) + 3600);
  const digest = intentDigest({ action, vault: pocket, nonce, deadline: dl, params: paramsHex, chainId: 9800n });
  return { dl, sig: sign(ownerAcc.pqc, digest), nonce, digest };
}
const dropState = async (inst, id) => ['None', 'Open', 'Bound', 'Confirmed', 'Claimed', 'Cancelled', 'Refunded'][Number((await read(inst.drop.address, A.drop, 'getLink', [id])).state)];

/** Fresh link key; returns what a link carries. */
const linkKey = () => mldsa.keygen();

/* =================================================================================================================
   0. People
================================================================================================================= */
log('\n== 0. accounts');
const S = await fresh('sender-owner');
await register('sender-owner S', S);
const B = await fresh('attacker-B (second person, own proven key)');
await register('attacker B', B);
const C1 = await fresh('pool-claimer-1');
await register('pool claimer C1', C1);
const C2 = await fresh('pool-claimer-2');
await register('pool claimer C2', C2);
const R = await fresh('recipient-newcomer', '0'); // starts with NOTHING: bind drip pays its registration fee
const NOKEY = await fresh('account-without-pq-key', '0');
const main = await loadMain();

/* =================================================================================================================
   1. PROD: counterfactual Pocket funded BEFORE deploy, lazy deploy through the router, spend
================================================================================================================= */
log('\n== 1. counterfactual Pocket (prod)');
const PS_CFG = pocketCfg(S, { limit: parseEther('2') });
const PS = await predict(P, PS_CFG);
if (await hasCode(PS)) throw new Error('predicted address already has code');
{
  const f = await evm.send({ to: PS, value: parseEther('1.5'), gas: 40000n });
  rec('S1 plain QOR send to the Pocket address BEFORE it exists (counterfactual funding)', f.hash, f.receipt.status, `address ${PS} has no code, balance ${formatEther(await pub.getBalance({ address: PS }))} QOR`);
  if (await hasCode(PS)) throw new Error('code appeared early');
}
const spend1 = await intent(PS, S, ACT.SPEND, params.spend(evm.address, parseEther('0.05')));
const spend1Data = vcall('spend', [evm.address, parseEther('0.05'), spend1.dl, spend1.sig]);
await ok('S2 lazy deploy + first intent through PocketRouter(prod): deploys the Pocket, then spends 0.05 QOR (ML-DSA signature checked by pqcVerify)',
  relayer, P.router.address, routerDeployRelay(PS_CFG, spend1Data), 0n, 'Pocket deployed and spent');
if (!(await hasCode(PS))) throw new Error('pocket not deployed');
const psBal = await pub.getBalance({ address: PS });
if (psBal !== parseEther('1.45')) throw new Error('funds before deploy not intact ' + psBal);
log('Pocket balance after deploy+spend', formatEther(psBal), '(funded before deploy: intact)');
// cross-check: the JS digest equals the contract's own view
{
  const d = await intent(PS, S, ACT.SPEND, params.spend(evm.address, 1n));
  const onchain = await read(PS, A.vault, 'intentDigest', [ACT.SPEND, d.nonce, d.dl, params.spend(evm.address, 1n)]);
  if (onchain !== d.digest) throw new Error('digest mismatch JS vs contract');
  rec('check: JS intent digest == PocketVault.intentDigest (on-chain view)', null, 'info', onchain);
}

/* ATTACKS on the Pocket: replay, wrong key, router off-list, relayer off-list */
log('\n== 1b. vault attacks (prod)');
await reverts('ATTACK replayed intent (same signed spend submitted again)', relayer, P.router.address, routerRelay(P, PS, spend1Data), 'BadSignature');
{
  const bad = await intent(PS, B, ACT.SPEND, params.spend(B.evm, parseEther('0.05'))); // B signs a spend of S's Pocket
  await reverts('ATTACK vault spend signed by a wrong (but PoP-proven) key', relayer, P.router.address,
    routerRelay(P, PS, vcall('spend', [B.evm, parseEther('0.05'), bad.dl, bad.sig])), 'BadSignature');
}
await reverts('ATTACK router targeting a non-Pocket address', relayer, P.router.address, routerRelay(P, B.evm, '0x'), 'NotAllowed');
{
  // the relayer's EVM window lists only [router prod, router lab, PocketDrop v3]: a tx to anything else never reaches a block
  const offList = [[P.drop.address, 'PocketDrop v4 (prod)'], [PS, 'a Pocket directly']];
  for (const [target, label] of offList) {
    let refused = '';
    try { await relayer.wallet.sendTransaction({ to: target, data: '0x', gas: 60000n, type: 'legacy', gasPrice: await pub.getGasPrice() }); refused = 'NOT REFUSED'; } catch (e) { refused = String(e.details ?? e.cause?.details ?? e.cause?.message ?? e.shortMessage ?? e.message).replace(/\s+/g, ' ').slice(0, 400); }
    if (refused === 'NOT REFUSED') throw new Error('off-list target was accepted for ' + label);
    rec(`ATTACK relayer sends a tx to an off-list target (${label}): refused by the CHAIN at broadcast (never mined, no hash)`, null, 'refused', refused, { attack: true, minedTx: false });
  }
}

/* =================================================================================================================
   2. PROD: timelocked spend (24 h) cannot be executed early; owner vetoes it
================================================================================================================= */
log('\n== 2. above-limit spend on prod (24 h timelock)');
{
  const q = await intent(PS, S, ACT.SPEND, params.spend(evm.address, parseEther('2.5')));
  const rc = await ok('T1 spend of 2.5 QOR (> 2 QOR daily limit): queued, NOT paid, 24 h timelock', relayer, P.router.address,
    routerRelay(P, PS, vcall('spend', [evm.address, parseEther('2.5'), q.dl, q.sig])), 0n, 'queued id 1');
  const qd = await read(PS, A.vault, 'getQueued', [1n]);
  rec('check: queued entry', null, 'info', `to=${qd.to} amount=${formatEther(qd.amount)} unlockAt=${qd.unlockAt} (now+${Number(qd.unlockAt) - (await chainTs())}s)`);
  await reverts('ATTACK above-limit spend executed before the 24 h timelock ends', relayer, P.router.address,
    routerRelay(P, PS, vcall('executeQueued', [1n])), 'TooEarly');
  const v = await intent(PS, S, ACT.VETO_QUEUED, params.id(1));
  await ok('T2 owner vetoes the queued spend (ML-DSA intent)', relayer, P.router.address, routerRelay(P, PS, vcall('vetoQueued', [1n, v.dl, v.sig])), 0n, 'vetoed');
  if (Number((await read(PS, A.vault, 'getQueued', [1n])).state) !== 3) throw new Error('not vetoed');
}

/* =================================================================================================================
   3. PROD: createDrop -> bind -> confirm -> claim into the recipient's counterfactual Pocket
================================================================================================================= */
log('\n== 3. drop journey (prod)');
const PR_CFG = pocketCfg(R, { limit: parseEther('1') });
const PR = await predict(P, PR_CFG);
const lk1 = linkKey();
const exp1 = BigInt((await chainTs()) + 3000);
const AMT = parseEther('0.3');
const DRIP = parseEther('0.1');
const FEE = parseEther('0.02');
let id1;
{
  const p = params.createDrop(P.drop.address, keccak256(hx(lk1.publicKey)), 0, exp1, DRIP, FEE, AMT + DRIP + FEE);
  const it = await intent(PS, S, ACT.CREATE_DROP, p);
  await ok('D1 sender Pocket creates a Confirmed drop (0.3 QOR + 0.1 drip + 0.02 relayer fee) by intent', relayer, P.router.address,
    routerRelay(P, PS, vcall('createDrop', [P.drop.address, keccak256(hx(lk1.publicKey)), 0, exp1, DRIP, FEE, AMT + DRIP + FEE, it.dl, it.sig])), 0n, 'link created');
  id1 = await read(P.drop.address, A.drop, 'linkCount');
  const l = await read(P.drop.address, A.drop, 'getLink', [id1]);
  if (getAddress(l.sender) !== getAddress(PS)) throw new Error('sender is not the Pocket');
}
const bindData = async (inst, id, lk, rec_, recKeyHash, payTo, sigKey = lk) => {
  const digest = await read(inst.drop.address, A.drop, 'bindDigest', [id, rec_, recKeyHash, payTo]);
  return encodeFunctionData({ abi: A.drop, functionName: 'bind', args: [id, rec_, recKeyHash, payTo, hx(lk.publicKey), sign(sigKey, digest)] });
};
const claimData = async (inst, id, rec_, payTo, key) => {
  const digest = await read(inst.drop.address, A.drop, 'claimDigest', [id, rec_, payTo]);
  return encodeFunctionData({ abi: A.drop, functionName: 'claim', args: [id, sign(key, digest)] });
};
{
  // ATTACK 1: a mempool thief swaps the recipient (and payTo) of the signed bind
  // the thief takes the legit link signature and swaps recipient / key / payTo
  const digestLegit = await read(P.drop.address, A.drop, 'bindDigest', [id1, R.evm, keyHash(R), PR]);
  const sigLegit = sign(lk1, digestLegit);
  const thief = encodeFunctionData({ abi: A.drop, functionName: 'bind', args: [id1, B.evm, keyHash(B), B.evm, hx(lk1.publicKey), sigLegit] });
  await reverts('ATTACK 1 mempool thief swaps recipient/payTo in a signed bind (v3 attack 1)', relayer, P.router.address, routerRelay(P, P.drop.address, thief), 'BadLinkSignature');
  const before = await pub.getBalance({ address: relayer.address });
  await ok('D2 relayer binds R (recipient account R, payout Pocket PR). Drip lands in R, relayerFee reaches the relayer through the router sweep',
    relayer, P.router.address, routerRelay(P, P.drop.address, await bindData(P, id1, lk1, R.evm, keyHash(R), PR)), 0n, 'bound');
  const rBal = await pub.getBalance({ address: R.evm });
  if (rBal !== DRIP) throw new Error('drip not in recipient account: ' + rBal);
  log('recipient R account balance after bind (drip):', formatEther(rBal), 'QOR; relayer delta incl. gas', formatEther((await pub.getBalance({ address: relayer.address })) - before));
}
await register('newcomer R (fee paid from the drip, R started with 0 QOR)', R);
{
  // ATTACK 5/2 happen on a Confirmed link after confirm. First: the sender check, one tap
  const fp = keyHash(R);
  const it = await intent(PS, S, ACT.CONFIRM_DROP, params.confirm(P.drop.address, id1, fp));
  const wrong = await intent(PS, S, ACT.CONFIRM_DROP, params.confirm(P.drop.address, id1, keyHash(B)));
  await reverts('ATTACK sender confirms a recipient key it never checked (RecipientChanged)', relayer, P.router.address,
    routerRelay(P, PS, vcall('confirmDrop', [P.drop.address, id1, keyHash(B), wrong.dl, wrong.sig])), 'RecipientChanged', 600000n);
  await ok('D3 sender confirms the recipient key fingerprint in ONE intent (no second device)', relayer, P.router.address,
    routerRelay(P, PS, vcall('confirmDrop', [P.drop.address, id1, fp, it.dl, it.sig])), 0n, 'confirmed');
  const bad = await claimData(P, id1, R.evm, PR, B.pqc);
  await reverts('ATTACK 5 a second person (B, own proven key) claims the Confirmed link', relayer, P.router.address, routerRelay(P, P.drop.address, bad), 'BadRecipientSignature');
  const other = mldsa.keygen();
  await reverts('ATTACK 2 claim signed by a key other than the registered one', relayer, P.router.address, routerRelay(P, P.drop.address, await claimData(P, id1, R.evm, PR, other)), 'BadRecipientSignature');
  const c = await intent(PS, S, ACT.CANCEL_DROP, params.cancel(P.drop.address, id1));
  await reverts('ATTACK 6 sender cancels after confirming (v3 attack 6)', relayer, P.router.address,
    routerRelay(P, PS, vcall('cancelDrop', [P.drop.address, id1, c.dl, c.sig])), 'InvalidState', 600000n);
  const before = await pub.getBalance({ address: PR });
  await ok('D4 relayer claims with the recipient signature: 0.3 QOR lands in the recipient POCKET', relayer, P.router.address,
    routerRelay(P, P.drop.address, await claimData(P, id1, R.evm, PR, R.pqc)), 0n, 'amount paid to the Pocket');
  const gain = (await pub.getBalance({ address: PR })) - before;
  if (gain !== AMT) throw new Error('PR gain ' + gain);
  if (await hasCode(PR)) throw new Error('PR unexpectedly deployed');
  rec('check: recipient Pocket got the money while still undeployed', null, 'info', `${PR} balance ${formatEther(gain)} QOR, code none, link state ${await dropState(P, id1)}`);
  await reverts('D5 claim of an already claimed link', relayer, P.router.address, routerRelay(P, P.drop.address, await claimData(P, id1, R.evm, PR, R.pqc)), 'InvalidState');
}
{
  const sp = await intent(PR, R, ACT.SPEND, params.spend(evm.address, parseEther('0.05')));
  await ok('D6 recipient first action: lazy-deploys its own Pocket through the router and spends 0.05 QOR from it', relayer, P.router.address,
    routerDeployRelay(PR_CFG, vcall('spend', [evm.address, parseEther('0.05'), sp.dl, sp.sig])), 0n, 'Pocket deployed, spend ok');
  if ((await pub.getBalance({ address: PR })) !== parseEther('0.25')) throw new Error('PR balance');
}

/* ATTACKS 3 and 4 + pool-less remaining v3 attacks on Open-mode links (short expiry, refunded at the end) */
log('\n== 4. attacks 3 and 4 (open links, refunded later)');
const toRefund = [];
{
  const mk = async (label, ttl = 240) => {
    const lk = linkKey();
    const exp = BigInt((await chainTs()) + ttl);
    const v = parseEther('0.1');
    const it = await intent(PS, S, ACT.CREATE_DROP, params.createDrop(P.drop.address, keccak256(hx(lk.publicKey)), 1, exp, 0n, 0n, v));
    await ok(label, relayer, P.router.address, routerRelay(P, PS, vcall('createDrop', [P.drop.address, keccak256(hx(lk.publicKey)), 1, exp, 0n, 0n, v, it.dl, it.sig])), 0n, 'link created');
    const id = await read(P.drop.address, A.drop, 'linkCount');
    toRefund.push({ id, exp });
    return { id, lk };
  };
  const st = await keyStatus(main.evm);
  const l3 = await mk('A3a create Open link (0.1 QOR, expiry +240 s)');
  await ok('A3b bind to the main test wallet (legacy key, possessionProven=false) with payout Pocket PS', relayer, P.router.address,
    routerRelay(P, P.drop.address, await bindData(P, l3.id, l3.lk, main.evm, keccak256(st.pubkey), PS)), 0n, 'bound');
  rec('check: main wallet key status', null, 'info', `registered=${st.registered} possessionProven=${st.possessionProven}`);
  await reverts('ATTACK 3 claim into an account whose key has possessionProven=false (v3 attack 3)', relayer, P.router.address,
    routerRelay(P, P.drop.address, encodeFunctionData({ abi: A.drop, functionName: 'claim', args: [l3.id, hx(new Uint8Array(4627))] })), 'PossessionNotProven');
  const l4 = await mk('A4a create Open link (0.1 QOR, expiry +240 s)');
  const kg = mldsa.keygen();
  await ok('A4b bind to an account that has no PQ key', relayer, P.router.address,
    routerRelay(P, P.drop.address, await bindData(P, l4.id, l4.lk, NOKEY.evm, keccak256(hx(kg.publicKey)), PS)), 0n, 'bound');
  await reverts('ATTACK 4 claim into an account with no PQ key (v3 attack 4)', relayer, P.router.address,
    routerRelay(P, P.drop.address, encodeFunctionData({ abi: A.drop, functionName: 'claim', args: [l4.id, hx(new Uint8Array(4627))] })), 'NotRegistered');
}

/* =================================================================================================================
   5. PROD: Drop Pool with 2 distinct claimers, a double claim by one account, close
================================================================================================================= */
log('\n== 5. pool (prod)');
{
  const pk = linkKey();
  const expP = BigInt((await chainTs()) + 3000);
  const per = parseEther('0.05');
  const it = await intent(PS, S, ACT.CREATE_POOL, params.createPool(P.pool.address, keccak256(hx(pk.publicKey)), 3, per, expP));
  await ok('P1 sender Pocket hosts a Drop Pool (3 slots x 0.05 QOR) by intent', relayer, P.router.address,
    routerRelay(P, PS, vcall('createPool', [P.pool.address, keccak256(hx(pk.publicKey)), 3, per, expP, it.dl, it.sig])), 0n, 'pool created');
  const pid = await read(P.pool.address, A.pool, 'poolCount');
  const claimPool = async (acc, payTo) => {
    const ld = await read(P.pool.address, A.pool, 'linkDigest', [pid, acc.evm, payTo]);
    const cd = await read(P.pool.address, A.pool, 'claimDigest', [pid, acc.evm, payTo]);
    if (ld !== poolDigest({ domain: 'POCKET_POOL_LINK_V1', pool: P.pool.address, id: pid, recipient: acc.evm, payTo })) throw new Error('pool digest JS/contract mismatch');
    return encodeFunctionData({ abi: A.pool, functionName: 'claim', args: [pid, acc.evm, payTo, hx(pk.publicKey), sign(pk, ld), sign(acc.pqc, cd)] });
  };
  const pay1 = await predict(P, pocketCfg(C1, { limit: parseEther('1') }));
  const pay2 = await predict(P, pocketCfg(C2, { limit: parseEther('1') }));
  const c1data = await claimPool(C1, pay1);
  await ok('P2 claimer C1 claims slot 1 (distinct PoP account; link-key sig + own sig); 0.05 QOR into C1\'s counterfactual Pocket', relayer, P.router.address, routerRelay(P, P.pool.address, c1data), 0n, 'slot paid');
  await ok('P3 claimer C2 claims slot 2', relayer, P.router.address, routerRelay(P, P.pool.address, await claimPool(C2, pay2)), 0n, 'slot paid');
  if ((await pub.getBalance({ address: pay1 })) !== per || (await pub.getBalance({ address: pay2 })) !== per) throw new Error('pool payouts wrong');
  await reverts('ATTACK pool slot claimed twice by one account (C1 again)', relayer, P.router.address, routerRelay(P, P.pool.address, c1data), 'AlreadyClaimed');
  const stM = await keyStatus(main.evm);
  rec('check: pool claimers are accounts, not people', null, 'info', `taken=${(await read(P.pool.address, A.pool, 'getPool', [pid])).taken} of 3; main wallet possessionProven=${stM.possessionProven} cannot claim`);
  const cl = await intent(PS, S, ACT.CLOSE_POOL, params.closePool(P.pool.address, pid));
  const before = await pub.getBalance({ address: PS });
  await ok('P4 host Pocket closes the pool: the unclaimed slot returns to the Pocket', relayer, P.router.address, routerRelay(P, PS, vcall('closePool', [P.pool.address, pid, cl.dl, cl.sig])), 0n, 'refunded');
  if ((await pub.getBalance({ address: PS })) - before !== per) throw new Error('pool refund wrong');
}

/* =================================================================================================================
   6. LEGACY RESCUE: the main test wallet (PoP=false) sends into a Pocket
================================================================================================================= */
log('\n== 6. legacy rescue');
{
  const st = await keyStatus(main.evm);
  if (st.possessionProven) throw new Error('main wallet unexpectedly has PoP');
  const before = await pub.getBalance({ address: PS });
  const bech = evmToQor(PS);
  const h = await fundFromMain(main, bech, 50000); // 0.05 QOR, hybrid-signed cosmos MsgSend (QoreX lane)
  await sleep(4000);
  const gain = (await pub.getBalance({ address: PS })) - before;
  rec('LEGACY RESCUE main test wallet (possessionProven=false) sends 0.05 QOR into a Pocket', h, 'success', `Pocket ${PS} (${bech}) balance +${formatEther(gain)} QOR; the Pocket's owner is PoP-proven, the sender is not`, { cosmosTx: true, url: EXPL + h });
  if (gain !== parseEther('0.05')) throw new Error('legacy rescue amount ' + gain);
}

/* =================================================================================================================
   7. LAB (60 s delays): timelocked spend + veto, recovery 1-of-3, veto, finalize
================================================================================================================= */
log('\n== 7. lab pocket');
const L_OWNER = await fresh('lab-owner');
await register('lab owner', L_OWNER);
const G1 = await fresh('guardian-1');
await register('guardian G1', G1);
const G2 = await fresh('guardian-2');
await register('guardian G2', G2);
const G3 = await fresh('guardian-3');
await register('guardian G3', G3);
const N = await fresh('new-owner-after-recovery');
await register('new owner N', N);
const PL_CFG = pocketCfg(L_OWNER, { guardians: [G1, G2, G3], threshold: 2, limit: parseEther('0.2') });
const PL = await predict(L, PL_CFG);
{
  await evm.send({ to: PL, value: parseEther('1.2'), gas: 40000n }).then((f) => rec('LAB: fund the counterfactual lab Pocket 1.2 QOR before deploy', f.hash, f.receipt.status, PL));
  const d = await ok('LAB: deploy the lab Pocket (2-of-3 guardians, 0.2 QOR daily limit, 60 s timelock, 60 s recovery) via router, empty data', relayer, L.router.address,
    routerDeployRelay(PL_CFG, '0x'), 0n, 'deployed');
  void d;
  const vt = await read(PL, A.vault, 'TIMELOCK');
  const rd = await read(PL, A.vault, 'RECOVERY_DELAY');
  rec('check: lab delays', null, 'info', `TIMELOCK=${vt}s RECOVERY_DELAY=${rd}s; prod TIMELOCK=${P.readBack.TIMELOCK}s RECOVERY_DELAY=${P.readBack.RECOVERY_DELAY}s`);
}
/* timelocked spend + veto */
{
  const q = await intent(PL, L_OWNER, ACT.SPEND, params.spend(evm.address, parseEther('0.5')));
  await ok('TL1 lab: spend 0.5 QOR (> 0.2 limit) is queued with a 60 s timelock', relayer, L.router.address, routerRelay(L, PL, vcall('spend', [evm.address, parseEther('0.5'), q.dl, q.sig])), 0n, 'queued id 1');
  await reverts('ATTACK lab: execute the queued spend before the timelock ends', relayer, L.router.address, routerRelay(L, PL, vcall('executeQueued', [1n])), 'TooEarly');
  const v = await intent(PL, L_OWNER, ACT.VETO_QUEUED, params.id(1));
  await ok('TL2 lab: owner vetoes the queued spend', relayer, L.router.address, routerRelay(L, PL, vcall('vetoQueued', [1n, v.dl, v.sig])), 0n, 'vetoed');
  const q2 = await intent(PL, L_OWNER, ACT.SPEND, params.spend(evm.address, parseEther('0.3')));
  await ok('TL3 lab: another over-limit spend (0.3 QOR) is queued (id 2)', relayer, L.router.address, routerRelay(L, PL, vcall('spend', [evm.address, parseEther('0.3'), q2.dl, q2.sig])), 0n, 'queued id 2');
  const unlock = Number((await read(PL, A.vault, 'getQueued', [2n])).unlockAt);
  await waitChainTs(unlock + 2);
  await reverts('TL4 lab: the vetoed spend can never execute, even after the timelock', relayer, L.router.address, routerRelay(L, PL, vcall('executeQueued', [1n])), 'NotQueued');
  const before = await pub.getBalance({ address: PL });
  await ok('TL5 lab: after the timelock the un-vetoed spend (id 2) executes', relayer, L.router.address, routerRelay(L, PL, vcall('executeQueued', [2n])), 0n, '0.3 QOR paid');
  if (before - (await pub.getBalance({ address: PL })) !== parseEther('0.3')) throw new Error('queued payout wrong');
}
/* recovery */
{
  const recDigest = (newOwner, nkh, dl, rn) => read(PL, A.vault, 'recoveryDigest', [newOwner, nkh, dl]).then((d) => ({ d, rn }));
  const dl = BigInt((await chainTs()) + 3600);
  const { d: dig1 } = await recDigest(N.evm, keyHash(N), dl);
  const sigsOf = (digest, gs) => gs.map((g) => sign(g.pqc, digest));
  await reverts('ATTACK recovery with only 1 of 3 guardians', relayer, L.router.address,
    routerRelay(L, PL, vcall('proposeRecovery', [N.evm, keyHash(N), dl, [G1.evm], sigsOf(dig1, [G1])])), 'NotEnoughSigners', 600000n);
  await ok('RC1 recovery proposed by 2 of 3 guardians (G1 + G2 ML-DSA signatures), 60 s delay', relayer, L.router.address,
    routerRelay(L, PL, vcall('proposeRecovery', [N.evm, keyHash(N), dl, [G1.evm, G2.evm], sigsOf(dig1, [G1, G2])])), 0n, 'pending');
  const v = await intent(PL, L_OWNER, ACT.VETO_RECOVERY, params.none());
  await ok('RC2 the OLD owner key vetoes the recovery', relayer, L.router.address, routerRelay(L, PL, vcall('vetoRecovery', [v.dl, v.sig])), 0n, 'recovery vetoed');
  await reverts('ATTACK finalize a vetoed recovery', relayer, L.router.address, routerRelay(L, PL, vcall('finalizeRecovery', [])), 'NoRecoveryPending');
  // the vetoed proposal's guardian signatures cannot be replayed (recovery nonce moved on)
  await reverts('ATTACK replay the vetoed proposal\'s guardian signatures', relayer, L.router.address,
    routerRelay(L, PL, vcall('proposeRecovery', [N.evm, keyHash(N), dl, [G1.evm, G2.evm], sigsOf(dig1, [G1, G2])])), 'BadSignature', 600000n);
  // fresh proposal with G2 + G3, finalize after the delay
  const dl2 = BigInt((await chainTs()) + 3600);
  const { d: dig2 } = await recDigest(N.evm, keyHash(N), dl2);
  await ok('RC3 fresh recovery proposal (G2 + G3)', relayer, L.router.address,
    routerRelay(L, PL, vcall('proposeRecovery', [N.evm, keyHash(N), dl2, [G2.evm, G3.evm], sigsOf(dig2, [G2, G3])])), 0n, 'pending');
  await reverts('ATTACK finalize before the recovery delay', relayer, L.router.address, routerRelay(L, PL, vcall('finalizeRecovery', [])), 'TooEarly');
  const at = Number(await read(PL, A.vault, 'recoveryAt'));
  await waitChainTs(at + 2);
  await ok('RC4 finalize after the delay: owner is now N', relayer, L.router.address, routerRelay(L, PL, vcall('finalizeRecovery', [])), 0n, 'owner replaced');
  if (getAddress(await read(PL, A.vault, 'owner')) !== getAddress(N.evm)) throw new Error('owner not replaced');
  const old = await intent(PL, L_OWNER, ACT.SPEND, params.spend(evm.address, parseEther('0.01')));
  await reverts('ATTACK the OLD owner key spends after recovery', relayer, L.router.address,
    routerRelay(L, PL, vcall('spend', [evm.address, parseEther('0.01'), old.dl, old.sig])), 'BadSignature');
  const nw = await intent(PL, N, ACT.SPEND, params.spend(evm.address, parseEther('0.01')));
  await ok('RC5 the NEW owner spends from the recovered Pocket', relayer, L.router.address,
    routerRelay(L, PL, vcall('spend', [evm.address, parseEther('0.01'), nw.dl, nw.sig])), 0n, 'new key works');
}

/* =================================================================================================================
   8. wait for the short-expiry attack links, then refund them
================================================================================================================= */
log('\n== 8. refunds');
{
  const latest = toRefund.reduce((m, l) => (l.exp > m ? l.exp : m), 0n);
  await waitChainTs(Number(latest) + 2);
  for (const l of toRefund) {
    await ok(`G refund link ${l.id} after expiry (anyone may; escrow returns to the sender Pocket)`, evm, P.drop.address, encodeFunctionData({ abi: A.drop, functionName: 'refund', args: [l.id] }), 0n, 'refunded to Pocket');
  }
}

/* =================================================================================================================
   summary + PqGuard example
================================================================================================================= */
{
  const ctrAbi = artifact('PqGuardedCounter').abi;
  const dg = await read(COUNTER, ctrAbi, 'bumpDigest', [PS]);
  const sig = sign(S.pqc, dg);
  await ok('PQGUARD example dApp: PqGuardedCounter.bump(PocketA) accepts the Pocket owner\'s ML-DSA approval via ERC-1271', evm, COUNTER,
    encodeFunctionData({ abi: ctrAbi, functionName: 'bump', args: [PS, sig] }), 0n, 'counted');
  if ((await read(COUNTER, ctrAbi, 'count', [PS])) !== 1n) throw new Error('counter');
}
const endBal = await pub.getBalance({ address: evm.address });
const endRel = await pub.getBalance({ address: relayer.address });
dep.liveSummary = {
  ranAt: new Date().toISOString(),
  instances: { prod: { router: P.router.address, drop: P.drop.address, pool: P.pool.address, factory: P.factory.address }, lab: { router: L.router.address, drop: L.drop.address, pool: L.pool.address, factory: L.factory.address } },
  deployerNetQorIncludingFundsLeftInTestAccounts: formatEther(startBal - endBal),
  relayerNetQor: formatEther(startRelayerBal - endRel),
  pockets: { PS, PR, PL },
};
writeDeployments(dep);
const rows = dep.liveTxs.filter((t) => t.step).map((t) => `| ${t.step.replace(/\|/g, '/')} | ${t.status} | ${String(t.outcome).replace(/\|/g, '/')} | ${t.hash ? `[${t.hash.slice(0, 12)}...](${t.url})` : 'none (not mined)'} |`).join('\n');
fs.writeFileSync(path.join(ROOT, 'LIVE_RESULTS.md'), `# Live results (QoreChain Diana testnet, EVM chain id 9800)

Instances (vault with guardian freeze + unanimous recovery): PROD (24 h timelock / 48 h recovery / 72 h freeze / 72 h unanimous recovery) router \`${P.router.address}\`; LAB (60 s timelock and recovery, 120 s freeze, 180 s unanimous recovery) router \`${L.router.address}\`. The freeze / stolen-key scenarios are appended below the table (see test/live/run-freeze.mjs).
Every row with a hash is a mined transaction ("reverted" rows are the lab attacks: each was decoded with eth_call first, then mined with an explicit gas limit so the revert is on chain). Rows marked "refused" are transactions the chain refuses to BROADCAST (the relayer's EVM window does not list the target), so they have no hash by design.

| step | status | outcome / custom error | tx |
|---|---|---|---|
${rows}

Summary: ${JSON.stringify(dep.liveSummary, null, 2)}
`);
log('\nDONE', dep.liveSummary);

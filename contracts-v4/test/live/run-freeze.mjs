// Live scenarios for the stolen-key defence (QoreChain Diana TESTNET, EVM 9800), on the LAB instance
// (freeze 120 s, unanimous recovery 180 s, timelock 60 s). Every row is a mined transaction.
//   A. stolen key: thief drains within the daily limit, guardians freeze, thief spend reverts Frozen, unanimous recovery
//      proposed, thief veto reverts, finalize, new owner spends
//   B. a guardian freeze that expires (and the 2-freeze cap)
// The earlier paths that touch the vault (spend, queued spend + veto, threshold recovery + owner veto, drop create ->
// claim) are re-run by test/live/run.mjs against the same deployment.
//   node test/live/run-freeze.mjs
// Pinned to the v4 deployment (dep.v4): v4 finalize takes no arguments. The v5.2 finalize (signed authorization by the owner,
// a guardian or the approved new owner) is exercised live by script/smoke-v52.mjs (section R) on the v5.2 lab instance.
import fs from 'node:fs';
import path from 'node:path';
import { mldsa } from '@qorechain/pqc';
import { keccak256, toHex, parseEther, decodeErrorResult, encodeFunctionData, formatEther, parseAbi, getAddress } from 'viem';
import {
  loadDeployer, Evm, pub, windowOf, openWindow, artifact, readDeployments, writeDeployments, readSecrets, writeSecrets,
  newAccountRecord, accountFrom, registerWithPoP, keyStatus, EXPL, ROOT, sleep,
} from '../../script/lib.mjs';
import { ACT, params, intentDigest, pqMessage, freezeDigest, unanimousDigest } from '../../script/fixtures-lib.mjs';

const dep = readDeployments();
const L = dep.v4.lab;
const A = { vault: artifact('PocketVault').abi, factory: artifact('PocketFactory').abi, router: artifact('PocketRouter').abi };
const LIB_ERRORS = parseAbi(['error KeyUnavailable()', 'error NotRegistered()', 'error UnsupportedAlgo()', 'error PossessionNotProven()', 'error KeyMismatch()']);
const ALL_ABI = [...A.vault, ...A.factory, ...A.router, ...LIB_ERRORS];

const deployer = await loadDeployer();
const evm = new Evm(deployer);
const relayerAcc = await accountFrom(JSON.parse(fs.readFileSync(process.env.RELAYER_SECRET_FILE ?? 'D:/route/QORE/.secrets/pocketdrop-relayer.json', 'utf8')));
const relayer = new Evm(relayerAcc);
const log = (...a) => console.log(...a);
const u8 = (h) => Uint8Array.from(Buffer.from(h.slice(2), 'hex'));
const hx = (u) => toHex(u);
const startDep = await pub.getBalance({ address: evm.address });
const startRel = await pub.getBalance({ address: relayer.address });
dep.liveFreezeTxs = [];

function rec(step, hash, status, outcome, extra = {}) {
  dep.liveFreezeTxs.push({ step, hash, url: hash ? EXPL + hash : null, status, outcome, ...extra });
  writeDeployments(dep);
  log(`${status === 'success' ? 'OK  ' : status === 'reverted' ? 'REV ' : 'INFO'} ${step} -> ${outcome}  ${hash ?? ''}`);
}
const chainTs = async () => Number((await pub.getBlock()).timestamp);
async function waitChainTs(t) { while ((await chainTs()) < t) await sleep(1500); }
const read = (address, abi, functionName, args = []) => pub.readContract({ address, abi, functionName, args });
const hasCode = async (a) => ((await pub.getCode({ address: a })) ?? '0x') !== '0x';

async function ok(step, sender, to, data, value = 0n, outcome = 'ok') {
  const est = await pub.estimateGas({ account: sender.address, to, data, value });
  const { hash, receipt } = await sender.send({ to, data, value, gas: (est * 13n) / 10n });
  if (receipt.status !== 'success') throw new Error(step + ' unexpectedly reverted ' + hash);
  rec(step, hash, 'success', outcome, { gasUsed: String(receipt.gasUsed) });
  return receipt;
}
async function reverts(step, sender, to, data, errName, gas = 700000n) {
  let name = '?';
  try { await pub.call({ account: sender.address, to, data }); name = 'NO REVERT'; } catch (e) {
    const d = e.walk?.((x) => typeof x?.data === 'string')?.data ?? e.data;
    try { name = decodeErrorResult({ abi: ALL_ABI, data: d }).errorName; } catch { name = 'undecodable:' + String(d).slice(0, 10); }
  }
  if (name !== errName) throw new Error(`${step}: expected ${errName}, eth_call gave ${name}`);
  const { hash, receipt } = await sender.send({ to, data, value: 0n, gas });
  if (receipt.status !== 'reverted') throw new Error(step + ' was not reverted on-chain ' + hash);
  rec(step, hash, 'reverted', errName, { expected: true, attack: true });
}

/* accounts: guardians G1..G3 are the lab guardians of the main run (latest records by role); T, N, E are fresh */
const secrets = readSecrets();
secrets.v4Accounts ??= [];
const lastByRole = async (role) => {
  const r = [...secrets.v4Accounts].reverse().find((x) => x.role === role);
  if (!r) throw new Error('missing account role ' + role + ' (run test/live/run.mjs first)');
  return accountFrom(r);
};
async function fresh(role, fundQor = '0.12') {
  const { acc, record } = await newAccountRecord(role);
  secrets.v4Accounts.push(record);
  writeSecrets(secrets);
  const f = await evm.send({ to: acc.evm, value: parseEther(fundQor), gas: 40000n });
  rec(`fund ${role} ${fundQor} QOR (for its PQ registration fee)`, f.hash, f.receipt.status, 'funded');
  const r = await registerWithPoP(acc);
  const ks = await keyStatus(acc.evm);
  rec(`${role} registers its ML-DSA-87 key with proof of possession`, r.hash, 'success', `possessionProven=${ks.possessionProven}`);
  return acc;
}
const keyHash = (acc) => keccak256(hx(acc.pqc.publicKey));
const sign = (acc, digest) => hx(mldsa.sign(acc.pqc.secretKey, u8(pqMessage(digest))));

const w = await windowOf(deployer);
if (!w.live || w.remainingTxs < 80n) { await openWindow(deployer, { maxTxs: 200, valueUqor: 6_000_000n }); log('reopened deployer window'); }

const G = [await lastByRole('guardian-1'), await lastByRole('guardian-2'), await lastByRole('guardian-3')];
for (const g of G) if (!(await keyStatus(g.evm)).possessionProven) throw new Error('guardian not proven');
log('\n== accounts');
const T = await fresh('freeze-demo-thief (holds the stolen owner key)');
const N = await fresh('freeze-demo-new-owner');
const E = await fresh('freeze-demo-expiry-owner');

const salt = () => keccak256(toHex(crypto.getRandomValues(new Uint8Array(32))));
const cfgOf = (owner, limit) => ({ owner: owner.evm, guardians: G.map((g) => g.evm), threshold: 2, limit, userSalt: salt() });
const cfgArgs = (c) => [c.owner, c.guardians, c.threshold, c.limit, c.userSalt];
const routerRelay = (target, data) => encodeFunctionData({ abi: A.router, functionName: 'relay', args: [target, data] });
const routerDeployRelay = (c, data) => encodeFunctionData({ abi: A.router, functionName: 'deployAndRelay', args: [...cfgArgs(c), data] });
const vcall = (fn, args) => encodeFunctionData({ abi: A.vault, functionName: fn, args });
async function intent(pocket, ownerAcc, action, paramsHex) {
  const nonce = (await hasCode(pocket)) ? await read(pocket, A.vault, 'nonce') : 0n;
  const dl = BigInt((await chainTs()) + 3600);
  const digest = intentDigest({ action, vault: pocket, nonce, deadline: dl, params: paramsHex, chainId: 9800n });
  return { dl, sig: sign(ownerAcc, digest) };
}
const relay = (pocket, fn, args) => routerRelay(pocket, vcall(fn, args));
const info = async (pocket) => ({
  frozen: await read(pocket, A.vault, 'frozen'), frozenUntil: Number(await read(pocket, A.vault, 'frozenUntil')),
  streak: Number(await read(pocket, A.vault, 'freezeStreak')), uAt: Number(await read(pocket, A.vault, 'uRecoveryAt')),
});
async function freezeArgs(pocket, signers) {
  const n = await read(pocket, A.vault, 'freezeNonce');
  const dl = BigInt((await chainTs()) + 3600);
  const d = await read(pocket, A.vault, 'freezeDigest', [n, dl]);
  if (d !== freezeDigest({ vault: pocket, nonce: n, deadline: dl })) throw new Error('freeze digest mismatch JS vs contract');
  return [signers.map((g) => g.evm), signers.map((g) => sign(g, d)), n, dl];
}
async function unanimousArgs(pocket, newOwner, signers) {
  const dl = BigInt((await chainTs()) + 3600);
  const d = await read(pocket, A.vault, 'unanimousDigest', [newOwner.evm, keyHash(newOwner), dl]);
  const rn = await read(pocket, A.vault, 'recoveryNonce');
  if (d !== unanimousDigest({ vault: pocket, recNonce: rn, newOwner: newOwner.evm, newKeyHash: keyHash(newOwner), deadline: dl })) throw new Error('unanimous digest mismatch JS vs contract');
  return [newOwner.evm, keyHash(newOwner), dl, signers.map((g) => g.evm), signers.map((g) => sign(g, d))];
}

/* ============================== A. stolen key ============================== */
log('\n== A. stolen key (lab: freeze 120 s, unanimous recovery 180 s)');
const FRZ = Number(await read(L.vaultImpl.address, A.vault, 'FREEZE_PERIOD'));
const UNA = Number(await read(L.vaultImpl.address, A.vault, 'UNANIMOUS_RECOVERY_DELAY'));
rec('check: lab FREEZE_PERIOD / UNANIMOUS_RECOVERY_DELAY read from the deployed implementation', null, 'info', `FREEZE_PERIOD=${FRZ}s UNANIMOUS_RECOVERY_DELAY=${UNA}s`);
const CA = cfgOf(T, parseEther('0.2'));
const PA = await read(L.factory.address, A.factory, 'predict', cfgArgs(CA));
{
  const f = await evm.send({ to: PA, value: parseEther('0.7'), gas: 40000n });
  rec('A0 fund the counterfactual Pocket 0.7 QOR (owner key = the key the thief will steal)', f.hash, f.receipt.status, PA);
}
{
  const s = await intent(PA, T, ACT.SPEND, params.spend(evm.address, parseEther('0.15')));
  await ok('A1 THIEF (holds the owner key) spends 0.15 QOR of the 0.2 QOR daily limit BEFORE any freeze: the residual risk', relayer, L.router.address,
    routerDeployRelay(CA, vcall('spend', [evm.address, parseEther('0.15'), s.dl, s.sig])), 0n, 'paid (within daily limit)');
  const q = await intent(PA, T, ACT.SPEND, params.spend(evm.address, parseEther('0.5')));
  await ok('A2 THIEF queues a 0.5 QOR spend (above the remaining allowance, 60 s timelock)', relayer, L.router.address,
    routerRelay(PA, vcall('spend', [evm.address, parseEther('0.5'), q.dl, q.sig])), 0n, 'queued id 1');
}
await ok('A3 GUARDIAN FREEZE: guardians G1 + G2 sign (threshold 2 of 3), the Pocket is frozen for FREEZE_PERIOD', relayer, L.router.address,
  routerRelay(PA, vcall('guardianFreeze', await freezeArgs(PA, [G[0], G[1]]))), 0n, 'frozen');
{
  const i = await info(PA);
  if (!i.frozen) throw new Error('not frozen');
  rec('check: frozen() / frozenUntil after the freeze', null, 'info', `frozen=${i.frozen} frozenUntil=${i.frozenUntil} (now+${i.frozenUntil - (await chainTs())}s)`);
}
{
  const s = await intent(PA, T, ACT.SPEND, params.spend(evm.address, parseEther('0.01')));
  await reverts('A4 ATTACK thief spend 0.01 QOR (genuine owner signature, inside the allowance) while frozen', relayer, L.router.address,
    routerRelay(PA, vcall('spend', [evm.address, parseEther('0.01'), s.dl, s.sig])), 'Frozen');
  const r = await intent(PA, T, ACT.SET_LIMIT, params.limit(parseEther('50')));
  await reverts('A5 ATTACK thief raises the daily limit while frozen', relayer, L.router.address, routerRelay(PA, vcall('setLimit', [parseEther('50'), r.dl, r.sig])), 'Frozen');
}
await reverts('A6 ATTACK unanimous recovery proposed with only 2 of 3 guardians', relayer, L.router.address,
  routerRelay(PA, vcall('proposeRecoveryUnanimous', await unanimousArgs(PA, N, [G[0], G[1]]))), 'NotEnoughSigners');
await ok('A7 UNANIMOUS RECOVERY proposed by ALL 3 guardians (G1 + G2 + G3), delay UNANIMOUS_RECOVERY_DELAY, new owner N', relayer, L.router.address,
  routerRelay(PA, vcall('proposeRecoveryUnanimous', await unanimousArgs(PA, N, G))), 0n, 'pending');
{
  const v = await intent(PA, T, ACT.VETO_RECOVERY, params.none());
  await reverts('A8 ATTACK thief vetoes the unanimous recovery with the old owner key', relayer, L.router.address, routerRelay(PA, vcall('vetoRecovery', [v.dl, v.sig])), 'NoRecoveryPending');
}
await reverts('A9 ATTACK finalize before the unanimous delay', relayer, L.router.address, routerRelay(PA, vcall('finalizeRecoveryUnanimous', [])), 'TooEarly');
{
  // the queued spend is ripe after its 60 s timelock, but the Pocket is frozen
  const unlock = Number((await read(PA, A.vault, 'getQueued', [1n])).unlockAt);
  await waitChainTs(unlock + 2);
  await reverts('A10 ATTACK execute the thief\'s ripe queued spend (timelock over) while frozen', relayer, L.router.address, routerRelay(PA, vcall('executeQueued', [1n])), 'Frozen');
  // after FREEZE_PERIOD ends the clock no longer freezes, but the pending unanimous recovery still does
  const i0 = await info(PA);
  await waitChainTs(i0.frozenUntil + 2);
  const i1 = await info(PA);
  rec('check: the freeze clock has run out but the pending unanimous recovery keeps the Pocket frozen', null, 'info', `now>frozenUntil=${(await chainTs()) > i1.frozenUntil} frozen()=${i1.frozen} uRecoveryAt=${i1.uAt}`);
  if (!i1.frozen) throw new Error('should still be frozen by the pending unanimous recovery');
  const s = await intent(PA, T, ACT.SPEND, params.spend(evm.address, parseEther('0.01')));
  await reverts('A11 ATTACK thief spend after the freeze clock ended, while the unanimous recovery is pending', relayer, L.router.address,
    routerRelay(PA, vcall('spend', [evm.address, parseEther('0.01'), s.dl, s.sig])), 'Frozen');
}
{
  await waitChainTs(Number(await read(PA, A.vault, 'uRecoveryAt')) + 2);
  await ok('A12 finalize the unanimous recovery after its delay: owner is now N (the thief key was never able to veto)', relayer, L.router.address,
    routerRelay(PA, vcall('finalizeRecoveryUnanimous', [])), 0n, 'owner replaced');
  if (getAddress(await read(PA, A.vault, 'owner')) !== getAddress(N.evm)) throw new Error('owner not replaced');
  const bal0 = await pub.getBalance({ address: PA });
  await reverts('A13 ATTACK execute the thief\'s queued spend after recovery (epoch bumped)', relayer, L.router.address, routerRelay(PA, vcall('executeQueued', [1n])), 'StaleEpoch');
  const old = await intent(PA, T, ACT.SPEND, params.spend(evm.address, parseEther('0.01')));
  await reverts('A14 ATTACK the stolen (old) owner key spends after recovery', relayer, L.router.address,
    routerRelay(PA, vcall('spend', [evm.address, parseEther('0.01'), old.dl, old.sig])), 'BadSignature');
  const nw = await intent(PA, N, ACT.SPEND, params.spend(evm.address, parseEther('0.02')));
  await ok('A15 the NEW owner spends 0.02 QOR from the recovered Pocket', relayer, L.router.address,
    routerRelay(PA, vcall('spend', [evm.address, parseEther('0.02'), nw.dl, nw.sig])), 0n, 'new key works');
  const bal1 = await pub.getBalance({ address: PA });
  rec('check: Pocket balance (0.7 QOR - 0.15 thief drain - 0.02 new owner spend; the 0.5 queued spend never left)', null, 'info', `before=${formatEther(bal0)} after=${formatEther(bal1)} QOR`);
}

/* ============================== B. freeze that expires ============================== */
log('\n== B. a freeze that expires, and the 2-freeze cap');
const CE = cfgOf(E, parseEther('0.2'));
const PE = await read(L.factory.address, A.factory, 'predict', cfgArgs(CE));
{
  const f = await evm.send({ to: PE, value: parseEther('0.3'), gas: 40000n });
  rec('B0 fund the counterfactual Pocket 0.3 QOR', f.hash, f.receipt.status, PE);
  const s = await intent(PE, E, ACT.SPEND, params.spend(evm.address, parseEther('0.02')));
  await ok('B1 lazy deploy + owner spends 0.02 QOR (not frozen)', relayer, L.router.address, routerDeployRelay(CE, vcall('spend', [evm.address, parseEther('0.02'), s.dl, s.sig])), 0n, 'paid');
}
{
  const f1 = await freezeArgs(PE, [G[0]]);
  await reverts('B2 ATTACK freeze with only 1 guardian', relayer, L.router.address, routerRelay(PE, vcall('guardianFreeze', f1)), 'NotEnoughSigners');
  const f2 = await freezeArgs(PE, [G[0], T]); // T is not a guardian of PE
  await reverts('B3 ATTACK freeze signed by a non-guardian account', relayer, L.router.address, routerRelay(PE, vcall('guardianFreeze', f2)), 'NotGuardian');
}
await ok('B4 guardian freeze #1 (G2 + G3)', relayer, L.router.address, routerRelay(PE, vcall('guardianFreeze', await freezeArgs(PE, [G[1], G[2]]))), 0n, 'frozen');
{
  const s = await intent(PE, E, ACT.SPEND, params.spend(evm.address, parseEther('0.02')));
  await reverts('B5 owner spend while frozen (the owner key cannot lift a freeze)', relayer, L.router.address, routerRelay(PE, vcall('spend', [evm.address, parseEther('0.02'), s.dl, s.sig])), 'Frozen');
  await reverts('B6 ATTACK a second freeze while one is running (no extension)', relayer, L.router.address, routerRelay(PE, vcall('guardianFreeze', await freezeArgs(PE, [G[1], G[2]]))), 'AlreadyFrozen');
  const i = await info(PE);
  await waitChainTs(i.frozenUntil + 2);
  rec('check: freeze expired by itself', null, 'info', `frozen()=${(await info(PE)).frozen} streak=${(await info(PE)).streak}`);
  const s2 = await intent(PE, E, ACT.SPEND, params.spend(evm.address, parseEther('0.02')));
  await ok('B7 owner spends 0.02 QOR after the freeze expired (nobody lifted it; the period ran out)', relayer, L.router.address,
    routerRelay(PE, vcall('spend', [evm.address, parseEther('0.02'), s2.dl, s2.sig])), 0n, 'paid after expiry');
}
await ok('B8 guardian freeze #2 back-to-back by the same guardians (streak 2, the allowed renewal)', relayer, L.router.address, routerRelay(PE, vcall('guardianFreeze', await freezeArgs(PE, [G[0], G[2]]))), 0n, 'frozen (streak 2)');
{
  await waitChainTs((await info(PE)).frozenUntil + 2);
  await reverts('B9 ATTACK a THIRD freeze in a row by the same guardian set is refused (collusion cap)', relayer, L.router.address,
    routerRelay(PE, vcall('guardianFreeze', await freezeArgs(PE, [G[0], G[1]]))), 'FreezeCapped');
  const s = await intent(PE, E, ACT.SPEND, params.spend(evm.address, parseEther('0.02')));
  await ok('B10 owner window after the cap: spend works again', relayer, L.router.address, routerRelay(PE, vcall('spend', [evm.address, parseEther('0.02'), s.dl, s.sig])), 0n, 'paid');
}

/* ============================== C/D. paths that predate the freeze, on the freeze-capable vault (LAB) ============================== */
log('\n== C/D. queued spend + veto, threshold recovery + owner veto (unchanged paths, new vault)');
const CC = cfgOf(E, parseEther('0.2'));
const PC = await read(L.factory.address, A.factory, 'predict', cfgArgs(CC));
{
  const f = await evm.send({ to: PC, value: parseEther('0.4'), gas: 40000n });
  rec('C0 fund the counterfactual Pocket 0.4 QOR', f.hash, f.receipt.status, PC);
  const s = await intent(PC, E, ACT.SPEND, params.spend(evm.address, parseEther('0.05')));
  await ok('C1 lazy deploy + owner spend 0.05 QOR within the daily limit (paid now)', relayer, L.router.address, routerDeployRelay(CC, vcall('spend', [evm.address, parseEther('0.05'), s.dl, s.sig])), 0n, 'paid');
  const q = await intent(PC, E, ACT.SPEND, params.spend(evm.address, parseEther('0.3')));
  await ok('C2 spend 0.3 QOR (above the remaining allowance): queued with the timelock, not paid', relayer, L.router.address, routerRelay(PC, vcall('spend', [evm.address, parseEther('0.3'), q.dl, q.sig])), 0n, 'queued id 1');
  const v = await intent(PC, E, ACT.VETO_QUEUED, params.id(1));
  await ok('C3 owner vetoes the queued spend', relayer, L.router.address, routerRelay(PC, vcall('vetoQueued', [1n, v.dl, v.sig])), 0n, 'vetoed');
  await reverts('C4 the vetoed spend can not be executed', relayer, L.router.address, routerRelay(PC, vcall('executeQueued', [1n])), 'NotQueued');
  const nk = keyHash(N);
  const dl = BigInt((await chainTs()) + 3600);
  const dg = await read(PC, A.vault, 'recoveryDigest', [N.evm, nk, dl]);
  await ok('D1 threshold recovery proposed by 2 of 3 guardians (G1 + G2), 60 s delay (vetoable by the owner)', relayer, L.router.address,
    routerRelay(PC, vcall('proposeRecovery', [N.evm, nk, dl, [G[0].evm, G[1].evm], [sign(G[0], dg), sign(G[1], dg)]])), 0n, 'pending');
  const vr = await intent(PC, E, ACT.VETO_RECOVERY, params.none());
  await ok('D2 the OWNER key vetoes the threshold recovery (still possible: covers colluding guardians)', relayer, L.router.address, routerRelay(PC, vcall('vetoRecovery', [vr.dl, vr.sig])), 0n, 'recovery vetoed');
  await reverts('D3 finalize a vetoed recovery', relayer, L.router.address, routerRelay(PC, vcall('finalizeRecovery', [])), 'NoRecoveryPending');
}

/* ============================== write-up ============================== */
const endDep = await pub.getBalance({ address: evm.address });
const endRel = await pub.getBalance({ address: relayer.address });
dep.liveFreezeSummary = {
  ranAt: new Date().toISOString(), lab: { router: L.router.address, factory: L.factory.address, vaultImpl: L.vaultImpl.address },
  pockets: { stolenKeyScenario: PA, expiryScenario: PE },
  deployerNetQor: formatEther(startDep - endDep), relayerNetQor: formatEther(startRel - endRel),
};
writeDeployments(dep);
const rows = dep.liveFreezeTxs.filter((t) => t.step).map((t) => `| ${t.step.replace(/\|/g, '/')} | ${t.status} | ${String(t.outcome).replace(/\|/g, '/')} | ${t.hash ? `[${t.hash.slice(0, 12)}...](${t.url})` : 'none (not mined)'} |`).join('\n');
const file = path.join(ROOT, 'LIVE_RESULTS.md');
let cur = fs.readFileSync(file, 'utf8');
const mark = '\n## Guardian freeze and unanimous recovery (stolen-key scenarios, LAB)';
if (cur.includes(mark)) cur = cur.slice(0, cur.indexOf(mark));
cur = cur.replace(/\s+$/, '\n');
fs.writeFileSync(file, `${cur}${mark}

Lab instance of the redeployed vault (freeze ${FRZ} s, unanimous recovery ${UNA} s, timelock 60 s), router \`${L.router.address}\`, factory \`${L.factory.address}\`, vault implementation \`${L.vaultImpl.address}\`. A = stolen key (thief holds the owner key; guardians freeze, then replace the owner unanimously, the thief cannot veto). B = a freeze that expires on its own, plus the cap on repeated freezes. C/D = queued spend + veto and threshold recovery + owner veto on the new vault. Spend, drop create -> claim and the pool flows on the new deployment are in the table above. All txs below were mined on Diana testnet; "reverted" rows were decoded with eth_call first, then mined with an explicit gas limit.

| step | status | outcome / custom error | tx |
|---|---|---|---|
${rows}

Summary: ${JSON.stringify(dep.liveFreezeSummary, null, 2)}
`);
log('\nDONE', dep.liveFreezeSummary);

// Create the 5 Q-Day bait Pockets on Diana (team-run). Spends testnet QOR from the main test wallet.
//   QORE_DIR=/path/to/QORE node script/qday/create-baits.mjs
// Secrets (bait secp + independent ML-DSA secrets, submitter keys) go ONLY to $QORE_DIR/.secrets/qday-bait.json.
// Public facts go to deployments/qday-baits.json (addresses, configs, key hashes, tx hashes). Idempotent: re-runs resume.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { bank, deriveUnifiedAccount, buildRegisterPqcKeyMsg, signProofOfPossession } from '@qorechain/sdk';
import { mldsa } from '@qorechain/pqc';
import { createWalletClient, http, parseEther, encodeFunctionData, keccak256, toHex, formatEther, encodeAbiParameters } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { pub, chain, PROD, ABI, accountOf, keyStatus, nativeTx, rand32, readJson, writeSecret, SECRETS_DIR, QORE_DIR, C4, net, hexb, windowStatus, big } from './common.mjs';
import { ACT, intentDigest, pqMessage, params } from '../fixtures-lib.mjs';

const SEC = path.join(SECRETS_DIR, 'qday-bait.json');
const PUBF = path.join(C4, 'deployments', 'qday-baits.json');
const LEDGER = path.join(QORE_DIR, 'story', 'spend-notes.json');
const s = readJson(SEC, {});
const out = readJson(PUBF, { note: 'Q-Day drill bait Pockets. TEAM-RUN accounts on Diana testnet; QOR has no value. ML-DSA secrets are independent random entropy and are not published.', network: 'qorechain-diana / EVM 9800', instance: 'v4 PROD', baits: [], txs: [] });
const save = () => { writeSecret(SEC, s); fs.writeFileSync(PUBF, JSON.stringify(out, big, 2)); };
const rec = (step, hash, extra = {}) => { out.txs.push({ step, hash, ...extra }); save(); console.log(step, hash ?? '', JSON.stringify(extra, big)); };
const ledger = (e) => { const l = readJson(LEDGER, { entries: [] }); l.entries.push({ at: new Date().toISOString(), ...e }); fs.writeFileSync(LEDGER, JSON.stringify(l, null, 2)); };

const NAMES = ['B1', 'B2', 'B3', 'B4', 'B5'];
const DESC = {
  B1: 'Plain: no guardians, daily limit 0.05 QOR',
  B2: 'Guarded: 2 team guardians, threshold 2, daily limit 0.05 QOR',
  B3: 'Queued: the owner queued a 0.1 QOR spend to a team address (24 h timelock); nobody else can veto, redirect or add one',
  B4: 'Recipient: bound and confirmed recipient of a 0.1 QOR Confirmed drop; only its ML-DSA key can claim it',
  B5: 'Counterfactual: not deployed yet, 0.2 QOR waits at the predicted address; deploying it pins the real registered key',
};
s.baits ??= {};
for (const n of NAMES) s.baits[n] ??= { secp: rand32(), pq: rand32() };
s.guardians ??= { G1: { secp: rand32(), pq: rand32() }, G2: { secp: rand32(), pq: rand32() } };
s.linkSeedB4 ??= rand32();
s.progress ??= {};
save();
const acc = Object.fromEntries(NAMES.map((n) => [n, accountOf(s.baits[n])]));
const G1 = accountOf(s.guardians.G1), G2 = accountOf(s.guardians.G2);
const story = readJson(path.join(SECRETS_DIR, 'qday-story.json'), null);
if (!story) throw new Error('needs the feasibility submitter X and sender Pocket V (qday-story.json)');
const X = accountOf(story.X), V = accountOf(story.V);
const xw = createWalletClient({ account: privateKeyToAccount(X.privateKey), chain, transport: http() });
const gp = async () => (await pub.getGasPrice()) * 13n / 10n;
async function xsend(step, to, data = '0x', value = 0n, gas) {
  if (!gas) gas = (await pub.estimateGas({ account: X.evm, to, data, value })) * 13n / 10n;
  const hash = await xw.sendTransaction({ to, data, value, gas, type: 'legacy', gasPrice: await gp() });
  const r = await pub.waitForTransactionReceipt({ hash, timeout: 90_000 });
  if (r.status !== 'success') throw new Error(step + ' reverted ' + hash);
  rec(step, hash, { status: r.status, gasUsed: r.gasUsed });
  return r;
}
const w = await windowStatus(X.cosmos);
if (!w.live) throw new Error('submitter X has no live window');

// 1) fund: main -> bait key accounts (registration fee) + X (Pocket funding + gas), one hybrid tx
const seed = fs.readFileSync(path.join(QORE_DIR, '.env'), 'utf8').match(/^\s*seed\s*=\s*["']?([^"'\r\n]+?)["']?\s*$/mi)[1].trim().split(/\s+/).join(' ');
const main = await deriveUnifiedAccount(seed, 0);
if (!s.progress.funded) {
  const b0 = await pub.getBalance({ address: main.evm });
  const m = (to, u) => bank.send({ fromAddress: main.cosmos, toAddress: to, amount: [{ denom: 'uqor', amount: String(u) }] });
  const r = await nativeTx(main, 'hybrid', [...NAMES.map((n) => m(acc[n].cosmos, 90_000)), m(X.cosmos, 1_400_000)], { gas: '1200000', fee: '150000', mode: 'broadcast' });
  if (r.code !== 0) throw new Error('fund failed ' + JSON.stringify(r));
  rec('fund 5 bait key accounts 0.09 QOR each + submitter X 1.4 QOR (main, one hybrid tx)', r.hash, { lane: 'cosmos', height: r.height });
  ledger({ from: 'main', what: 'Q-Day baits: 5 x 0.09 registration + 1.4 to submitter X + fee', hash: r.hash, mainDeltaQOR: formatEther(b0 - await pub.getBalance({ address: main.evm })) });
  s.progress.funded = true; save();
}
// 2) register each bait's independent ML-DSA key with proof of possession (classical, bootstrap-exempt). NO window is opened.
for (const n of NAMES) {
  if ((await keyStatus(acc[n].evm)).registered) continue;
  const a = acc[n];
  const pop = signProofOfPossession({ chainId: net.chainId, account: a.cosmos, keypair: a.pqc });
  const msg = buildRegisterPqcKeyMsg(a.cosmos, { pqcKeypair: a.pqc, ecdsaPubkey: hexb(a.publicKey), proofOfPossession: pop });
  const r = await nativeTx(a, 'classical', [msg], { mode: 'broadcast' });
  if (r.code !== 0) throw new Error(n + ' register failed ' + JSON.stringify(r));
  rec(`${n} registers its ML-DSA-87 key with PoP (classical, one-time)`, r.hash, { lane: 'cosmos', height: r.height });
}
// 3) Pockets
const salt = (n) => keccak256(toHex(`pocketdrop-qday-${n}-${s.baits[n].secp.slice(0, 8)}`));
const cfg = {
  B1: { guardians: [], threshold: 0 }, B2: { guardians: [G1.evm, G2.evm], threshold: 2 }, B3: { guardians: [], threshold: 0 },
  B4: { guardians: [], threshold: 0 }, B5: { guardians: [], threshold: 0 },
};
const LIMIT = parseEther('0.05');
const args = (n) => [acc[n].evm, cfg[n].guardians, cfg[n].threshold, LIMIT, salt(n)];
const pocket = {};
for (const n of NAMES) pocket[n] = await pub.readContract({ address: PROD.factory.address, abi: ABI.factory, functionName: 'predict', args: args(n) });
for (const n of NAMES) {
  if (n !== 'B5' && !s.progress[`deploy${n}`]) {
    await xsend(`${n} Pocket deployed through the prod router (submitter X)`, PROD.router.address, encodeFunctionData({ abi: ABI.router, functionName: 'deployAndRelay', args: [...args(n), '0x'] }));
    s.progress[`deploy${n}`] = true; save();
  }
  if (!s.progress[`fund${n}`]) { await xsend(`${n} Pocket funded 0.2 QOR`, pocket[n], '0x', parseEther('0.2'), 60000n); s.progress[`fund${n}`] = true; save(); }
}
const sign = (a, digest) => toHex(mldsa.sign(a.pqc.secretKey, hexb(pqMessage(digest))));
const now = async () => BigInt((await pub.getBlock()).timestamp);
async function ownerIntent(n, owner, vault, action, p) {
  const nonce = await pub.readContract({ address: vault, abi: ABI.vault, functionName: 'nonce' });
  const dl = (await now()) + 3600n;
  return { dl, sig: sign(owner, intentDigest({ action, vault, nonce, deadline: dl, params: p, chainId: 9800n })) };
}
// 4) B3: owner queues 0.1 QOR to X (above the 0.05 limit -> 24 h timelock)
if (!s.progress.queueB3) {
  const amt = parseEther('0.1');
  const it = await ownerIntent('B3', acc.B3, pocket.B3, ACT.SPEND, params.spend(X.evm, amt));
  await xsend('B3 owner queues a 0.1 QOR spend to team address X (ML-DSA intent; 24 h timelock)', PROD.router.address,
    encodeFunctionData({ abi: ABI.router, functionName: 'relay', args: [pocket.B3, encodeFunctionData({ abi: ABI.vault, functionName: 'spend', args: [X.evm, amt, it.dl, it.sig] })] }));
  s.progress.queueB3 = true; save();
}
// 5) B4: a team sender Pocket S (limit 1 QOR) creates a Confirmed drop, link key binds B4 (payTo = B4 Pocket), V confirms B4's key
s.sender ??= { secp: rand32(), pq: rand32() }; save();
const S = accountOf(s.sender);
if (!(await keyStatus(S.evm)).registered) {
  if ((await pub.getBalance({ address: S.evm })) < parseEther('0.07')) await xsend('team sender S key account funded 0.08 QOR (registration fee)', S.evm, '0x', parseEther('0.08'), 30000n);
  const pop = signProofOfPossession({ chainId: net.chainId, account: S.cosmos, keypair: S.pqc });
  const r = await nativeTx(S, 'classical', [buildRegisterPqcKeyMsg(S.cosmos, { pqcKeypair: S.pqc, ecdsaPubkey: hexb(S.publicKey), proofOfPossession: pop })], { mode: 'broadcast' });
  if (r.code !== 0) throw new Error('S register failed ' + JSON.stringify(r));
  rec('team sender S registers its ML-DSA-87 key with PoP', r.hash, { lane: 'cosmos', height: r.height });
}
const sArgs = [S.evm, [], 0, parseEther('1'), keccak256(toHex('pocketdrop-qday-sender-' + s.sender.secp.slice(0, 8)))];
const VP = await pub.readContract({ address: PROD.factory.address, abi: ABI.factory, functionName: 'predict', args: sArgs });
if (!s.progress.deployS) { await xsend('team sender Pocket S deployed (limit 1 QOR)', PROD.router.address, encodeFunctionData({ abi: ABI.router, functionName: 'deployAndRelay', args: [...sArgs, '0x'] })); s.progress.deployS = true; save(); }
if (!s.progress.fundS) { await xsend('team sender Pocket S funded 0.12 QOR', VP, '0x', parseEther('0.12'), 60000n); s.progress.fundS = true; save(); }
const V_ = S;
const lk = mldsa.keygen(hexb(s.linkSeedB4));
const lkHash = keccak256(toHex(lk.publicKey));
if (!s.progress.dropB4) {
  const amt = parseEther('0.1'); const MAXE = await pub.readContract({ address: PROD.drop.address, abi: ABI.drop, functionName: 'MAX_EXPIRY' });
  const exp = (await now()) + BigInt(MAXE) - 600n;
  const it = await ownerIntent('S', V_, VP, ACT.CREATE_DROP, params.createDrop(PROD.drop.address, lkHash, 0, exp, 0n, 0n, amt));
  await xsend('B4 setup: team sender Pocket S creates a 0.1 QOR Confirmed drop (ML-DSA intent)', PROD.router.address,
    encodeFunctionData({ abi: ABI.router, functionName: 'relay', args: [VP, encodeFunctionData({ abi: ABI.vault, functionName: 'createDrop', args: [PROD.drop.address, lkHash, 0, exp, 0n, 0n, amt, it.dl, it.sig] })] }));
  s.linkIdB4 = String(await pub.readContract({ address: PROD.drop.address, abi: ABI.drop, functionName: 'linkCount' }));
  s.progress.dropB4 = true; save();
}
const linkId = BigInt(s.linkIdB4);
const b4KeyHash = keccak256(toHex(acc.B4.pqc.publicKey));
if (!s.progress.bindB4) {
  const d = await pub.readContract({ address: PROD.drop.address, abi: ABI.drop, functionName: 'bindDigest', args: [linkId, acc.B4.evm, b4KeyHash, pocket.B4] });
  const linkSig = toHex(mldsa.sign(lk.secretKey, hexb(pqMessage(d))));
  await xsend(`B4 setup: link key binds B4 as recipient of drop p${linkId} (payTo = B4 Pocket)`, PROD.router.address,
    encodeFunctionData({ abi: ABI.router, functionName: 'relay', args: [PROD.drop.address, encodeFunctionData({ abi: ABI.drop, functionName: 'bind', args: [linkId, acc.B4.evm, b4KeyHash, pocket.B4, toHex(lk.publicKey), linkSig] })] }));
  s.progress.bindB4 = true; save();
}
if (!s.progress.confirmB4) {
  const it = await ownerIntent('S', V_, VP, ACT.CONFIRM_DROP, params.confirm(PROD.drop.address, linkId, b4KeyHash));
  await xsend(`B4 setup: sender Pocket S confirms B4's key for drop p${linkId}`, PROD.router.address,
    encodeFunctionData({ abi: ABI.router, functionName: 'relay', args: [VP, encodeFunctionData({ abi: ABI.vault, functionName: 'confirmDrop', args: [PROD.drop.address, linkId, b4KeyHash, it.dl, it.sig] })] }));
  s.progress.confirmB4 = true; save();
}
// 6) public record
out.baits = [];
for (const n of NAMES) {
  const ks = await keyStatus(acc[n].evm);
  out.baits.push({ id: n, description: DESC[n], keyAccount: acc[n].evm, keyAccountCosmos: acc[n].cosmos, pocket: pocket[n], deployed: n !== 'B5',
    config: { owner: acc[n].evm, guardians: cfg[n].guardians, threshold: cfg[n].threshold, dailyLimitWei: LIMIT.toString(), userSalt: salt(n) },
    ownerKeyHash: ks.keyHash, planned: n === 'B3' ? { queuedSpend: { id: 1, to: X.evm, amountWei: parseEther('0.1').toString() } } : n === 'B4' ? { drop: { linkId: String(linkId), sender: VP, recipientKeyHash: b4KeyHash } } : null });
}
out.teamAccounts = { submitterX: X.evm, senderPocketS: VP, senderKeyAccountS: S.evm, guardianG1: G1.evm, guardianG2: G2.evm };
out.createdAt = new Date().toISOString();
save();
for (const n of NAMES) console.log(n, acc[n].evm, pocket[n], formatEther(await pub.getBalance({ address: pocket[n] })), 'window live:', (await windowStatus(acc[n].cosmos)).live);

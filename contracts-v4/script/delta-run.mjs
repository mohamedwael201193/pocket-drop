// Measured-delta run (QoreChain Diana TESTNET, EVM 9800). TEAM-RUN: every account here is a team test account.
//   QORE_ENV_FILE=<file with seed=<funded testnet mnemonic>> QORE_SECRET_FILE=<scratch json> node script/delta-run.mjs [--n 5]
//   (or from the repo root: node scripts/delta-run.mjs). Read-only re-check of a recorded run: node scripts/delta-verify.mjs
// Same amount, two paths, N fresh keys that start with 0 QOR:
//   Path A (Pocket Drop): the funder's Pocket sends each key an Open link; the key binds it, registers its ML-DSA-87 key
//     with proof of possession (fee paid from the link's drip), claims into its Pocket and makes its first PQ-signed spend.
//     Relayed by the public Pocket Drop API (POST /api/route), exactly as the app does.
//   Path B (control): the same amount sent straight to a fresh 0-QOR address with a plain hybrid MsgSend; the address then
//     tries to spend it with a normal wallet transaction (an EVM transfer, and a classical-signed Cosmos MsgSend).
// Output: frontend/evidence/v4/e2e/delta-run-<date>.json (docs/DELTA_RUN.md is written from it). Keys of the
// fresh accounts go to the QORE_SECRET_FILE (deltaAccounts) and are never printed.
import fs from 'node:fs';
import path from 'node:path';
import { mldsa } from '@qorechain/pqc';
import { evmToQor, bank } from '@qorechain/sdk';
import { keccak256, toHex, parseEther, encodeFunctionData, formatEther, getAddress, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  loadMain, loadDeployer, pub, chain, artifact, readDeployments, readSecrets, writeSecrets, newAccountRecord, registerWithPoP, keyStatus,
  cosmosTx, gasPrice, bankUqor, EXPL, REST, sleep, HERE,
} from './lib.mjs';
import { ACT, params, intentDigest, pqMessage } from './fixtures-lib.mjs';

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const N = Number(arg('n', 5));
const API = process.env.PD_API_URL ?? 'https://pocketdrop-api.vercel.app';
const P = readDeployments().v5.prod;
const A = { vault: artifact('PocketVault').abi, factory: artifact('PocketFactory').abi, drop: artifact('PocketDrop').abi };
const u8 = (h) => Uint8Array.from(Buffer.from(h.slice(2), 'hex'));
const hx = (u) => toHex(u);
const sign = (key, digest) => hx(mldsa.sign(key.secretKey, u8(pqMessage(digest))));
const read = (address, abi, functionName, args = []) => pub.readContract({ address, abi, functionName, args });
const hasCode = async (a) => ((await pub.getCode({ address: a })) ?? '0x') !== '0x';
const chainTs = async () => Number((await pub.getBlock()).timestamp);
const vcall = (fn, args) => encodeFunctionData({ abi: A.vault, functionName: fn, args });
const dcall = (fn, args) => encodeFunctionData({ abi: A.drop, functionName: fn, args });
const now = () => Date.now();

// the app's delivery fee for an Open link (frontend/src/lib/fees.ts, from frontend/src/data/relayCosts.json)
const costs = JSON.parse(fs.readFileSync(path.join(HERE, '..', '..', 'frontend', 'src', 'data', 'relayCosts.json'), 'utf8'));
const costOf = (id) => { const r = costs.rows.find((x) => x.id === id); return r ? r.maxUqor : 0; };
const FEE = parseEther('0.01') * BigInt(Math.ceil(((costOf('bind') + costOf('claim')) * 1.15) / 10_000));
const AMT = parseEther('0.1'); const DRIP = parseEther('0.1'); const SPEND = parseEther('0.05');

async function route(body, label) {
  for (let i = 0; ; i++) {
    const r = await fetch(`${API}/api/route`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ env: 'prod', ...body }) });
    const j = await r.json().catch(() => null);
    if (r.ok && j?.ok) return j;
    if ((r.status === 429 || r.status >= 500) && i < 4) { await sleep(Number(r.headers.get('retry-after') ?? 15) * 1000); continue; }
    throw new Error(`${label}: HTTP ${r.status} ${JSON.stringify(j?.error ?? j)}`);
  }
}

const out = { note: 'TEAM-RUN. Every account is a team test account (fresh keys that start with 0 QOR); counts are accounts, not people. Path A is relayed by the public Pocket Drop API; Path B is the control.', network: 'diana-testnet', instance: 'v5.prod', api: API, startedAt: new Date().toISOString(), n: N, amountQor: formatEther(AMT), dripQor: formatEther(DRIP), deliveryFeeQor: formatEther(FEE), firstSpendQor: formatEther(SPEND), funding: [], pathA: [], pathB: [] };
const date = new Date().toLocaleDateString('sv-SE', { timeZone: process.env.TZ || 'Africa/Cairo' }); // YYYY-MM-DD
const evFile = path.join(HERE, '..', '..', 'frontend', 'evidence', 'v4', 'e2e', `delta-run-${date}.json`);
const save = () => fs.writeFileSync(evFile, JSON.stringify(out, (k, v) => (typeof v === 'bigint' ? v.toString() : v), 2) + '\n');

const main = await loadMain(); // funder: pays the sender Pocket, the Path B transfers, and receives the first spends
const secrets = readSecrets() ?? {};
// sender Pocket owner: needs an ML-DSA-87 key registered WITH proof of possession (the deployer in our run; else the funder)
const owner = secrets.deployer ? await loadDeployer() : main;
{ const k = await keyStatus(owner.evm); if (!(k.registered && k.possessionProven)) throw new Error(`sender owner ${owner.evm} has no possession-proven ML-DSA-87 key; register one first`); }
secrets.deltaAccounts ??= [];

// sender Pocket of the funder (fresh salt, saved), funded with a hybrid MsgSend before it exists
const sCfg = [owner.evm, [], 0, parseEther('5'), keccak256(toHex(crypto.getRandomValues(new Uint8Array(32))))];
const PS = getAddress(await read(P.factory.address, A.factory, 'predict', sCfg));
out.sender = { owner: owner.evm, funder: main.evm, pocket: PS, pocketCfg: sCfg.map(String) };
const fundUqor = (BigInt(N) * (AMT + DRIP + FEE)) / 10n ** 12n + 50_000n;
{
  const r = await cosmosTx(main, 'hybrid', [bank.send({ fromAddress: main.cosmos, toAddress: evmToQor(PS), amount: [{ denom: 'uqor', amount: String(fundUqor) }] })]);
  if (r.code !== 0) throw new Error('fund sender Pocket failed');
  out.funding.push({ step: `funder -> sender Pocket ${PS} (${Number(fundUqor) / 1e6} QOR, hybrid MsgSend)`, hash: r.transactionHash, code: r.code }); save();
}
await sleep(3000);

// ---- Path A ----
for (let i = 0; i < N; i++) {
  const { acc: K, record } = await newAccountRecord(`delta A${i + 1} (starts empty)`);
  secrets.deltaAccounts.push(record); writeSecrets(secrets);
  const uCfg = [K.evm, [], 0, parseEther('1'), keccak256(toHex(crypto.getRandomValues(new Uint8Array(32))))];
  const PU = getAddress(await read(P.factory.address, A.factory, 'predict', uCfg));
  const row = { id: `A${i + 1}`, account: K.evm, pocket: PU, pocketCfg: uCfg.map(String), startBalanceQor: formatEther(await pub.getBalance({ address: K.evm })), keyRegisteredAtStart: (await keyStatus(K.evm)).registered, txs: {} };
  out.pathA.push(row); save();
  try {
    // sender creates the Open link (lazy-deploys its Pocket on the first one)
    const lk = mldsa.keygen(); const lkh = keccak256(hx(lk.publicKey));
    const exp = BigInt((await chainTs()) + 6 * 3600);
    const nonce = (await hasCode(PS)) ? await read(PS, A.vault, 'nonce') : 0n;
    const dl = BigInt((await chainTs()) + 3600);
    const value = AMT + DRIP + FEE;
    const sig = sign(owner.pqc, intentDigest({ action: ACT.CREATE_DROP, vault: PS, nonce, deadline: dl, params: params.createDrop(P.drop.address, lkh, 1, exp, DRIP, FEE, value), chainId: 9800n }));
    const data = vcall('createDrop', [P.drop.address, lkh, 1, exp, DRIP, FEE, value, dl, sig]);
    const c = await route((await hasCode(PS)) ? { target: PS, data } : { pocket: { owner: sCfg[0], guardians: [], threshold: 0, dailyLimit: String(sCfg[3]), userSalt: sCfg[4] }, data }, 'createDrop');
    row.txs.createDrop = c.txHash;
    const linkId = BigInt(c.result?.linkId ?? await read(P.drop.address, A.drop, 'linkCount'));
    row.linkId = String(linkId);
    // the recipient opens the link: t0
    const t0 = now();
    const kh = keccak256(hx(K.pqc.publicKey));
    const bd = await read(P.drop.address, A.drop, 'bindDigest', [linkId, K.evm, kh, PU]);
    row.txs.bind = (await route({ target: P.drop.address, data: dcall('bind', [linkId, K.evm, kh, PU, hx(lk.publicKey), sign(lk, bd)]) }, 'bind')).txHash;
    let reg; for (let t = 0; t < 4; t++) { try { reg = await registerWithPoP(K); break; } catch (e) { if (t === 3) throw e; await sleep(3000); } }
    row.txs.registerKey = reg.hash;
    const ks = await keyStatus(K.evm); row.possessionProven = ks.possessionProven;
    await sleep(2500);
    const cd = await read(P.drop.address, A.drop, 'claimDigest', [linkId, K.evm, PU]);
    row.txs.claim = (await route({ target: P.drop.address, data: dcall('claim', [linkId, sign(K.pqc, cd)]) }, 'claim')).txHash;
    row.pocketAfterClaimQor = formatEther(await pub.getBalance({ address: PU }));
    const sdl = BigInt((await chainTs()) + 3600);
    const ssig = sign(K.pqc, intentDigest({ action: ACT.SPEND, vault: PU, nonce: 0n, deadline: sdl, params: params.spend(main.evm, SPEND), chainId: 9800n }));
    row.txs.firstSpend = (await route({ pocket: { owner: K.evm, guardians: [], threshold: 0, dailyLimit: String(uCfg[3]), userSalt: uCfg[4] }, data: vcall('spend', [main.evm, SPEND, sdl, ssig]) }, 'spend')).txHash;
    row.secondsToFirstSpend = Math.round((now() - t0) / 1000);
    row.pocketAfterSpendQor = formatEther(await pub.getBalance({ address: PU }));
    row.spent = true; row.outcome = `claimed ${formatEther(AMT)} QOR into its Pocket and spent ${formatEther(SPEND)} QOR with an ML-DSA-87 intent`;
  } catch (e) { row.spent = false; row.outcome = 'FAILED: ' + String(e.message ?? e).slice(0, 300); }
  save(); console.log(row.id, row.spent ? 'spent' : row.outcome, row.secondsToFirstSpend ?? '');
  await sleep(4000);
}

// ---- Path B ----
const gp = await gasPrice();
for (let i = 0; i < N; i++) {
  const { acc: B, record } = await newAccountRecord(`delta B${i + 1} (control, starts empty)`);
  secrets.deltaAccounts.push(record); writeSecrets(secrets);
  const row = { id: `B${i + 1}`, account: B.evm, cosmos: B.cosmos, startBalanceQor: formatEther(await pub.getBalance({ address: B.evm })), txs: {}, attempts: [] };
  out.pathB.push(row);
  const r = await cosmosTx(main, 'hybrid', [bank.send({ fromAddress: main.cosmos, toAddress: B.cosmos, amount: [{ denom: 'uqor', amount: String(AMT / 10n ** 12n) }] })]);
  row.txs.directSend = r.transactionHash;
  await sleep(2500);
  row.balanceAfterSendQor = formatEther(await pub.getBalance({ address: B.evm }));
  // attempt 1: an ordinary EVM transfer signed with the account's key
  try {
    const w = createWalletClient({ account: privateKeyToAccount(B.privateKey), chain, transport: http() });
    const h = await w.sendTransaction({ to: main.evm, value: SPEND, gas: 21000n, type: 'legacy', gasPrice: gp });
    const rc = await pub.waitForTransactionReceipt({ hash: h, timeout: 60_000 }).catch(() => null);
    row.attempts.push({ kind: 'EVM transfer', accepted: true, hash: h, status: rc?.status ?? 'not mined' });
  } catch (e) { row.attempts.push({ kind: 'EVM transfer', accepted: false, error: String(e.shortMessage ?? e.details ?? e.message).split('\n')[0].slice(0, 240) }); }
  // attempt 2: a classical-signed Cosmos MsgSend
  try {
    const t = await cosmosTx(B, 'classical', [bank.send({ fromAddress: B.cosmos, toAddress: main.cosmos, amount: [{ denom: 'uqor', amount: String(SPEND / 10n ** 12n) }] })], { gas: '200000', fee: '30000' });
    row.attempts.push({ kind: 'Cosmos MsgSend (classical)', accepted: t.code === 0, hash: t.transactionHash, code: t.code });
  } catch (e) { row.attempts.push({ kind: 'Cosmos MsgSend (classical)', accepted: false, error: String(e.message ?? e).split('\n')[0].slice(0, 240) }); }
  await sleep(2500);
  row.balanceAfterAttemptsQor = formatEther(await pub.getBalance({ address: B.evm }));
  row.spent = row.attempts.some((a) => a.accepted && (a.status === 'success' || a.code === 0));
  row.keyRegistered = (await keyStatus(B.evm)).registered;
  save(); console.log(row.id, row.spent ? 'SPENT' : 'refused', row.attempts.map((a) => a.error ?? a.status ?? a.code).join(' | '));
}
out.finishedAt = new Date().toISOString();
out.summary = { pathA: `${out.pathA.filter((r) => r.spent).length} of ${N} fresh accounts made a first PQ-signed spend`, pathB: `${out.pathB.filter((r) => r.spent).length} of ${N} could spend the direct transfer`, medianSecondsToFirstSpend: (() => { const s = out.pathA.filter((r) => r.spent).map((r) => r.secondsToFirstSpend).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; })() };
save();
console.log(JSON.stringify(out.summary));

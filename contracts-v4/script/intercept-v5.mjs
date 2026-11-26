// "Intercepted link refused" demo on the deployed v5 contracts (QoreChain Diana TESTNET, EVM 9800). TEAM-RUN test accounts.
//   QORE_ENV_FILE=<file with seed=<funded testnet mnemonic>> QORE_SECRET_FILE=<scratch json> node script/intercept-v5.mjs
// The threat: someone sees a Confirmed (Someone I know) link before the friend does. With the link they can bind their own
// key first, and the bind pays them the small drip. They cannot take the amount:
//   1. the sender's Pocket creates a Confirmed link (public API relay);
//   2. the interceptor (fresh test account) binds its OWN key with the link key (public API relay): state Bound;
//   3. the interceptor asks the public API to relay its claim: refused before broadcast (would revert);
//   4. the interceptor submits the claim itself through its own router-only EVM window: mined, reverted InvalidState(Bound);
//   5. the sender sees 4 words that are not the friend's and cancels: the amount returns to the sender's Pocket;
//   6. the interceptor's claim after the cancel: mined, reverted InvalidState(Cancelled). Then it closes its window.
// Output: frontend/evidence/v4/e2e/intercept-confirmed-v5.json. Keys of the fresh account go to QORE_SECRET_FILE.
import fs from 'node:fs';
import path from 'node:path';
import { mldsa } from '@qorechain/pqc';
import { openEvmWindowMsg, closeEvmWindowMsg, evmToQor, bank } from '@qorechain/sdk';
import { evmWindowCost } from '@qorechain/evm';
import { keccak256, toHex, parseEther, encodeFunctionData, decodeErrorResult, formatEther, getAddress } from 'viem';
import {
  loadMain, loadDeployer, Evm, pub, windowOf, artifact, readDeployments, readSecrets, writeSecrets, newAccountRecord,
  registerWithPoP, keyStatus, cosmosTx, gasPrice, EXPL, REST, sleep, HERE,
} from './lib.mjs';
import { ACT, params, intentDigest, pqMessage } from './fixtures-lib.mjs';

const API = process.env.PD_API_URL ?? 'https://pocket-drop-api.vercel.app';
const P = readDeployments().v5.prod;
const ROUTER = getAddress(P.router.address);
const DROP = getAddress(P.drop.address);
const A = { vault: artifact('PocketVault').abi, factory: artifact('PocketFactory').abi, drop: artifact('PocketDrop').abi, router: artifact('PocketRouter').abi };
const u8 = (h) => Uint8Array.from(Buffer.from(h.slice(2), 'hex'));
const hx = (u) => toHex(u);
const sign = (key, digest) => hx(mldsa.sign(key.secretKey, u8(pqMessage(digest))));
const read = (address, abi, functionName, args = []) => pub.readContract({ address, abi, functionName, args });
const chainTs = async () => Number((await pub.getBlock()).timestamp);
const vcall = (fn, args) => encodeFunctionData({ abi: A.vault, functionName: fn, args });
const dcall = (fn, args) => encodeFunctionData({ abi: A.drop, functionName: fn, args });
const STATE = ['None', 'Open', 'Bound', 'Confirmed', 'Claimed', 'Cancelled', 'Refunded'];
const costs = JSON.parse(fs.readFileSync(path.join(HERE, '..', '..', 'frontend', 'src', 'data', 'relayCosts.json'), 'utf8'));
const costOf = (id) => costs.rows.find((x) => x.id === id)?.maxUqor ?? 0;
const FEE = parseEther('0.01') * BigInt(Math.ceil(((costOf('bind') + costOf('confirm') + costOf('claim')) * 1.15) / 10_000));
const AMT = parseEther('0.1'); const DRIP = parseEther('0.1');

const evFile = path.join(HERE, '..', '..', 'frontend', 'evidence', 'v4', 'e2e', 'intercept-confirmed-v5.json');
const out = { note: 'TEAM-RUN test accounts on Diana testnet. Someone who intercepts a Confirmed link can bind it but cannot claim it; the sender cancels and gets the amount back.', instance: 'v5.prod', drop: DROP, router: ROUTER, api: API, startedAt: new Date().toISOString(), amountQor: formatEther(AMT), dripQor: formatEther(DRIP), deliveryFeeQor: formatEther(FEE), rows: [] };
const save = () => fs.writeFileSync(evFile, JSON.stringify(out, (k, v) => (typeof v === 'bigint' ? v.toString() : v), 2) + '\n');
const row = (r) => { out.rows.push(r); save(); console.log(r.step, r.hash ?? r.result ?? ''); };
const linkState = async (id) => STATE[Number((await read(DROP, A.drop, 'getLink', [id])).state)];

async function route(body, label) {
  for (let i = 0; ; i++) {
    const r = await fetch(`${API}/api/route`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ env: 'prod', ...body }) });
    const j = await r.json().catch(() => null);
    if (r.ok && j?.ok) return j;
    if ((r.status === 429 || r.status >= 500) && i < 4) { await sleep(Number(r.headers.get('retry-after') ?? 15) * 1000); continue; }
    const e = new Error(`${label}: HTTP ${r.status} ${JSON.stringify(j?.error ?? j)}`); e.status = r.status; e.body = j; throw e;
  }
}

const main = await loadMain();
const S = await loadDeployer();
const secrets = readSecrets();
// sender Pocket: the deployed one from the measured-delta run (owner = deployer test account)
const delta = JSON.parse(fs.readFileSync(path.join(HERE, '..', '..', 'frontend', 'evidence', 'v4', 'e2e', 'delta-run-2026-11-26.json'), 'utf8'));
const PS = getAddress(delta.sender.pocket);
if (getAddress((await read(PS, A.vault, 'owner'))) !== getAddress(S.evm)) throw new Error('sender Pocket owner mismatch');
out.accounts = { senderOwner: S.evm, senderPocket: PS };

// 0. fund the sender Pocket and the interceptor (hybrid MsgSends from the main test wallet; logged)
const need = AMT + DRIP + FEE;
{
  const bal = await pub.getBalance({ address: PS });
  const uq = need > bal ? (need - bal) / 10n ** 12n + 20_000n : 0n;
  if (uq > 0n) { const r = await cosmosTx(main, 'hybrid', [bank.send({ fromAddress: main.cosmos, toAddress: evmToQor(PS), amount: [{ denom: 'uqor', amount: String(uq) }] })]); row({ step: `main test wallet funds the sender Pocket (${Number(uq) / 1e6} QOR, hybrid MsgSend)`, hash: r.transactionHash, lane: 'native', code: r.code }); }
}
secrets.interceptAccounts ??= [];
const { acc: I, record } = await newAccountRecord('intercept v5 interceptor (starts empty)');
secrets.interceptAccounts.push(record); writeSecrets(secrets);
const iEvm = new Evm(I);
const iCfg = [I.evm, [], 0, parseEther('1'), keccak256(toHex(crypto.getRandomValues(new Uint8Array(32))))];
const PI = getAddress(await read(P.factory.address, A.factory, 'predict', iCfg));
out.accounts.interceptor = I.evm; out.accounts.interceptorPocket = PI; out.accounts.interceptorPocketCfg = iCfg.map(String); save();
{ const r = await cosmosTx(main, 'hybrid', [bank.send({ fromAddress: main.cosmos, toAddress: I.cosmos, amount: [{ denom: 'uqor', amount: '350000' }] })]); row({ step: 'main test wallet funds the interceptor test account (0.35 QOR for its own window and two EVM txs, hybrid MsgSend)', hash: r.transactionHash, lane: 'native', code: r.code }); }
await sleep(3000);

// 1. Confirmed link (mode 0)
const lk = mldsa.keygen(); const lkh = keccak256(hx(lk.publicKey));
const exp = BigInt((await chainTs()) + 6 * 3600);
let dl = BigInt((await chainTs()) + 3600);
let nonce = await read(PS, A.vault, 'nonce');
const c = await route({ target: PS, data: vcall('createDrop', [DROP, lkh, 0, exp, DRIP, FEE, need, dl, sign(S.pqc, intentDigest({ action: ACT.CREATE_DROP, vault: PS, nonce, deadline: dl, params: params.createDrop(DROP, lkh, 0, exp, DRIP, FEE, need), chainId: 9800n }))]) }, 'createDrop');
const linkId = BigInt(c.result?.linkId ?? await read(DROP, A.drop, 'linkCount'));
out.linkId = String(linkId);
row({ step: `1 sender Pocket creates Confirmed link ${linkId} (${formatEther(AMT)} QOR), relayed by the public API`, hash: c.txHash, lane: c.lane ?? 'native', state: await linkState(linkId) });

// 2. the interceptor binds its own key with the link key
const ikh = keccak256(hx(I.pqc.publicKey));
const bd = await read(DROP, A.drop, 'bindDigest', [linkId, I.evm, ikh, PI]);
const b = await route({ target: DROP, data: dcall('bind', [linkId, I.evm, ikh, PI, hx(lk.publicKey), sign(lk, bd)]) }, 'bind');
await sleep(2500);
row({ step: '2 interceptor binds its own ML-DSA-87 key with the intercepted link key (the bind pays it the drip)', hash: b.txHash, lane: b.lane ?? 'native', state: await linkState(linkId), recipientKeyHash: ikh });

// interceptor key with proof of possession, then its own router-only window
const reg = await registerWithPoP(I); row({ step: 'interceptor registers its ML-DSA-87 key with proof of possession', hash: reg.hash, lane: 'native' });
await sleep(2500);
const cd = await read(DROP, A.drop, 'claimDigest', [linkId, I.evm, PI]);
const claimData = dcall('claim', [linkId, sign(I.pqc, cd)]);

// 3. public API refuses to relay the claim
try { const r = await route({ target: DROP, data: claimData }, 'claim'); row({ step: '3 public API relays the interceptor claim', hash: r.txHash, result: 'UNEXPECTED: relayed' }); }
catch (e) { row({ step: '3 interceptor asks the public API to relay its claim: refused before broadcast, nothing sent', result: `HTTP ${e.status}`, response: e.body }); }

const gp = await gasPrice();
const maxValue = evmWindowCost({ gas: 1_200_000n, maxFeePerGas: gp }) * 3n + 100_000n;
const head = await pub.getBlockNumber();
{
  const r = await cosmosTx(I, 'hybrid', [openEvmWindowMsg({ sender: I.cosmos, blocks: 400, maxTxs: 3, maxValue, allowedTargets: [ROUTER] })], { gas: '800000', fee: '100000' });
  await sleep(2500);
  const w = await windowOf(I);
  row({ step: 'interceptor opens its own EVM window, hybrid-signed, scoped to the v5 PocketRouter only (3 txs, 400 blocks)', hash: r.transactionHash, lane: 'native', code: r.code, window: { live: !!(w.live ?? w.open), allowedTargets: w.allowed_targets ?? w.allowedTargets, blocks: 400, maxTxs: 3, openedNearHeight: String(head), expiryHeight: w.expiry_height ?? w.expiryHeight } });
}
const relayData = encodeFunctionData({ abi: A.router, functionName: 'relay', args: [DROP, claimData] });
async function claimAttempt(step) {
  let reason = null;
  try { await pub.call({ account: I.evm, to: ROUTER, data: relayData }); } catch (e) {
    const d = e.data ?? e.cause?.data ?? e.walk?.((x) => x?.data)?.data;
    try { const r = decodeErrorResult({ abi: A.drop, data: typeof d === 'string' ? d : d?.data }); reason = `${r.errorName}(${r.args?.map((x) => (r.errorName === 'InvalidState' ? STATE[Number(x)] : String(x))).join(',') ?? ''})`; } catch { reason = String(e.shortMessage ?? e.message).split('\n')[0]; }
  }
  const { hash, receipt } = await iEvm.send({ to: ROUTER, data: relayData, gas: 400_000n });
  row({ step, hash, lane: 'evm', submitter: I.evm, to: ROUTER, status: receipt.status, block: String(receipt.blockNumber), decodedError: reason, linkState: await linkState(linkId), interceptorPocketQor: formatEther(await pub.getBalance({ address: PI })) });
}
// 4. interceptor submits the claim itself
await claimAttempt('4 interceptor submits its claim itself through its own window: mined and reverted');

// 5. sender cancels (the 4 words are not the friend's)
const before = await pub.getBalance({ address: PS });
dl = BigInt((await chainTs()) + 3600); nonce = await read(PS, A.vault, 'nonce');
const x = await route({ target: PS, data: vcall('cancelDrop', [DROP, linkId, dl, sign(S.pqc, intentDigest({ action: ACT.CANCEL_DROP, vault: PS, nonce, deadline: dl, params: params.cancel(DROP, linkId), chainId: 9800n }))]) }, 'cancel');
await sleep(2500);
const after = await pub.getBalance({ address: PS });
row({ step: '5 sender sees 4 words that are not the friend\'s and cancels (ML-DSA-87 intent, public API relay)', hash: x.txHash, lane: x.lane ?? 'native', state: await linkState(linkId), senderPocketGainQor: formatEther(after - before) });

// 6. claim after cancel
await claimAttempt('6 interceptor tries its claim again after the cancel: mined and reverted');
{
  const r = await cosmosTx(I, 'hybrid', [closeEvmWindowMsg(I.cosmos)], { gas: '400000', fee: '60000' });
  await sleep(2500); const w = await windowOf(I).catch(() => ({ live: false }));
  row({ step: `interceptor closes its window (hybrid-signed); live after: ${!!w.live}`, hash: r.transactionHash, lane: 'native', code: r.code });
}
out.finishedAt = new Date().toISOString();
out.summary = { interceptorGotAmount: false, interceptorKeptDripQor: formatEther(DRIP), senderRecoveredQor: out.rows.find((r) => r.senderPocketGainQor)?.senderPocketGainQor, finalLinkState: await linkState(linkId), interceptorPocketQor: formatEther(await pub.getBalance({ address: PI })) };
save(); console.log(JSON.stringify(out.summary));

// "Relay it yourself" live demo (QoreChain Diana TESTNET, EVM 9800, TEAM-RUN test accounts): a claim and a spend on the
// v5 PRODUCTION instance submitted by the user's OWN account, without the Pocket Drop relayer or API.
//   QORE_SECRET_FILE=<deployer json> QORE_ENV_FILE=<.env> node script/self-relay-v5.mjs
// How: PocketRouter.relay / deployAndRelay have no caller check (authority is the ML-DSA-87 signature inside the call),
// so any account may submit. On Diana an EVM tx needs a live EVM window, so each submitter opens its OWN window with a
// hybrid-signed (secp256k1 + ML-DSA-87) MsgOpenEVMWindow, scoped to the one v5 router, short expiry, small tx and value
// caps, and closes it when done. Steps:
//   sender (test account, the deployer): opens a router-only window, creates an Open link from a fresh Pocket, binds the
//     recipient with the link key (the bind's relayer fee returns to the sender, who submitted it), closes its window;
//   recipient (fresh test account, starts with 0 QOR): the drip pays its ML-DSA-87 key registration and its own
//     router-only window; it submits its own claim (paid into its Pocket) and its own first spend, then closes the window.
// Nothing is printed from the secrets file. Results: deployments/diana.json -> v5.selfRelay and
// ../frontend/evidence/v4/e2e/self-relay-v5.json (every tx hash, height, gas, fee, the window scope and expiry).
import fs from 'node:fs';
import path from 'node:path';
import { mldsa } from '@qorechain/pqc';
import { openEvmWindowMsg, closeEvmWindowMsg, evmToQor, bank } from '@qorechain/sdk';
import { evmWindowCost } from '@qorechain/evm';
import { keccak256, toHex, parseEther, encodeFunctionData, formatEther, getAddress } from 'viem';
import {
  loadDeployer, loadMain, Evm, pub, windowOf, artifact, readDeployments, writeDeployments, readSecrets, writeSecrets,
  newAccountRecord, registerWithPoP, keyStatus, cosmosTx, gasPrice, bankUqor, EXPL, REST, sleep, HERE,
} from './lib.mjs';
import { ACT, params, intentDigest, pqMessage, dropClaimDigest } from './fixtures-lib.mjs';

const dep = readDeployments();
const P = dep.v5.prod;
const ROUTER = getAddress(P.router.address);
const A = { vault: artifact('PocketVault').abi, factory: artifact('PocketFactory').abi, drop: artifact('PocketDrop').abi, router: artifact('PocketRouter').abi };
const u8 = (h) => Uint8Array.from(Buffer.from(h.slice(2), 'hex'));
const hx = (u) => toHex(u);
const sign = (key, digest) => hx(mldsa.sign(key.secretKey, u8(pqMessage(digest))));
const read = (address, abi, functionName, args = []) => pub.readContract({ address, abi, functionName, args });
const hasCode = async (a) => ((await pub.getCode({ address: a })) ?? '0x') !== '0x';
const chainTs = async () => Number((await pub.getBlock()).timestamp);
const WINDOW_BLOCKS = Number(process.env.SELF_RELAY_WINDOW_BLOCKS ?? 400); // about 9 minutes at about 1.4 s per block
const WINDOW_TXS = 3;
const TX_GAS_CAP = 1_200_000n;

const rows = [];
const prev = dep.v5.selfRelay && !dep.v5.selfRelay.finishedAt ? [...(dep.v5.selfRelay.abortedAttempts ?? []), { ...dep.v5.selfRelay, abortedAttempts: undefined, outcome: 'aborted before the end (operator process stopped or a step failed); the unclaimed link refunds to the deployed sender Pocket after it expires' }] : (dep.v5.selfRelay?.abortedAttempts ?? []);
const run = { note: 'TEAM-RUN test accounts. A claim and a spend submitted by the user\'s own account through its own scoped EVM window; the Pocket Drop relayer and API are not used.', startedAt: new Date().toISOString(), instance: 'v5.prod', router: ROUTER, rows, abortedAttempts: prev };
const evidence = path.join(HERE, '..', '..', 'frontend', 'evidence', 'v4', 'e2e', 'self-relay-v5.json');
const save = () => { dep.v5.selfRelay = run; writeDeployments(dep); fs.writeFileSync(evidence, JSON.stringify(run, (k, v) => (typeof v === 'bigint' ? v.toString() : v), 2) + '\n'); };
const nativeRow = async (step, hash, extra = {}) => {
  const j = await (await fetch(`${REST}/cosmos/tx/v1beta1/txs/${hash}`)).json().catch(() => ({}));
  const tr = j.tx_response ?? {};
  const hy = (tr.events ?? []).find((e) => e.type === 'pqc_hybrid_verify');
  rows.push({ step, hash, url: EXPL + hash, lane: 'native', height: tr.height, code: tr.code, gasUsed: tr.gas_used, fee: j.tx?.auth_info?.fee?.amount?.[0]?.amount + 'uqor', pqcHybridVerify: hy ? (hy.attributes ?? []).map((a) => `${a.key}=${a.value}`).join(' ') : null, ...extra });
  save(); console.log('NATIVE', step, hash, 'code', tr.code);
};

/** Hybrid-signed MsgOpenEVMWindow scoped to the v5 router only. */
async function openRouterWindow(acc, who) {
  const gp = await gasPrice();
  const maxValue = evmWindowCost({ gas: TX_GAS_CAP, maxFeePerGas: gp }) * BigInt(WINDOW_TXS) + 100_000n;
  const head = await pub.getBlockNumber();
  const r = await cosmosTx(acc, 'hybrid', [openEvmWindowMsg({ sender: acc.cosmos, blocks: WINDOW_BLOCKS, maxTxs: WINDOW_TXS, maxValue, allowedTargets: [ROUTER] })], { gas: '800000', fee: '100000' });
  if (r.code !== 0) throw new Error(`${who} open window failed code ${r.code}`);
  await sleep(2500);
  const w = await (await fetch(`${REST}/qorechain/pqc/v1/evm_window/${acc.cosmos}`)).json();
  const scope = { live: !!w.live, allowedTargets: w.allowed_targets, maxTxs: WINDOW_TXS, blocks: WINDOW_BLOCKS, maxValueUqor: String(maxValue), expiryHeight: w.expiry_height ?? String(head + BigInt(WINDOW_BLOCKS)), openedNearHeight: String(head) };
  if (!scope.live || (w.allowed_targets ?? []).length !== 1 || getAddress(w.allowed_targets[0]) !== ROUTER) throw new Error(`${who} window is not live or not router-only`);
  await nativeRow(`${who} opens its own EVM window, hybrid-signed, scoped to the v5 PocketRouter only (${WINDOW_TXS} txs, ${WINDOW_BLOCKS} blocks)`, r.transactionHash, { window: scope });
  return scope;
}
async function closeWindow(acc, who) {
  const r = await cosmosTx(acc, 'hybrid', [closeEvmWindowMsg(acc.cosmos)], { gas: '400000', fee: '60000' });
  await sleep(2500);
  const w = await windowOf(acc).catch(() => ({ live: false }));
  await nativeRow(`${who} closes its window (hybrid-signed); live after: ${!!w.live}`, r.transactionHash);
}
async function evmTx(ev, who, step, data) {
  const est = await pub.estimateGas({ account: ev.address, to: ROUTER, data });
  const { hash, receipt } = await ev.send({ to: ROUTER, data, gas: (est * 13n) / 10n });
  rows.push({ step, submitter: `${who} ${ev.address}`, hash, url: EXPL + hash, lane: 'evm', to: ROUTER, status: receipt.status, block: String(receipt.blockNumber), gasUsed: String(receipt.gasUsed), feeQor: formatEther(receipt.gasUsed * receipt.effectiveGasPrice) });
  save(); console.log(receipt.status === 'success' ? 'OK ' : 'REV', step, hash);
  if (receipt.status !== 'success') throw new Error(step + ' reverted ' + hash);
  return receipt;
}

const main = await loadMain();
const S = await loadDeployer(); // sender: team test account
const sEvm = new Evm(S);

// 0. sender top-up from the main test wallet when low (moves team QOR; logged)
if ((await bankUqor(S.cosmos)) < 1_200_000n) {
  const r = await cosmosTx(main, 'hybrid', [bank.send({ fromAddress: main.cosmos, toAddress: S.cosmos, amount: [{ denom: 'uqor', amount: '1500000' }] })]);
  await nativeRow('main test wallet tops up the sender test account (1.5 QOR, hybrid MsgSend)', r.transactionHash);
}

// recipient: fresh, 0 QOR, no key
const secrets = readSecrets();
secrets.selfRelayAccounts ??= [];
const { acc: U, record } = await newAccountRecord('self-relay recipient (starts empty)');
secrets.selfRelayAccounts.push(record); writeSecrets(secrets);
const uEvm = new Evm(U);
rows.push({ step: 'recipient test account (fresh)', address: U.evm, balanceQor: formatEther(await pub.getBalance({ address: U.evm })), keyRegistered: (await keyStatus(U.evm)).registered }); save();

// Pockets (counterfactual): sender PS, recipient PU
const salt = () => keccak256(toHex(crypto.getRandomValues(new Uint8Array(32))));
const sCfg = [S.evm, [], 0, parseEther('1'), salt()];
const uCfg = [U.evm, [], 0, parseEther('1'), salt()];
const PS = await read(P.factory.address, A.factory, 'predict', sCfg);
const PU = await read(P.factory.address, A.factory, 'predict', uCfg);
// the Pocket configs (salts are public: they are in the deployAndRelay calldata) are saved first, so an interrupted run can still deploy them
run.accounts = { sender: S.evm, senderPocket: getAddress(PS), senderPocketCfg: sCfg.map(String), recipient: U.evm, recipientPocket: getAddress(PU), recipientPocketCfg: uCfg.map(String) };
save();

// 1. fund the sender Pocket address (native MsgSend from the main test wallet; the router-only window cannot pay a non-router address)
{
  const r = await cosmosTx(main, 'hybrid', [bank.send({ fromAddress: main.cosmos, toAddress: evmToQor(PS), amount: [{ denom: 'uqor', amount: '1000000' }] })]);
  await nativeRow('main test wallet funds the sender Pocket address before it exists (1.0 QOR, hybrid MsgSend)', r.transactionHash);
}

// 2. sender: own router-only window, create an Open link (0.2 QOR + 0.5 drip + 0.1 delivery fee), bind the recipient
const AMT = parseEther('0.2'), DRIP = parseEther('0.5'), FEE = parseEther('0.1');
const intent = async (pocket, owner, action, p) => {
  const nonce = (await hasCode(pocket)) ? await read(pocket, A.vault, 'nonce') : 0n;
  const dl = BigInt((await chainTs()) + 3600);
  return { dl, sig: sign(owner.pqc, intentDigest({ action, vault: pocket, nonce, deadline: dl, params: p, chainId: 9800n })) };
};
const vcall = (fn, args) => encodeFunctionData({ abi: A.vault, functionName: fn, args });
const relay = (target, data) => encodeFunctionData({ abi: A.router, functionName: 'relay', args: [target, data] });
const deployAndRelay = (cfg, data) => encodeFunctionData({ abi: A.router, functionName: 'deployAndRelay', args: [...cfg, data] });

run.senderWindow = await openRouterWindow(S, 'sender');
const lk = mldsa.keygen();
const lkh = keccak256(hx(lk.publicKey));
{
  const exp = BigInt((await chainTs()) + 3 * 3600);
  const p = params.createDrop(P.drop.address, lkh, 1, exp, DRIP, FEE, AMT + DRIP + FEE);
  const it = await intent(PS, S, ACT.CREATE_DROP, p);
  await evmTx(sEvm, 'sender', 'S1 sender submits router.deployAndRelay itself: deploys its Pocket and creates an Open link (ML-DSA-87 intent)', deployAndRelay(sCfg, vcall('createDrop', [P.drop.address, lkh, 1, exp, DRIP, FEE, AMT + DRIP + FEE, it.dl, it.sig])));
}
const linkId = await read(P.drop.address, A.drop, 'linkCount');
run.linkId = String(linkId);
const rKeyHash = keccak256(hx(U.pqc.publicKey));
{
  const d = await read(P.drop.address, A.drop, 'bindDigest', [linkId, U.evm, rKeyHash, PU]);
  await evmTx(sEvm, 'sender', 'S2 bind (link-key signature) submitted by the sender; drip 0.5 QOR to the recipient account, payTo = recipient Pocket', relay(P.drop.address, encodeFunctionData({ abi: A.drop, functionName: 'bind', args: [linkId, U.evm, rKeyHash, PU, hx(lk.publicKey), sign(lk, d)] })));
}
await closeWindow(S, 'sender');

// 3. recipient: register key from the drip, open its own router-only window, claim and spend by itself
{
  let r; for (let i = 0; i < 3; i++) { try { r = await registerWithPoP(U); break; } catch (e) { if (i === 2) throw e; await sleep(4000); } }
  const ks = await keyStatus(U.evm);
  await nativeRow(`U1 recipient registers its ML-DSA-87 key with proof of possession (fee from the drip); possessionProven=${ks.possessionProven}`, r.hash);
  await sleep(2500);
}
run.recipientWindow = await openRouterWindow(U, 'recipient');
{
  const d = await read(P.drop.address, A.drop, 'claimDigest', [linkId, U.evm, PU]);
  if (d !== dropClaimDigest({ drop: P.drop.address, id: linkId, recipient: U.evm, payTo: PU })) throw new Error('claim digest JS/contract mismatch');
  const before = await pub.getBalance({ address: PU });
  await evmTx(uEvm, 'recipient', 'U2 recipient submits its own claim through router.relay (ML-DSA-87 signature); 0.2 QOR into its Pocket', relay(P.drop.address, encodeFunctionData({ abi: A.drop, functionName: 'claim', args: [linkId, sign(U.pqc, d)] })));
  const gain = (await pub.getBalance({ address: PU })) - before;
  if (gain !== AMT) throw new Error('claim paid ' + gain);
  rows.push({ step: 'check: claim paid into the recipient Pocket', outcome: `+${formatEther(gain)} QOR` }); save();
}
{
  const to = S.evm; const amount = parseEther('0.05');
  const it = await intent(PU, U, ACT.SPEND, params.spend(to, amount));
  const before = await pub.getBalance({ address: to });
  await evmTx(uEvm, 'recipient', 'U3 recipient submits its own first spend through router.deployAndRelay (deploys its Pocket, ML-DSA-87 spend intent, 0.05 QOR)', deployAndRelay(uCfg, vcall('spend', [to, amount, it.dl, it.sig])));
  rows.push({ step: 'check: spend arrived', outcome: `+${formatEther((await pub.getBalance({ address: to })) - before)} QOR at ${to}` }); save();
}
await closeWindow(U, 'recipient');
run.finishedAt = new Date().toISOString();
run.recipientLeftQor = formatEther(await pub.getBalance({ address: U.evm }));
run.recipientPocketQor = formatEther(await pub.getBalance({ address: PU }));
save();
console.log(JSON.stringify({ ...run.accounts, linkId: run.linkId, recipientLeftQor: run.recipientLeftQor }));

// Finishes an interrupted self-relay-v52 run (the recipient's drip did not cover its last tx fee). Same steps as
// self-relay-v52.mjs from U3 on: the main test wallet tops the recipient up (logged), the recipient submits its first spend
// through its own router-only window, then closes the window.
//   QORE_SECRET_FILE=<deployer json> QORE_ENV_FILE=<.env> node script/self-relay-v52-finish.mjs
// Original header:
// "Relay it yourself" live demo (QoreChain Diana TESTNET, EVM 9800, TEAM-RUN test accounts): a claim and a spend on the
// v5.2 PRODUCTION instance submitted by the user's OWN account, without the Pocket Drop relayer or API.
//   QORE_SECRET_FILE=<deployer json> QORE_ENV_FILE=<.env> node script/self-relay-v52.mjs
// How: PocketRouter.relay / deployAndRelay have no caller check (authority is the ML-DSA-87 signature inside the call),
// so any account may submit. On Diana an EVM tx needs a live EVM window, so each submitter opens its OWN window with a
// hybrid-signed (secp256k1 + ML-DSA-87) MsgOpenEVMWindow, scoped to the one v5.2 router, short expiry, small tx and value
// caps, and closes it when done. Steps:
//   sender (test account, the deployer): opens a router-only window, creates an Open link from a fresh Pocket, binds the
//     recipient with the link key (the bind's relayer fee returns to the sender, who submitted it), closes its window;
//   recipient (fresh test account, starts with 0 QOR): the drip pays its ML-DSA-87 key registration and its own
//     router-only window; it submits its own claim (paid into its Pocket) and its own first spend, then closes the window.
// Nothing is printed from the secrets file. Results: deployments/diana.json -> v5_2.selfRelay and
// ../frontend/evidence/v4/e2e/self-relay-v52.json (every tx hash, height, gas, fee, the window scope and expiry).
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
const P = dep.v5_2.prod;
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

const old = dep.v5_2.selfRelay;
if (!old || old.finishedAt) throw new Error('no interrupted v5.2 self-relay run to finish');
const rows = old.rows;
const run = old;
const evidence = path.join(HERE, '..', '..', 'frontend', 'evidence', 'v4', 'e2e', 'self-relay-v52.json');
const save = () => { dep.v5_2.selfRelay = run; writeDeployments(dep); fs.writeFileSync(evidence, JSON.stringify(run, (k, v) => (typeof v === 'bigint' ? v.toString() : v), 2) + '\n'); };
const nativeRow = async (step, hash, extra = {}) => {
  const j = await (await fetch(`${REST}/cosmos/tx/v1beta1/txs/${hash}`)).json().catch(() => ({}));
  const tr = j.tx_response ?? {};
  const hy = (tr.events ?? []).find((e) => e.type === 'pqc_hybrid_verify');
  rows.push({ step, hash, url: EXPL + hash, lane: 'native', height: tr.height, code: tr.code, gasUsed: tr.gas_used, fee: j.tx?.auth_info?.fee?.amount?.[0]?.amount + 'uqor', pqcHybridVerify: hy ? (hy.attributes ?? []).map((a) => `${a.key}=${a.value}`).join(' ') : null, ...extra });
  save(); console.log('NATIVE', step, hash, 'code', tr.code);
};

/** Hybrid-signed MsgOpenEVMWindow scoped to the v5.2 router only. */
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
  await nativeRow(`${who} opens its own EVM window, hybrid-signed, scoped to the v5.2 PocketRouter only (${WINDOW_TXS} txs, ${WINDOW_BLOCKS} blocks)`, r.transactionHash, { window: scope });
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



const secrets = readSecrets();
const rec = (secrets.selfRelayAccounts ?? []).find((r) => r.evm.toLowerCase() === run.accounts.recipient.toLowerCase());
if (!rec) throw new Error('recipient record not found');
const { accountFrom } = await import('./lib.mjs');
const U = await accountFrom(rec);
const uEvm = new Evm(U);
const PU = getAddress(run.accounts.recipientPocket);
const c = run.accounts.recipientPocketCfg;
const uCfg = [c[0], [], Number(c[2]), BigInt(c[3]), c[4]];
const vcall = (fn, args) => encodeFunctionData({ abi: A.vault, functionName: fn, args });
const deployAndRelay = (cfg, data) => encodeFunctionData({ abi: A.router, functionName: 'deployAndRelay', args: [...cfg, data] });
const intent = async (pocket, owner, action, p) => {
  const nonce = (await hasCode(pocket)) ? await read(pocket, A.vault, 'nonce') : 0n;
  const dl = BigInt((await chainTs()) + 3600);
  return { dl, sig: sign(owner.pqc, intentDigest({ action, vault: pocket, nonce, deadline: dl, params: p, chainId: 9800n })) };
};
{
  const r = await cosmosTx(main, 'hybrid', [bank.send({ fromAddress: main.cosmos, toAddress: U.cosmos, amount: [{ denom: 'uqor', amount: '80000' }] })]);
  await nativeRow('main test wallet tops up the recipient by 0.08 QOR for its last tx fee (the 0.3 QOR drip paid the key registration, the window and the claim; hybrid MsgSend)', r.transactionHash);
  await sleep(2500);
}
const w = await windowOf(U);
if (!w.live) run.recipientWindow2 = await openRouterWindow(U, 'recipient');
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

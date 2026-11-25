// v5 live smoke (QoreChain Diana TESTNET, EVM 9800, TEAM-RUN): one drop link sent and claimed, one Drop Pool hosted,
// claimed and closed, on the v5 PRODUCTION instance, with real ML-DSA-87 intents checked by pqcVerify on-chain.
//   QORE_SECRET_FILE=<deployer json> node script/smoke-v5.mjs
// Submitter: the deployer's EVM account (an any-submitter of router calls; it holds no user authority). Sender Pocket
// owner: the deployer's own registered ML-DSA-87 key. Recipient: a fresh account that starts with NOTHING; the drop's
// drip pays its key registration, exactly like an app newcomer. Keys never leave the secrets file; nothing is printed.
// Results: deployments/diana.json -> v5.smoke (every tx hash, status, gas, fee) and stdout.
import { mldsa } from '@qorechain/pqc';
import { keccak256, toHex, parseEther, encodeFunctionData, formatEther, getAddress } from 'viem';
import {
  loadDeployer, Evm, pub, windowOf, openWindow, artifact, readDeployments, writeDeployments, readSecrets, writeSecrets,
  newAccountRecord, registerWithPoP, keyStatus, EXPL, sleep,
} from './lib.mjs';
import { ACT, params, intentDigest, pqMessage, poolDigest, dropClaimDigest } from './fixtures-lib.mjs';

const dep = readDeployments();
const P = dep.v5.prod;
const A = { vault: artifact('PocketVault').abi, factory: artifact('PocketFactory').abi, drop: artifact('PocketDrop').abi, pool: artifact('DropPool').abi, router: artifact('PocketRouter').abi };
const deployer = await loadDeployer();
const evm = new Evm(deployer);
const u8 = (h) => Uint8Array.from(Buffer.from(h.slice(2), 'hex'));
const hx = (u) => toHex(u);
const sign = (key, digest) => hx(mldsa.sign(key.secretKey, u8(pqMessage(digest))));
const read = (address, abi, functionName, args = []) => pub.readContract({ address, abi, functionName, args });
const hasCode = async (a) => ((await pub.getCode({ address: a })) ?? '0x') !== '0x';
const chainTs = async () => Number((await pub.getBlock()).timestamp);
const startBal = await pub.getBalance({ address: evm.address });
const rows = [];
const run = { startedAt: new Date().toISOString(), instance: 'v5.prod', router: P.router.address, submitter: evm.address, rows };
const save = () => { dep.v5.smoke = run; writeDeployments(dep); };
async function tx(step, to, data, value = 0n) {
  const est = await pub.estimateGas({ account: evm.address, to, data, value });
  const { hash, receipt } = await evm.send({ to, data, value, gas: (est * 13n) / 10n });
  const fee = receipt.gasUsed * receipt.effectiveGasPrice;
  rows.push({ step, hash, url: EXPL + hash, status: receipt.status, block: String(receipt.blockNumber), gasUsed: String(receipt.gasUsed), feeQor: formatEther(fee), valueQor: formatEther(value) });
  save();
  console.log(`${receipt.status === 'success' ? 'OK ' : 'REV'} ${step} ${hash} gas ${receipt.gasUsed}`);
  if (receipt.status !== 'success') throw new Error(step + ' reverted ' + hash);
  return receipt;
}
const info = (step, outcome) => { rows.push({ step, hash: null, status: 'info', outcome }); save(); console.log('INFO', step, outcome); };

// deployer window (the EVM lane needs an open window since chain v3.2.0)
const w = await windowOf(deployer);
if (!w.live || BigInt(w.remainingTxs ?? 0) < 12n) {
  const o = await openWindow(deployer, { maxTxs: 20, blocks: 3000, gasCap: 4_000_000n, valueUqor: 1_500_000n });
  rows.push({ step: 'deployer opens a 20-tx EVM window (hybrid-signed native tx)', hash: o.hash, status: 'success', native: true }); save();
  console.log('window opened', o.hash);
}

const cfg = { owner: deployer.evm, guardians: [], threshold: 0, limit: parseEther('1'), userSalt: keccak256(toHex(crypto.getRandomValues(new Uint8Array(32)))) };
const cfgArgs = [cfg.owner, cfg.guardians, cfg.threshold, cfg.limit, cfg.userSalt];
const PS = await read(P.factory.address, A.factory, 'predict', cfgArgs);
const intent = async (pocket, action, p) => {
  const nonce = (await hasCode(pocket)) ? await read(pocket, A.vault, 'nonce') : 0n;
  const dl = BigInt((await chainTs()) + 3600);
  return { dl, sig: sign(deployer.pqc, intentDigest({ action, vault: pocket, nonce, deadline: dl, params: p, chainId: 9800n })) };
};
const vcall = (fn, args) => encodeFunctionData({ abi: A.vault, functionName: fn, args });
const relay = (target, data) => encodeFunctionData({ abi: A.router, functionName: 'relay', args: [target, data] });

// recipient: fresh, no QOR, no key yet
const secrets = readSecrets();
secrets.v5SmokeAccounts ??= [];
const { acc: R, record } = await newAccountRecord('v5 smoke recipient (starts empty)');
secrets.v5SmokeAccounts.push(record); writeSecrets(secrets);
info('recipient account (fresh, empty)', `${R.evm} balance ${formatEther(await pub.getBalance({ address: R.evm }))} QOR, key registered: ${(await keyStatus(R.evm)).registered}`);

// 1. fund the sender Pocket before it exists (counterfactual)
await tx('S1 fund the sender Pocket address before it exists (0.45 QOR)', PS, '0x', parseEther('0.45'));

// 2. lazy deploy + createDrop (Open link: 0.1 QOR + 0.1 QOR drip that pays the newcomer's key registration)
const lk = mldsa.keygen();
const lkh = keccak256(hx(lk.publicKey));
const AMT = parseEther('0.1'); const DRIP = parseEther('0.1');
const exp = BigInt((await chainTs()) + 3 * 3600);
{
  const p = params.createDrop(P.drop.address, lkh, 1, exp, DRIP, 0n, AMT + DRIP);
  const it = await intent(PS, ACT.CREATE_DROP, p);
  const data = vcall('createDrop', [P.drop.address, lkh, 1, exp, DRIP, 0n, AMT + DRIP, it.dl, it.sig]);
  await tx('D1 router.deployAndRelay: deploys the v5 Pocket and creates an Open drop link by ML-DSA-87 intent', P.router.address,
    encodeFunctionData({ abi: A.router, functionName: 'deployAndRelay', args: [...cfgArgs, data] }));
}
const linkId = await read(P.drop.address, A.drop, 'linkCount');
info('link created', `v5 prod link id ${linkId} (app link id q${linkId}), sender ${PS}`);

// 3. bind with the link key (as the recipient's browser does when the link is opened); drip pays the newcomer
const rKeyHash = keccak256(hx(R.pqc.publicKey));
{
  const d = await read(P.drop.address, A.drop, 'bindDigest', [linkId, R.evm, rKeyHash, R.evm]);
  await tx('D2 bind: the link key signs the recipient; the 0.1 QOR drip lands in the empty recipient account', P.router.address,
    relay(P.drop.address, encodeFunctionData({ abi: A.drop, functionName: 'bind', args: [linkId, R.evm, rKeyHash, R.evm, hx(lk.publicKey), sign(lk, d)] })));
}
// 4. the recipient registers its ML-DSA-87 key with proof of possession, paid by the drip
{
  let r; for (let i = 0; i < 3; i++) { try { r = await registerWithPoP(R); break; } catch (e) { if (i === 2) throw e; await sleep(4000); } }
  const ks = await keyStatus(R.evm);
  rows.push({ step: 'D3 recipient registers its ML-DSA-87 key with proof of possession (native tx, fee paid from the drip)', hash: r.hash, status: 'success', native: true, outcome: `possessionProven=${ks.possessionProven}` }); save();
  console.log('registered', r.hash, ks.possessionProven);
  await sleep(3000);
}
// 5. claim with the recipient's own key
{
  const d = await read(P.drop.address, A.drop, 'claimDigest', [linkId, R.evm, R.evm]);
  if (d !== dropClaimDigest({ drop: P.drop.address, id: linkId, recipient: R.evm, payTo: R.evm })) throw new Error('claim digest JS/contract mismatch');
  const before = await pub.getBalance({ address: R.evm });
  await tx('D4 claim: the recipient signs with its registered ML-DSA-87 key; 0.1 QOR paid', P.router.address,
    relay(P.drop.address, encodeFunctionData({ abi: A.drop, functionName: 'claim', args: [linkId, sign(R.pqc, d)] })));
  const gain = (await pub.getBalance({ address: R.evm })) - before;
  if (gain !== AMT) throw new Error('claim paid ' + gain);
  info('check: claim paid', `recipient +${formatEther(gain)} QOR, link state ${Number((await read(P.drop.address, A.drop, 'getLink', [linkId])).state)} (4 = Claimed)`);
}

// 6. pool: 2 slots x 0.05 QOR, one claimed by the recipient, then closed (the unclaimed slot returns)
const pk = mldsa.keygen();
const pkh = keccak256(hx(pk.publicKey));
const per = parseEther('0.05');
{
  const expP = BigInt((await chainTs()) + 3 * 3600);
  const it = await intent(PS, ACT.CREATE_POOL, params.createPool(P.pool.address, pkh, 2, per, expP));
  await tx('P1 the sender Pocket hosts a Drop Pool (2 slots x 0.05 QOR) by intent', P.router.address,
    relay(PS, vcall('createPool', [P.pool.address, pkh, 2, per, expP, it.dl, it.sig])));
}
const poolId = await read(P.pool.address, A.pool, 'poolCount');
{
  const ld = await read(P.pool.address, A.pool, 'linkDigest', [poolId, R.evm, R.evm]);
  const cd = await read(P.pool.address, A.pool, 'claimDigest', [poolId, R.evm, R.evm]);
  if (ld !== poolDigest({ domain: 'POCKET_POOL_LINK_V1', pool: P.pool.address, id: poolId, recipient: R.evm, payTo: R.evm })) throw new Error('pool digest mismatch');
  await tx(`P2 the recipient claims a slot of pool q${poolId} (link-key signature + its own signature)`, P.router.address,
    relay(P.pool.address, encodeFunctionData({ abi: A.pool, functionName: 'claim', args: [poolId, R.evm, R.evm, hx(pk.publicKey), sign(pk, ld), sign(R.pqc, cd)] })));
}
{
  const it = await intent(PS, ACT.CLOSE_POOL, params.closePool(P.pool.address, poolId));
  const before = await pub.getBalance({ address: PS });
  await tx('P3 the host Pocket closes the pool; the unclaimed slot returns to the Pocket', P.router.address, relay(PS, vcall('closePool', [P.pool.address, poolId, it.dl, it.sig])));
  info('check: pool refund', `Pocket +${formatEther((await pub.getBalance({ address: PS })) - before)} QOR`);
}
const endBal = await pub.getBalance({ address: evm.address });
run.finishedAt = new Date().toISOString();
run.pocket = getAddress(PS); run.recipient = R.evm; run.linkId = String(linkId); run.poolId = String(poolId);
run.deployerSpentQor = formatEther(startBal - endBal);
run.note = 'deployerSpentQor = EVM fees + the 0.45 QOR Pocket funding; of that, 0.1 QOR (claim) + 0.1 QOR (drip) + 0.05 QOR (slot) went to the recipient and the rest stays in the Pocket.';
save();
console.log(JSON.stringify({ pocket: run.pocket, recipient: R.evm, linkId: run.linkId, poolId: run.poolId, deployerSpentQor: run.deployerSpentQor }));

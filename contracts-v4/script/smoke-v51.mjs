// v5.1 live smoke (QoreChain Diana TESTNET, EVM 9800, TEAM-RUN) on the v5.1 PRODUCTION instance, real ML-DSA-87 everywhere:
//   D  an Open link sent, bound (fee to the signed feeTo) and claimed by a fresh empty account (journey)
//   F1 a copied bind with feeTo changed to the copier is refused on chain (BadLinkSignature): the front-runner gains nothing
//   I  intercept: a Confirmed link bound by an interceptor cannot be claimed before the sender's check; the sender cancels
//   P  a Drop Pool hosted, one slot claimed, closed
//   E  ERC-1271 on the live Pocket: the tagged, Pocket-bound approval is valid; the v5 untagged form is not (eth_call)
//   QORE_SECRET_FILE=<deployer json> node script/smoke-v51.mjs
// Submitter: the deployer's EVM account (an any-submitter of router calls; it holds no user authority). Sender Pocket
// owner: the deployer's own registered ML-DSA-87 key. Recipient: a fresh account that starts with NOTHING; the drop's
// drip pays its key registration, exactly like an app newcomer. Keys never leave the secrets file; nothing is printed.
// Results: deployments/diana.json -> v5_1.smoke (every tx hash, status, gas, fee) and stdout.
import { mldsa } from '@qorechain/pqc';
import { keccak256, toHex, parseEther, encodeFunctionData, formatEther, getAddress } from 'viem';
import {
  loadDeployer, Evm, pub, windowOf, openWindow, artifact, readDeployments, writeDeployments, readSecrets, writeSecrets,
  newAccountRecord, registerWithPoP, keyStatus, EXPL, sleep,
} from './lib.mjs';
import { ACT, params, intentDigest, pqMessage, pqMessageTagged, TAG_ERC1271, poolDigest, dropClaimDigest, dropBindDigest } from './fixtures-lib.mjs';

const dep = readDeployments();
const P = dep.v5_1.prod;
const FEE_TO = getAddress('0xF6e6fb2d33Bef3043682658E2b69F3a2F8616cCD'); // what the app signs: the relayer that submits sponsored binds
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
const run = { startedAt: new Date().toISOString(), instance: 'v5_1.prod', router: P.router.address, submitter: evm.address, rows };
const save = () => { dep.v5_1.smoke = run; writeDeployments(dep); };
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
/** Send a call that must revert, with a fixed gas limit, so the refusal is a mined transaction anyone can open. */
async function txRevert(step, to, data, gas = 900_000n) {
  const { hash, receipt } = await evm.send({ to, data, value: 0n, gas });
  const fee = receipt.gasUsed * receipt.effectiveGasPrice;
  rows.push({ step, hash, url: EXPL + hash, status: receipt.status, expected: 'reverted', block: String(receipt.blockNumber), gasUsed: String(receipt.gasUsed), feeQor: formatEther(fee) });
  save();
  console.log(`${receipt.status === 'reverted' ? 'REFUSED (as expected)' : 'UNEXPECTED SUCCESS'} ${step} ${hash}`);
  if (receipt.status !== 'reverted') throw new Error(step + ' did not revert ' + hash);
  return receipt;
}
async function simRevert(to, data) { try { await pub.call({ account: evm.address, to, data }); return null; } catch (e) { return (e.shortMessage ?? e.message).split('\n')[0]; } }
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

// accounts: a fresh recipient and a fresh interceptor, both start with nothing
const secrets = readSecrets();
secrets.v51SmokeAccounts ??= [];
const { acc: R, record } = await newAccountRecord('v5.1 smoke recipient (team test account, starts empty)');
const { acc: X, record: xr } = await newAccountRecord('v5.1 smoke interceptor (team test account, starts empty)');
secrets.v51SmokeAccounts.push(record, xr); writeSecrets(secrets);
run.accounts = { recipient: R.evm, interceptor: X.evm, feeTo: FEE_TO };
info('team test accounts (fresh, empty)', `recipient ${R.evm}, interceptor ${X.evm}; balances ${formatEther(await pub.getBalance({ address: R.evm }))} / ${formatEther(await pub.getBalance({ address: X.evm }))} QOR`);

await tx('S1 fund the sender Pocket address before it exists (0.75 QOR)', PS, '0x', parseEther('0.75'));

const AMT = parseEther('0.1'); const DRIP = parseEther('0.1'); const FEE = parseEther('0.05');
const createDrop = async (mode, lkh, step, lazy) => {
  const exp = BigInt((await chainTs()) + 3 * 3600);
  const p = params.createDrop(P.drop.address, lkh, mode, exp, DRIP, FEE, AMT + DRIP + FEE);
  const it = await intent(PS, ACT.CREATE_DROP, p);
  const data = vcall('createDrop', [P.drop.address, lkh, mode, exp, DRIP, FEE, AMT + DRIP + FEE, it.dl, it.sig]);
  await tx(step, P.router.address, lazy ? encodeFunctionData({ abi: A.router, functionName: 'deployAndRelay', args: [...cfgArgs, data] }) : relay(PS, data));
  return read(P.drop.address, A.drop, 'linkCount');
};
const bindData = (id, lk, who, payTo, feeTo, signedFeeTo = feeTo) => {
  const kh = keccak256(hx(who.pqc.publicKey));
  const d = dropBindDigest({ drop: P.drop.address, id, recipient: who.evm, keyHash: kh, payTo, feeTo: signedFeeTo });
  return relay(P.drop.address, encodeFunctionData({ abi: A.drop, functionName: 'bind', args: [id, who.evm, kh, payTo, feeTo, hx(lk.publicKey), sign(lk, d)] }));
};

// D. journey on an Open link
const lk = mldsa.keygen();
const linkId = await createDrop(1, keccak256(hx(lk.publicKey)), 'D1 router.deployAndRelay: deploys the v5.1 Pocket and creates an Open drop link (0.1 QOR, 0.1 drip, 0.05 delivery fee) by ML-DSA-87 intent', true);
info('link created', `v5.1 prod link id ${linkId} (app link id r${linkId}), sender Pocket ${PS}`);
{
  const kh = keccak256(hx(R.pqc.publicKey));
  const onchain = await read(P.drop.address, A.drop, 'bindDigest', [linkId, R.evm, kh, R.evm, FEE_TO]);
  if (onchain !== dropBindDigest({ drop: P.drop.address, id: linkId, recipient: R.evm, keyHash: kh, payTo: R.evm, feeTo: FEE_TO })) throw new Error('bind digest JS/contract mismatch');
  // F1: a front-runner copies the signed bind and swaps feeTo to itself: the link signature no longer matches
  await txRevert('F1 front-run attempt: the signed bind copied with feeTo changed to the copier; refused on chain (BadLinkSignature), nothing paid', P.router.address, bindData(linkId, lk, R, R.evm, evm.address, FEE_TO));
  const fb = await pub.getBalance({ address: FEE_TO });
  await tx('D2 bind: the link key signs recipient, payout address and feeTo; the 0.1 QOR drip lands in the empty recipient account, the 0.05 QOR fee goes to the signed feeTo', P.router.address, bindData(linkId, lk, R, R.evm, FEE_TO));
  const got = (await pub.getBalance({ address: FEE_TO })) - fb;
  if (got !== FEE) throw new Error('feeTo got ' + got);
  info('check: fee went to the signed feeTo, not to the submitter', `feeTo ${FEE_TO} +${formatEther(got)} QOR; submitter ${evm.address} is not feeTo`);
}
{
  let r; for (let i = 0; i < 3; i++) { try { r = await registerWithPoP(R); break; } catch (e) { if (i === 2) throw e; await sleep(4000); } }
  const ks = await keyStatus(R.evm);
  rows.push({ step: 'D3 recipient registers its ML-DSA-87 key with proof of possession (native tx, fee paid from the drip)', hash: r.hash, status: 'success', native: true, outcome: `possessionProven=${ks.possessionProven}` }); save();
  console.log('registered', r.hash, ks.possessionProven);
  await sleep(3000);
}
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

// I. intercept on a Confirmed link
const lk2 = mldsa.keygen();
const cId = await createDrop(0, keccak256(hx(lk2.publicKey)), 'I1 the sender Pocket creates a Confirmed link ("Someone I know") by intent', false);
await tx(`I2 an interceptor who got the link (r${cId}) binds it to its own key`, P.router.address, bindData(cId, lk2, X, X.evm, FEE_TO));
const xClaim = async () => {
  const d = await read(P.drop.address, A.drop, 'claimDigest', [cId, X.evm, X.evm]);
  return relay(P.drop.address, encodeFunctionData({ abi: A.drop, functionName: 'claim', args: [cId, sign(X.pqc, d)] }));
};
await txRevert('I3 the interceptor tries to claim before the sender checked the key; refused on chain (InvalidState Bound)', P.router.address, await xClaim());
{
  const it = await intent(PS, ACT.CANCEL_DROP, params.cancel(P.drop.address, cId));
  const before = await pub.getBalance({ address: PS });
  await tx('I4 the sender sees a key it does not know and cancels; the escrow returns to its Pocket', P.router.address, relay(PS, vcall('cancelDrop', [P.drop.address, cId, it.dl, it.sig])));
  info('check: cancel refund', `Pocket +${formatEther((await pub.getBalance({ address: PS })) - before)} QOR (0.1 escrow; drip and fee were paid at the first bind)`);
}
await txRevert('I5 the interceptor tries again after the cancel; refused on chain (InvalidState Cancelled)', P.router.address, await xClaim());

// P. pool
const pk = mldsa.keygen();
const pkh = keccak256(hx(pk.publicKey));
const per = parseEther('0.05');
{
  const expP = BigInt((await chainTs()) + 3 * 3600);
  const it = await intent(PS, ACT.CREATE_POOL, params.createPool(P.pool.address, pkh, 2, per, expP));
  await tx('P1 the sender Pocket hosts a Drop Pool (2 slots x 0.05 QOR) by intent', P.router.address, relay(PS, vcall('createPool', [P.pool.address, pkh, 2, per, expP, it.dl, it.sig])));
}
const poolId = await read(P.pool.address, A.pool, 'poolCount');
{
  const ld = await read(P.pool.address, A.pool, 'linkDigest', [poolId, R.evm, R.evm]);
  const cd = await read(P.pool.address, A.pool, 'claimDigest', [poolId, R.evm, R.evm]);
  if (ld !== poolDigest({ domain: 'POCKET_POOL_LINK_V1', pool: P.pool.address, id: poolId, recipient: R.evm, payTo: R.evm })) throw new Error('pool digest mismatch');
  await tx(`P2 the recipient claims a slot of pool r${poolId} (link-key signature + its own signature)`, P.router.address,
    relay(P.pool.address, encodeFunctionData({ abi: A.pool, functionName: 'claim', args: [poolId, R.evm, R.evm, hx(pk.publicKey), sign(pk, ld), sign(R.pqc, cd)] })));
}
{
  const it = await intent(PS, ACT.CLOSE_POOL, params.closePool(P.pool.address, poolId));
  const before = await pub.getBalance({ address: PS });
  await tx('P3 the host Pocket closes the pool; the unclaimed slot returns to the Pocket', P.router.address, relay(PS, vcall('closePool', [P.pool.address, poolId, it.dl, it.sig])));
  info('check: pool refund', `Pocket +${formatEther((await pub.getBalance({ address: PS })) - before)} QOR`);
}

// E. ERC-1271 on the live Pocket (eth_call against the deployed code)
{
  const h = keccak256(toHex('v5.1 smoke: an outside hash a dApp asks the Pocket to approve'));
  const d1271 = await read(PS, A.vault, 'erc1271Digest', [h]);
  const tagged = hx(mldsa.sign(deployer.pqc.secretKey, u8(pqMessageTagged(TAG_ERC1271, d1271))));
  const untagged = sign(deployer.pqc, h);
  const a = await read(PS, A.vault, 'isValidSignature', [h, tagged]);
  const b = await read(PS, A.vault, 'isValidSignature', [h, untagged]);
  if (a !== '0x1626ba7e' || b !== '0xffffffff') throw new Error(`erc1271 live ${a} ${b}`);
  info('E1 ERC-1271 (eth_call on the live Pocket): tagged, Pocket-bound approval', `isValidSignature = ${a} (valid)`);
  info('E2 ERC-1271 (eth_call on the live Pocket): the v5 untagged approval of the same hash', `isValidSignature = ${b} (refused)`);
  const ig = intentDigest({ action: ACT.SPEND, vault: PS, nonce: await read(PS, A.vault, 'nonce'), deadline: BigInt((await chainTs()) + 3600), params: params.spend(evm.address, 1n), chainId: 9800n });
  const asIntent = hx(mldsa.sign(deployer.pqc.secretKey, u8(pqMessageTagged(TAG_ERC1271, await read(PS, A.vault, 'erc1271Digest', [ig])))));
  const why = await simRevert(P.router.address, relay(PS, vcall('spend', [evm.address, 1n, BigInt((await chainTs()) + 3600), asIntent])));
  info('E3 an ERC-1271 approval of a spend-intent digest, submitted as that spend (eth_call)', why ? `refused: ${why}` : 'ACCEPTED (unexpected)');
  if (!why) throw new Error('E3 accepted');
}

const endBal = await pub.getBalance({ address: evm.address });
run.finishedAt = new Date().toISOString();
run.pocket = getAddress(PS); run.linkId = String(linkId); run.confirmedLinkId = String(cId); run.poolId = String(poolId);
run.deployerSpentQor = formatEther(startBal - endBal);
run.note = 'TEAM-RUN on the v5.1 production instance. Every account is a team test account. deployerSpentQor = EVM fees + the 0.75 QOR Pocket funding (what is not paid out stays in the Pocket).';
save();
console.log(JSON.stringify({ pocket: run.pocket, linkId: run.linkId, confirmedLinkId: run.confirmedLinkId, poolId: run.poolId, deployerSpentQor: run.deployerSpentQor }));

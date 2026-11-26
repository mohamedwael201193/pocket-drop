// v5.2 live smoke (QoreChain Diana TESTNET, EVM 9800, TEAM-RUN) on the v5.2 PRODUCTION and LAB instances, real ML-DSA-87 everywhere:
//   D  an Open link sent, bound (fee to the signed feeTo) and claimed by a fresh empty account (journey)
//   F1 a copied bind with feeTo changed to the copier is refused on chain (BadLinkSignature): the front-runner gains nothing
//   I  intercept: a Confirmed link bound by an interceptor cannot be claimed before the sender's check; the sender cancels
//   P  a Drop Pool hosted, one slot claimed, closed
//   E  ERC-1271 on the live Pocket: the tagged, Pocket-bound approval is valid; the v5 untagged form is not (eth_call)
//   R  v5.2 finalize access control on a LAB Pocket (60 s / 180 s delays) with two fresh guardians and a fresh new owner:
//      finalize too early, by an unrelated account, with a forged guardian authorization and with an expired one are refused;
//      the approved new owner finalizes with its own signed authorization; a unanimous recovery is then refused for the
//      current owner and finalized by a guardian's signed authorization. Every call goes through the lab PocketRouter.
//   The deployer's EVM window is closed at the end (hybrid-signed MsgCloseEVMWindow).
//   QORE_SECRET_FILE=<deployer json> QORE_ENV_FILE=<.env> node script/smoke-v52.mjs
// Submitter: the deployer's EVM account (an any-submitter of router calls; it holds no user authority). Sender Pocket
// owner: the deployer's own registered ML-DSA-87 key. Recipient: a fresh account that starts with NOTHING; the drop's
// drip pays its key registration, exactly like an app newcomer. Keys never leave the secrets file; nothing is printed.
// Results: deployments/diana.json -> v5_2.smoke (every tx hash, status, gas, fee) and stdout.
import { mldsa } from '@qorechain/pqc';
import { keccak256, toHex, toBytes, parseEther, encodeFunctionData, encodeAbiParameters, decodeEventLog, formatEther, getAddress } from 'viem';
import { closeEvmWindowMsg } from '@qorechain/sdk';
import {
  loadDeployer, Evm, pub, windowOf, openWindow, artifact, readDeployments, writeDeployments, readSecrets, writeSecrets,
  newAccountRecord, registerWithPoP, keyStatus, cosmosTx, EXPL, sleep,
} from './lib.mjs';
import { ACT, params, intentDigest, pqMessage, pqMessageTagged, TAG_ERC1271, poolDigest, dropClaimDigest, dropBindDigest } from './fixtures-lib.mjs';

const dep = readDeployments();
const P = dep.v5_2.prod;
const L = dep.v5_2.lab;
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
const run = { startedAt: new Date().toISOString(), instance: 'v5_2.prod + v5_2.lab', router: P.router.address, submitter: evm.address, rows };
const save = () => { dep.v5_2.smoke = run; writeDeployments(dep); };
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
if (!w.live || BigInt(w.remainingTxs ?? 0) < 30n) {
  const o = await openWindow(deployer, { maxTxs: 40, blocks: 3000, gasCap: 4_000_000n, valueUqor: 2_000_000n });
  rows.push({ step: 'deployer opens a 40-tx EVM window (hybrid-signed native tx)', hash: o.hash, status: 'success', native: true }); save();
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
secrets.v52SmokeAccounts ??= [];
const { acc: R, record } = await newAccountRecord('v5.2 smoke recipient (team test account, starts empty)');
const { acc: X, record: xr } = await newAccountRecord('v5.2 smoke interceptor (team test account, starts empty)');
secrets.v52SmokeAccounts.push(record, xr); writeSecrets(secrets);
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
const linkId = await createDrop(1, keccak256(hx(lk.publicKey)), 'D1 router.deployAndRelay: deploys the v5.2 Pocket and creates an Open drop link (0.1 QOR, 0.1 drip, 0.05 delivery fee) by ML-DSA-87 intent', true);
info('link created', `v5.2 prod link id ${linkId} (app link id s${linkId}), sender Pocket ${PS}`);
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
await tx(`I2 an interceptor who got the link (s${cId}) binds it to its own key`, P.router.address, bindData(cId, lk2, X, X.evm, FEE_TO));
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
  await tx(`P2 the recipient claims a slot of pool s${poolId} (link-key signature + its own signature)`, P.router.address,
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
  const h = keccak256(toHex('v5.2 smoke: an outside hash a dApp asks the Pocket to approve'));
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


// R. v5.2 finalize access control on a LAB Pocket (all calls through the lab router, like the relayer would submit them)
const FIN = keccak256(toBytes('POCKET_FINALIZE_RECOVERY_V1'));
const FIN_U = keccak256(toBytes('POCKET_FINALIZE_RECOVERY_UNANIMOUS_V1'));
const finDigest = ({ vault, unanimous, recNonce, newOwner, newKeyHash, authorizer, deadline }) => keccak256(encodeAbiParameters(
  ['bytes32', 'uint256', 'address', 'uint256', 'address', 'bytes32', 'address', 'uint256'].map((type) => ({ type })),
  [unanimous ? FIN_U : FIN, 9800n, vault, recNonce, newOwner, newKeyHash, authorizer, deadline]));
const lrelay = (target, data) => encodeFunctionData({ abi: A.router, functionName: 'relay', args: [target, data] });
let PL, G1, G2, N;
{
  const sec = readSecrets();
  const mk = async (role) => { const { acc, record: r } = await newAccountRecord(role); sec.v52SmokeAccounts.push(r); writeSecrets(sec); return acc; };
  G1 = await mk('v5.2 smoke guardian 1 (team test account)');
  G2 = await mk('v5.2 smoke guardian 2 (team test account)');
  N = await mk('v5.2 smoke new owner (team test account)');
  run.recoveryAccounts = { guardian1: G1.evm, guardian2: G2.evm, newOwner: N.evm, oldOwner: deployer.evm };
  for (const [who, a] of [['guardian 1', G1], ['guardian 2', G2], ['new owner', N]]) {
    await tx(`R0 fund the ${who} account for its key registration (0.1 QOR)`, a.evm, '0x', parseEther('0.1'));
    let r; for (let i = 0; i < 3; i++) { try { r = await registerWithPoP(a); break; } catch (e) { if (i === 2) throw e; await sleep(4000); } }
    const ks = await keyStatus(a.evm);
    rows.push({ step: `R0 the ${who} registers its ML-DSA-87 key with proof of possession (native tx)`, hash: r.hash, status: 'success', native: true, outcome: `possessionProven=${ks.possessionProven}` }); save();
    console.log('registered', who, r.hash, ks.possessionProven);
  }
  await sleep(3000);
  const lcfg = [deployer.evm, [G1.evm, G2.evm], 2, parseEther('1'), keccak256(toHex(crypto.getRandomValues(new Uint8Array(32))))];
  PL = await read(L.factory.address, A.factory, 'predict', lcfg);
  await tx('R1 deploy a LAB Pocket owned by the deployer key with guardians G1, G2 (2 of 2)', L.factory.address, encodeFunctionData({ abi: A.factory, functionName: 'deploy', args: lcfg }));
  run.labPocket = getAddress(PL);
  info('lab Pocket', `${PL}, owner ${deployer.evm}, guardians ${G1.evm}, ${G2.evm}, threshold 2`);
}
const NKH = keccak256(hx(N.pqc.publicKey));
const DKH = keccak256(hx(deployer.pqc.publicKey));
const guardianSigs = async (fn, newOwner, kh) => {
  const dl = BigInt((await chainTs()) + 3600);
  const d = await read(PL, A.vault, fn, [newOwner, kh, dl]);
  return { dl, sigs: [sign(G1.pqc, d), sign(G2.pqc, d)] };
};
const finCall = (unanimous, authorizer, dl, sig) => lrelay(PL, vcall(unanimous ? 'finalizeRecoveryUnanimous' : 'finalizeRecovery', [authorizer, dl, sig]));
const authBy = async (unanimous, authorizer, key, dlOffset = 3600) => {
  const dl = BigInt((await chainTs()) + dlOffset);
  const onchain = await read(PL, A.vault, 'finalizeDigest', [unanimous ? FIN_U : FIN, authorizer, dl]);
  const local = finDigest({ vault: PL, unanimous, recNonce: await read(PL, A.vault, 'recoveryNonce'),
    newOwner: await read(PL, A.vault, unanimous ? 'uRecoveryOwner' : 'recoveryOwner'), newKeyHash: await read(PL, A.vault, unanimous ? 'uRecoveryKeyHash' : 'recoveryKeyHash'), authorizer, deadline: dl });
  if (onchain !== local) throw new Error('finalizeDigest JS/contract mismatch');
  return { dl, sig: sign(key, onchain) };
};
const authEvent = (receipt) => receipt.logs.map((l) => { try { return decodeEventLog({ abi: A.vault, data: l.data, topics: l.topics }); } catch { return null; } }).find((e) => e?.eventName === 'RecoveryFinalizeAuthorized');
{
  const g = await guardianSigs('recoveryDigest', N.evm, NKH);
  await tx('R2 guardians G1 + G2 propose a threshold recovery of the lab Pocket to the new owner N (ML-DSA-87 signatures)', L.router.address,
    lrelay(PL, vcall('proposeRecovery', [N.evm, NKH, g.dl, [G1.evm, G2.evm], g.sigs])));
  const early = await authBy(false, N.evm, N.pqc);
  await txRevert('R3 ATTACK finalize before the 60 s recovery delay, even with the new owner\'s valid authorization: refused (TooEarly)', L.router.address, finCall(false, N.evm, early.dl, early.sig), 2_500_000n);
  const at = Number(await read(PL, A.vault, 'recoveryAt'));
  while ((await chainTs()) <= at) await sleep(3000);
  const xa = await authBy(false, X.evm, X.pqc);
  await txRevert('R4 ATTACK an unrelated account (the interceptor) signs a finalize authorization for itself: refused (NotAuthorized)', L.router.address, finCall(false, X.evm, xa.dl, xa.sig), 2_500_000n);
  const forged = await authBy(false, G1.evm, X.pqc);
  await txRevert('R5 ATTACK a finalize that names guardian G1 as authorizer but carries another key\'s signature: refused (BadSignature)', L.router.address, finCall(false, G1.evm, forged.dl, forged.sig), 2_500_000n);
  const old = await authBy(false, N.evm, N.pqc, -60);
  const why = await simRevert(L.router.address, finCall(false, N.evm, old.dl, old.sig));
  info('R6 a finalize authorization whose deadline has passed (eth_call)', why ? `refused: ${why}` : 'ACCEPTED (unexpected)');
  if (!why) throw new Error('R6 accepted');
  const ok = await authBy(false, N.evm, N.pqc);
  const rc = await tx('R7 the approved new owner N finalizes the recovery with its own ML-DSA-87 authorization: owner is now N', L.router.address, finCall(false, N.evm, ok.dl, ok.sig));
  const ev = authEvent(rc);
  const owner = await read(PL, A.vault, 'owner');
  if (getAddress(owner) !== getAddress(N.evm) || !ev || getAddress(ev.args.authorizer) !== getAddress(N.evm) || ev.args.unanimous) throw new Error('R7 owner or event wrong');
  info('check: threshold finalize', `owner ${owner}; RecoveryFinalizeAuthorized(authorizer ${ev.args.authorizer}, nonce ${ev.args.recoveryNonce}, unanimous ${ev.args.unanimous})`);
}
{
  const g = await guardianSigs('unanimousDigest', deployer.evm, DKH);
  await tx('U1 all guardians (G1 + G2) propose a unanimous recovery of the lab Pocket back to the deployer key (the Pocket freezes)', L.router.address,
    lrelay(PL, vcall('proposeRecoveryUnanimous', [deployer.evm, DKH, g.dl, [G1.evm, G2.evm], g.sigs])));
  const at = Number(await read(PL, A.vault, 'uRecoveryAt'));
  while ((await chainTs()) <= at) await sleep(3000);
  const byOwner = await authBy(true, N.evm, N.pqc);
  await txRevert('U2 ATTACK the current owner (N, the key a unanimous recovery replaces) authorizes the unanimous finalize: refused (NotAuthorized)', L.router.address, finCall(true, N.evm, byOwner.dl, byOwner.sig), 2_500_000n);
  const byG = await authBy(true, G1.evm, G1.pqc);
  const rc = await tx('U3 guardian G1 finalizes the unanimous recovery with its ML-DSA-87 authorization: owner is the deployer key again', L.router.address, finCall(true, G1.evm, byG.dl, byG.sig));
  const ev = authEvent(rc);
  const owner = await read(PL, A.vault, 'owner');
  if (getAddress(owner) !== getAddress(deployer.evm) || !ev || getAddress(ev.args.authorizer) !== getAddress(G1.evm) || !ev.args.unanimous) throw new Error('U3 owner or event wrong');
  info('check: unanimous finalize', `owner ${owner}; RecoveryFinalizeAuthorized(authorizer ${ev.args.authorizer}, nonce ${ev.args.recoveryNonce}, unanimous ${ev.args.unanimous})`);
}

// close the deployer's EVM window (the EVM lane stays shut between runs)
{
  const r = await cosmosTx(deployer, 'hybrid', [closeEvmWindowMsg(deployer.cosmos)], { gas: '400000', fee: '60000' });
  if (r.code !== 0) throw new Error('close window failed code ' + r.code);
  await sleep(4000);
  const w2 = await windowOf(deployer);
  rows.push({ step: 'deployer closes its EVM window (hybrid-signed native tx)', hash: r.transactionHash, status: 'success', native: true, outcome: `live after: ${!!w2.live}` }); save();
  console.log('window closed', r.transactionHash, 'live', !!w2.live);
}

const endBal = await pub.getBalance({ address: evm.address });
run.finishedAt = new Date().toISOString();
run.pocket = getAddress(PS); run.linkId = String(linkId); run.confirmedLinkId = String(cId); run.poolId = String(poolId);
run.deployerSpentQor = formatEther(startBal - endBal);
run.note = 'TEAM-RUN on the v5.2 production instance (journey, copied bind, intercept, pool, ERC-1271) and the v5.2 lab instance (finalize access control). Every account is a team test account. deployerSpentQor = EVM fees + the 0.75 QOR Pocket funding + 0.3 QOR key-registration funding (what is not paid out stays in the Pocket).';
save();
console.log(JSON.stringify({ labPocket: run.labPocket, pocket: run.pocket, linkId: run.linkId, confirmedLinkId: run.confirmedLinkId, poolId: run.poolId, deployerSpentQor: run.deployerSpentQor }));

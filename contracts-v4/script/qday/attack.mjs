// "Steal this Pocket": try every path an attacker with ONLY a bait's classical secp256k1 key has.
// READ-ONLY by default: Cosmos-lane attempts run through CometBFT check_tx (nothing is broadcast) and Pocket/drop
// attempts run as eth_call. Nothing here needs a wallet or QOR.
//   node script/qday/attack.mjs                      # all published baits (keys fetched from the live API when published)
//   node script/qday/attack.mjs --bait B1 --key <64 hex secp256k1 key>
//   node script/qday/attack.mjs --broadcast          # really broadcast the Cosmos-lane attempts (rejected in CheckTx: free)
//   node script/qday/attack.mjs --mine B1:E1         # ask the live relayer to put one Pocket attempt on chain (rate-limited)
// Output: a table plus JSON (--json). Diana testnet only.
import fs from 'node:fs';
import path from 'node:path';
import { bank, evmToQor, buildRegisterPqcKeyMsg, signProofOfPossession, rotatePqcKeyMsg, rotationSignBytes, openEvmWindowMsg, linkAuthenticatorMsgs, signAuthenticatorLinkSecp256k1 } from '@qorechain/sdk';
import { mldsa } from '@qorechain/pqc';
import { encodeFunctionData, decodeErrorResult, keccak256, toHex, parseEther, zeroAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { pub, PROD, ABI, ALL_ERRORS, API, C4, attackerView, keyStatus, windowStatus, nativeTx, net, hexb, rand32 } from './common.mjs';
import { ACT, intentDigest, pqMessage, params } from '../fixtures-lib.mjs';

const argv = process.argv.slice(2);
const opt = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
const flag = (k) => argv.includes(k);
const MODE = flag('--broadcast') ? 'broadcast' : 'check';
const SINK = '0x000000000000000000000000000000000000dEaD'; // where the attacker would send the money

/** Build every attack for one bait. Returns rows { id, path, lane, outcome, detail }. */
export async function attackBait(bait, classicalKey, { mode = MODE } = {}) {
  const AV = attackerView(classicalKey, rand32());
  if (AV.evm.toLowerCase() !== bait.keyAccount.toLowerCase()) throw new Error(`key does not belong to ${bait.id}`);
  const atk = AV.pqc; const ecdsa = privateKeyToAccount(AV.privateKey);
  const rows = []; const push = (id, p, lane, outcome, detail) => rows.push({ bait: bait.id, id, path: p, lane, outcome, detail });
  const ks0 = await keyStatus(AV.evm);
  const realPub = hexb(ks0.pubkey);
  const T = { gas: '800000', fee: '100000', mode };
  const cos = async (id, p, signMode, msgs) => { const r = await nativeTx(AV, signMode, msgs, T); push(id, p, `cosmos (${signMode}, ${r.mode ?? 'broadcast'})`, r.code === 0 ? 'ACCEPTED' : 'refused', `code ${r.code}: ${r.log}`); };
  const send = bank.send({ fromAddress: AV.cosmos, toAddress: evmToQor(SINK), amount: [{ denom: 'uqor', amount: '10000' }] });
  await cos('A1', 'bank send out of the key account', 'classical', [send]);
  await cos('A2', 'bank send, hybrid-signed with an attacker ML-DSA key', 'hybrid', [send]);
  const reg = buildRegisterPqcKeyMsg(AV.cosmos, { pqcKeypair: atk, ecdsaPubkey: hexb(AV.publicKey), proofOfPossession: signProofOfPossession({ chainId: net.chainId, account: AV.cosmos, keypair: atk }) });
  await cos('A3', 're-register the PQ key to an attacker key', 'classical', [reg]);
  await cos('A3b', 're-register, hybrid with the attacker key', 'hybrid', [reg]);
  const txt = new TextEncoder().encode(rotationSignBytes(net.chainId, 1, AV.cosmos, realPub, atk.publicKey));
  const rot = rotatePqcKeyMsg({ sender: AV.cosmos, oldPublicKey: realPub, newPublicKey: atk.publicKey, oldSignature: mldsa.sign(atk.secretKey, txt), newSignature: mldsa.sign(atk.secretKey, txt) });
  await cos('A4', 'rotate the PQ key (old-key signature forged)', 'classical', [rot]);
  await cos('A4b', 'rotate, hybrid with the attacker key', 'hybrid', [rot]);
  const win = openEvmWindowMsg({ sender: AV.cosmos, blocks: 2000, maxTxs: 5, maxValue: 300000n });
  await cos('A5', 'open an EVM window', 'classical', [win]);
  await cos('A5b', 'open an EVM window, hybrid with the attacker key', 'hybrid', [win]);
  try {
    const proof = signAuthenticatorLinkSecp256k1({ chainId: net.chainId, account: AV.cosmos, privateKey: hexb(rand32()) });
    const msgs = linkAuthenticatorMsgs({ owner: AV.cosmos, scheme: 'secp256k1', pubkey: proof.pubkey, permissions: ['send', 'evm'], expiryUnix: Math.floor(Date.now() / 1000) + 86400, possessionProof: proof.possessionProof, chainId: net.chainId, spendingRule: { perTxLimit: '1000000', dailyLimit: '1000000', enabled: true, allowedDenoms: ['uqor'] } });
    await cos('A7', 'link an attacker key as an account authenticator (send+evm)', 'classical', msgs);
  } catch (e) { push('A7', 'link an attacker authenticator', 'cosmos', 'not built', String(e.message).slice(0, 120)); }
  const w = await windowStatus(AV.cosmos);
  push('A6', 'EVM tx from the key account', 'evm', w.live ? 'WINDOW LIVE - EXPOSED' : 'refused (no live window)', `window live=${w.live}`);

  // Pocket / drop paths (eth_call; from any address, exactly what the relayer or anyone would submit)
  const VP = bait.pocket;
  const call = async (id, p, to, data) => {
    let outcome = 'NO REVERT', detail = '';
    try { await pub.call({ account: zeroAddress, to, data }); } catch (e) {
      const d = e.walk?.((q) => typeof q?.data === 'string')?.data ?? e.data;
      try { detail = decodeErrorResult({ abi: ALL_ERRORS, data: d }).errorName; outcome = 'reverted'; } catch { outcome = 'reverted'; detail = String(e.shortMessage ?? d).slice(0, 80); }
    }
    push(id, p, 'evm (eth_call)', outcome === 'NO REVERT' ? 'WOULD SUCCEED' : outcome, detail);
    return { to, data };
  };
  const deployed = (await pub.getCode({ address: VP }) ?? '0x') !== '0x';
  const nonce = deployed ? await pub.readContract({ address: VP, abi: ABI.vault, functionName: 'nonce' }) : 0n;
  const dl = BigInt((await pub.getBlock()).timestamp) + 3600n;
  const signAtk = (action, p) => toHex(mldsa.sign(atk.secretKey, hexb(pqMessage(intentDigest({ action, vault: VP, nonce, deadline: dl, params: p, chainId: 9800n })))));
  const cfg = bait.config;
  const viaRouter = (inner) => deployed
    ? encodeFunctionData({ abi: ABI.router, functionName: 'relay', args: [VP, inner] })
    : encodeFunctionData({ abi: ABI.router, functionName: 'deployAndRelay', args: [cfg.owner, cfg.guardians, cfg.threshold, BigInt(cfg.dailyLimitWei), cfg.userSalt, inner] });
  const v = (fn, a) => encodeFunctionData({ abi: ABI.vault, functionName: fn, args: a });
  const amt = parseEther('0.04');
  const attempts = {};
  attempts.E1 = await call('E1', 'Pocket.spend to the attacker, attacker ML-DSA signature', PROD.router.address, viaRouter(v('spend', [SINK, amt, dl, signAtk(ACT.SPEND, params.spend(SINK, amt))])));
  const digest = intentDigest({ action: ACT.SPEND, vault: VP, nonce, deadline: dl, params: params.spend(SINK, amt), chainId: 9800n });
  attempts.E2 = await call('E2', 'Pocket.spend signed with the CLASSICAL ECDSA key', PROD.router.address, viaRouter(v('spend', [SINK, amt, dl, await ecdsa.sign({ hash: digest })])));
  attempts.E3 = await call('E3', 'Pocket.setGuardians to attacker keys', PROD.router.address, viaRouter(v('setGuardians', [[SINK, '0x000000000000000000000000000000000000bEEF'], 2, dl, signAtk(ACT.SET_GUARDIANS, params.guardians([SINK, '0x000000000000000000000000000000000000bEEF'], 2))])));
  attempts.E4 = await call('E4', 'Pocket.setLimit 100 QOR', PROD.router.address, viaRouter(v('setLimit', [parseEther('100'), dl, signAtk(ACT.SET_LIMIT, params.limit(parseEther('100')))])));
  attempts.E5 = await call('E5', 'Pocket.cancelPending', PROD.router.address, viaRouter(v('cancelPending', [dl, signAtk(ACT.CANCEL_PENDING, '0x')])));
  const lk = keccak256(toHex(rand32())); const exp = dl + 3600n;
  attempts.E6 = await call('E6', 'Pocket.createDrop to a link the attacker holds', PROD.router.address, viaRouter(v('createDrop', [PROD.drop.address, lk, 1, exp, 0n, 0n, parseEther('0.1'), dl, signAtk(ACT.CREATE_DROP, params.createDrop(PROD.drop.address, lk, 1, exp, 0n, 0n, parseEther('0.1')))])));
  if (deployed) {
    const rd = await pub.readContract({ address: VP, abi: ABI.vault, functionName: 'recoveryDigest', args: [SINK, keccak256(toHex(atk.publicKey)), dl] });
    const fsig = toHex(mldsa.sign(atk.secretKey, hexb(pqMessage(rd))));
    const signers = cfg.guardians.length ? cfg.guardians : [SINK, '0x000000000000000000000000000000000000bEEF'];
    attempts.E7 = await call('E7', 'proposeRecovery to the attacker with forged guardian signatures', PROD.router.address, viaRouter(v('proposeRecovery', [SINK, keccak256(toHex(atk.publicKey)), dl, signers, signers.map(() => fsig)])));
    attempts.E8 = await call('E8', 'executeQueued(1) early / vetoQueued(1)', PROD.router.address, viaRouter(v('vetoQueued', [1n, dl, signAtk(ACT.VETO_QUEUED, params.id(1))])));
  }
  if (bait.planned?.drop) {
    const id = BigInt(bait.planned.drop.linkId);
    const cd = await pub.readContract({ address: PROD.drop.address, abi: ABI.drop, functionName: 'claimDigest', args: [id, AV.evm, VP] });
    attempts.E9 = await call('E9', `claim drop p${id} with an attacker ML-DSA signature`, PROD.router.address, encodeFunctionData({ abi: ABI.router, functionName: 'relay', args: [PROD.drop.address, encodeFunctionData({ abi: ABI.drop, functionName: 'claim', args: [id, toHex(mldsa.sign(atk.secretKey, hexb(pqMessage(cd))))] })] }));
  }
  if (deployed) {
    const h = keccak256(toHex('q-day probe'));
    const r = await pub.readContract({ address: VP, abi: ABI.vault, functionName: 'isValidSignature', args: [h, await ecdsa.sign({ hash: h })] });
    push('E10', 'ERC-1271 isValidSignature with an ECDSA signature', 'evm (eth_call)', r === '0x1626ba7e' ? 'ACCEPTED' : 'refused', r);
  }
  const ks1 = await keyStatus(AV.evm);
  push('KEY', 'registered PQ key unchanged', 'read', ks1.keyHash === ks0.keyHash && ks0.keyHash === bait.ownerKeyHash ? 'unchanged' : 'CHANGED', ks1.keyHash);
  return { rows, attempts };
}

async function main() {
  let baits;
  try { const j = await (await fetch(`${API}/api/qday`)).json(); baits = j.baits; } catch { /* offline */ }
  if (!baits) baits = JSON.parse(fs.readFileSync(path.join(C4, 'deployments', 'qday-baits.json'), 'utf8')).baits;
  const only = opt('--bait'); const key = opt('--key');
  const all = [];
  for (const b of baits) {
    if (only && b.id !== only) continue;
    const k = only && key ? key : b.classicalKey;
    if (!k) { console.log(`${b.id}: classical key not published (pass --bait ${b.id} --key <hex>)`); continue; }
    const { rows, attempts } = await attackBait(b, k);
    all.push(...rows);
    const mine = opt('--mine');
    if (mine && mine.startsWith(b.id + ':')) {
      const a = attempts[mine.split(':')[1]];
      const r = await fetch(`${API}/api/qday`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ bait: b.id, to: a.to, data: a.data }) });
      console.log('mined through the relayer:', JSON.stringify(await r.json()));
    }
  }
  if (flag('--json')) console.log(JSON.stringify(all, null, 2));
  else for (const r of all) console.log(`${r.bait} ${r.id.padEnd(4)} ${r.outcome.padEnd(26)} ${r.path}  [${r.lane}] ${String(r.detail).slice(0, 110)}`);
  const broke = all.filter((r) => ['ACCEPTED', 'WOULD SUCCEED', 'CHANGED', 'WINDOW LIVE - EXPOSED'].includes(r.outcome));
  console.log(broke.length ? `\nBREACH SIGNALS: ${broke.length}` : `\n${all.length} attempts, 0 succeeded.`);
  return broke.length;
}
if (import.meta.url === `file://${process.argv[1]}`) process.exitCode = (await main()) ? 2 : 0;

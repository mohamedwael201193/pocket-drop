// QoreSeal / ML-KEM-1024 key of the Pocket Drop deployer account (Diana testnet only). Never prints keys.
//   node tools/qoreseal-key.mjs register   publish the ML-KEM-1024 key on chain (MsgRegisterKEMKey, hybrid-signed)
//   node tools/qoreseal-key.mjs check      read the key back from the chain, seal a note to it, open it, and refuse a wrong key;
//                                          writes frontend/evidence/v4/qoreseal/deployer-kem.json
// The KEM seed is derived, one-way and domain-separated, from the deployer's ML-DSA-87 secret:
//   seed = sha256("pocketdrop/qoreseal/v1" | pqcSecret). Keys: env DEPLOYER_SECP_KEY + DEPLOYER_PQC_SECRET, or the
//   operator file DEPLOYER_SECRET_FILE (default ../../QORE/.secrets/pocketdrop-deployer.json, field "deployer").
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { StargateClient } from '@cosmjs/stargate';
import { EthNativeSigner, getNetwork, unifiedAccountFromSeed, msg as sdkMsg, KEM_ALGORITHM_ML_KEM_1024 } from '@qorechain/sdk';
import { describeKemRegistryError, generateSealKeys, isQoreSealError, open, seal, sealKeysFromSeed, envelopeToText, validateMlkemPublicKey, MSG_REGISTER_KEM_KEY_TYPE_URL } from '@qorechain/qoreseal';
import { fetchKemKey, fetchMlkemPublicKey } from '@qorechain/qoreseal/network';

const net = getNetwork('testnet');
if (net.chainId !== 'qorechain-diana') throw new Error('testnet only');
const REST = net.endpoints.rest;
const here = path.dirname(fileURLToPath(import.meta.url));
const unhex = (s) => Uint8Array.from(Buffer.from(s.trim().replace(/^0x/, ''), 'hex'));
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

function secrets() {
  if (process.env.DEPLOYER_SECP_KEY && process.env.DEPLOYER_PQC_SECRET) return { secp: process.env.DEPLOYER_SECP_KEY, pq: process.env.DEPLOYER_PQC_SECRET };
  const f = process.env.DEPLOYER_SECRET_FILE ?? path.resolve(here, '..', '..', '..', 'QORE', '.secrets', 'pocketdrop-deployer.json');
  const j = JSON.parse(fs.readFileSync(f, 'utf8')).deployer;
  return { secp: j.secp256k1PrivateKey, pq: j.pqcSecret };
}
const s = secrets();
const acc = await unifiedAccountFromSeed(unhex(s.secp), { pqcSecret: unhex(s.pq) });
const seed = crypto.createHash('sha256').update(Buffer.concat([Buffer.from('pocketdrop/qoreseal/v1'), Buffer.from(unhex(s.pq))])).digest();
const keys = sealKeysFromSeed(Uint8Array.from(seed));
validateMlkemPublicKey(keys.mlkemPublicKey);
const keySha = sha(keys.mlkemPublicKey);
const cmd = process.argv[2];

if (cmd === 'register') {
  const st = await fetchKemKey({ rest: REST, address: acc.cosmos });
  if (st.registered && st.publicKey && sha(st.publicKey) === keySha) { console.log(JSON.stringify({ step: 'register', skipped: 'same key already registered', account: acc.cosmos, keySha256: keySha })); process.exit(0); }
  // The SDK's registry form of the same MsgRegisterKEMKey { sender, algorithm_id: 2, public_key } that QoreSeal's
  // buildRegisterKemKeyMessage encodes (EthNativeSigner encodes through its registry, so it takes the object form).
  const msg = sdkMsg.pqc.registerKemKey({ sender: acc.cosmos, algorithmId: KEM_ALGORITHM_ML_KEM_1024, publicKey: keys.mlkemPublicKey });
  const a = await (await fetch(`${REST}/cosmos/auth/v1beta1/accounts/${acc.cosmos}`)).json();
  const ba = a.account?.base_account ?? a.account ?? {};
  const c = await StargateClient.connect(net.endpoints.rpc);
  let r;
  try {
    r = await new EthNativeSigner(acc, { signMode: 'hybrid', rest: REST }).signAndBroadcast(c, {
      chainId: net.chainId, accountNumber: BigInt(ba.account_number), sequence: BigInt(ba.sequence),
      fee: { amount: [{ denom: 'uqor', amount: '105000' }], gas: '700000' }, messages: [msg], memo: 'pd qoreseal key',
    });
  } catch (e) {
    console.log(JSON.stringify({ step: 'register', error: String(e?.message ?? e), explain: e?.codespace ? describeKemRegistryError(e.codespace, e.code) : undefined })); process.exit(1);
  } finally { c.disconnect(); }
  console.log(JSON.stringify({ step: 'register', account: acc.cosmos, type: MSG_REGISTER_KEM_KEY_TYPE_URL, code: r.code, tx: r.transactionHash, keySha256: keySha }));
  process.exit(r.code === 0 ? 0 : 1);
}

if (cmd === 'check') {
  const onChain = await fetchMlkemPublicKey({ rest: REST, address: acc.cosmos });
  const st = await fetchKemKey({ rest: REST, address: acc.cosmos });
  const matches = sha(onChain) === keySha;
  const purpose = 'pocketdrop-note';
  const note = new TextEncoder().encode('Pocket Drop sealed note test: only the account that owns this ML-KEM-1024 key can read this.');
  const envelope = seal({ chainId: net.chainId, purpose, recipients: [{ mlkemPublicKey: onChain }], plaintext: note, mode: 'mlkem' });
  const opened = new TextDecoder().decode(open({ chainId: net.chainId, purpose, envelope, keys }));
  let wrongKey = 'opened (BAD)';
  try { open({ chainId: net.chainId, purpose, envelope, keys: generateSealKeys() }); } catch (e) { wrongKey = isQoreSealError(e) ? `refused: ${e.code}` : `refused: ${e?.message}`; }
  let wrongPurpose = 'opened (BAD)';
  try { open({ chainId: net.chainId, purpose: 'other', envelope, keys }); } catch (e) { wrongPurpose = isQoreSealError(e) ? `refused: ${e.code}` : `refused: ${e?.message}`; }
  const out = {
    label: 'LIVE', network: 'Diana testnet (qorechain-diana)', checkedAt: new Date().toISOString(), account: acc.cosmos, role: 'deployer (listed on the project page)',
    registry: { registered: st.registered, algorithm: st.algorithmName ?? st.algorithmId, registeredHeight: st.registeredHeight?.toString(), publicKeyBytes: onChain.length, publicKeySha256: sha(onChain), matchesDerivedKey: matches },
    sealTest: { mode: 'mlkem (ML-KEM-1024 only)', purpose, envelopeBytes: envelope.length, envelopeSha256: sha(envelope), envelopeTextPrefix: envelopeToText(envelope).slice(0, 24), openedWithOwnKey: opened === new TextDecoder().decode(note), wrongKey, wrongPurpose },
    registerTx: process.env.REGISTER_TX ?? null,
  };
  const dir = path.resolve(here, '..', 'frontend', 'evidence', 'v4', 'qoreseal');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'deployer-kem.json'), JSON.stringify(out, null, 2) + '\n');
  console.log(JSON.stringify(out));
  process.exit(matches && out.sealTest.openedWithOwnKey && wrongKey.startsWith('refused') && wrongPurpose.startsWith('refused') ? 0 : 1);
}
console.log('usage: node tools/qoreseal-key.mjs register|check');

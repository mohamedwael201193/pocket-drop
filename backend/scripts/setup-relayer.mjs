// One-time operator script (testnet). Creates the relayer account (secp + ML-DSA-87 seeds -> .secrets/),
// funds it from the main test wallet (.env seed=), registers its PQ key with proof of possession.
// Idempotent. Prints addresses and tx hashes only. Usage: node scripts/setup-relayer.mjs [fundQOR=5]
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { bank, deriveUnifiedAccount, unifiedAccountFromSeed, buildRegisterPqcKeyMsg, signProofOfPossession } from '@qorechain/sdk';
import { SECRET_FILE, ROOT, EXPL, net, hex, loadRelayer, bankUqor, cosmosTx } from './common.mjs';

const fundQor = Number(process.argv[2] ?? 5);
if (!fs.existsSync(SECRET_FILE)) {
  fs.mkdirSync(path.dirname(SECRET_FILE), { recursive: true });
  const seed = crypto.randomBytes(32), pqcSecret = crypto.randomBytes(32);
  const acc = await unifiedAccountFromSeed(Uint8Array.from(seed), { pqcSecret: Uint8Array.from(pqcSecret) });
  fs.writeFileSync(SECRET_FILE, JSON.stringify({
    note: 'PocketDrop RELAYER, testnet only (QoreChain Diana). secp key goes to Vercel env RELAYER_SECP_KEY; ML-DSA key stays local.',
    secp256k1PrivateKey: '0x' + hex(seed), pqcSecret: hex(pqcSecret),
    mldsa87PublicKeyHex: hex(acc.pqc.publicKey), mldsa87SecretKeyHex: hex(acc.pqc.secretKey),
    evm: acc.evm, cosmos: acc.cosmos, createdAt: new Date().toISOString(),
    derivation: 'unifiedAccountFromSeed(seed32, {pqcSecret})',
  }, null, 1));
}
const relayer = await loadRelayer();
console.log('relayer evm  ', relayer.evm);
console.log('relayer qor1 ', relayer.cosmos);

let bal = await bankUqor(relayer.cosmos);
if (bal < BigInt(Math.round(fundQor * 1e6)) / 2n) {
  const env = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
  const m = env.match(/^\s*seed\s*=\s*["']?([^"'\r\n]+?)["']?\s*$/mi);
  const main = await deriveUnifiedAccount(m[1].trim().split(/\s+/).join(' '), 0);
  const msg = bank.send({ fromAddress: main.cosmos, toAddress: relayer.cosmos, amount: [{ denom: 'uqor', amount: String(Math.round(fundQor * 1e6)) }] });
  const r = await cosmosTx(main, 'hybrid', [msg]);
  console.log('FUND tx', r.transactionHash, EXPL + r.transactionHash, 'code', r.code);
  bal = await bankUqor(relayer.cosmos);
}
console.log('relayer balance uqor', String(bal));

const st = await (await fetch(`${net.endpoints.rest}/qorechain/pqc/v1/account/${relayer.cosmos}`)).text().catch(() => '');
const pop = signProofOfPossession({ chainId: net.chainId, account: relayer.cosmos, keypair: relayer.pqc });
const reg = buildRegisterPqcKeyMsg(relayer.cosmos, { pqcKeypair: relayer.pqc, ecdsaPubkey: Uint8Array.from(Buffer.from(relayer.publicKey.slice(2), 'hex')), proofOfPossession: pop });
try {
  const r = await cosmosTx(relayer, 'classical', [reg]);
  console.log('REGISTER-PQ-WITH-POP tx', r.transactionHash, EXPL + r.transactionHash, 'code', r.code);
} catch (e) { console.log('register skipped/failed:', String(e.message).slice(0, 200)); }

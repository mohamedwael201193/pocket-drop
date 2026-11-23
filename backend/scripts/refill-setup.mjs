// One-time operator setup of the relayer refill wallet (Diana testnet only). Never prints keys.
//   node scripts/refill-setup.mjs fund <fromSecretFile> <amountQOR>   hybrid MsgSend from a team wallet to the refill wallet
//   node scripts/refill-setup.mjs register                            register the refill wallet's ML-DSA-87 key with proof of possession
// The refill wallet's keys are read from REFILL_SECRET_FILE (default ../../QORE/.secrets/pd-refill.json from the repo root's parent).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unifiedAccountFromSeed, bank, buildRegisterPqcKeyMsg, signProofOfPossession } from '@qorechain/sdk';
import { EXPL, net, cosmosTx, bankUqor, unhex } from './common.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const refillFile = process.env.REFILL_SECRET_FILE ?? path.resolve(here, '..', '..', '..', '..', 'QORE', '.secrets', 'pd-refill.json');
const load = (f) => { const j = JSON.parse(fs.readFileSync(f, 'utf8')); return unifiedAccountFromSeed(unhex(j.secp256k1PrivateKey), { pqcSecret: unhex(j.pqcSecret) }); };
const [cmd, a1, a2] = process.argv.slice(2);
const refill = await load(refillFile);
if (cmd === 'fund') {
  const from = await load(a1);
  const uqor = BigInt(Math.round(Number(a2) * 1e6));
  if (uqor <= 0n || uqor > 5_000_000n) throw new Error('amount must be 0 < x <= 5 QOR');
  const r = await cosmosTx(from, 'hybrid', [bank.send({ fromAddress: from.cosmos, toAddress: refill.cosmos, amount: [{ denom: 'uqor', amount: uqor.toString() }] })], { gas: '400000', fee: '60000' });
  console.log(JSON.stringify({ step: 'fund', from: from.cosmos, to: refill.cosmos, amountQor: a2, code: r.code, tx: r.transactionHash, explorer: EXPL + r.transactionHash }));
} else if (cmd === 'register') {
  const pop = signProofOfPossession({ chainId: net.chainId, account: refill.cosmos, keypair: refill.pqc });
  const msg = buildRegisterPqcKeyMsg(refill.cosmos, { pqcKeypair: refill.pqc, ecdsaPubkey: unhex(refill.publicKey), proofOfPossession: pop });
  const r = await cosmosTx(refill, 'classical', [msg], { gas: '400000', fee: '60000' });
  console.log(JSON.stringify({ step: 'register', account: refill.cosmos, code: r.code, tx: r.transactionHash, explorer: EXPL + r.transactionHash }));
} else {
  console.log(JSON.stringify({ refill: refill.cosmos, evm: refill.evm, balanceUqor: (await bankUqor(refill.cosmos)).toString() }));
}

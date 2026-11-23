// Relayer auto-refill job (Diana testnet only). Run by .github/workflows/refill-relayer.yml every 3 hours, or by hand:
//   npx esbuild scripts/refill-relayer.ts --bundle --platform=node --format=esm --packages=external --outfile=/tmp/refill.mjs
//   node /tmp/refill.mjs [--dry-run] [--force-qor 0.2]
// Keys: env REFILL_SECP_KEY + REFILL_PQC_SECRET (GitHub Actions secrets), or a local file REFILL_SECRET_FILE
// (default ../../QORE/.secrets/pd-refill.json). Keys are never printed. Every send is a hybrid-signed MsgSend
// (secp256k1 + ML-DSA-87) with memo "pd refill <reason>"; the chain refuses classical-only sends from this account.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StargateClient } from '@cosmjs/stargate';
import { EthNativeSigner, getNetwork, unifiedAccountFromSeed, bank } from '@qorechain/sdk';
import { DEFAULT_RULES, REFILL_MEMO_PREFIX, UQOR_PER_QOR, fetchRefills, fmt, planRefill, sumLast24h } from '../src/refill.js';

const RELAYER_QOR = process.env.RELAYER_COSMOS_ADDRESS ?? 'qor17mn0ktfnhmesgd5zvk8zk60n5tuxzmxdc8ymnl';
const net = getNetwork('testnet');
if (net.chainId !== 'qorechain-diana') throw new Error('testnet only');
const REST = net.endpoints.rest;
const EXPL = 'https://explore.qore.network/tx/';
const argv = process.argv.slice(2);
const dry = argv.includes('--dry-run');
const fi = argv.indexOf('--force-qor');
const force = fi >= 0 ? BigInt(Math.round(Number(argv[fi + 1]) * 1e6)) : null;
const unhex = (s: string) => Uint8Array.from(Buffer.from(s.trim().replace(/^0x/, ''), 'hex'));
const out = (o: Record<string, unknown>) => console.log(JSON.stringify({ at: new Date().toISOString(), ...o }));

async function loadFunder() {
  let secp = process.env.REFILL_SECP_KEY, pq = process.env.REFILL_PQC_SECRET;
  if (!secp || !pq) {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const f = process.env.REFILL_SECRET_FILE ?? path.resolve(here, '..', '..', '..', '..', 'QORE', '.secrets', 'pd-refill.json');
    if (!fs.existsSync(f)) throw new Error('no refill keys: set REFILL_SECP_KEY and REFILL_PQC_SECRET');
    const j = JSON.parse(fs.readFileSync(f, 'utf8')); secp = j.secp256k1PrivateKey; pq = j.pqcSecret;
  }
  return unifiedAccountFromSeed(unhex(secp!), { pqcSecret: unhex(pq!) });
}
async function bankUqor(addr: string) {
  const j = (await (await fetch(`${REST}/cosmos/bank/v1beta1/balances/${addr}`)).json()) as { balances?: { denom: string; amount: string }[] };
  return BigInt(j.balances?.find((b) => b.denom === 'uqor')?.amount ?? '0');
}
async function seqOf(addr: string) {
  const j = (await (await fetch(`${REST}/cosmos/auth/v1beta1/accounts/${addr}`)).json()) as any;
  const a = j.account?.base_account ?? j.account ?? {};
  return { accountNumber: BigInt(a.account_number ?? 0), sequence: BigInt(a.sequence ?? 0) };
}

const funder = await loadFunder();
const [relayerUqor, funderUqor, rows] = await Promise.all([bankUqor(RELAYER_QOR), bankUqor(funder.cosmos), fetchRefills(REST, funder.cosmos, RELAYER_QOR)]);
const sent24 = sumLast24h(rows, Date.now());
const plan = planRefill({ relayerUqor, funderUqor, sentLast24hUqor: sent24, force }, DEFAULT_RULES);
out({ step: 'read', relayer: RELAYER_QOR, relayerQor: fmt(relayerUqor), funder: funder.cosmos, funderQor: fmt(funderUqor), sentLast24hQor: fmt(sent24), dailyCapQor: fmt(DEFAULT_RULES.dailyCapUqor), plan: { ...plan, amountUqor: plan.action === 'send' ? plan.amountUqor.toString() : undefined } });
if (plan.action === 'skip' || dry) process.exit(plan.action === 'skip' && plan.reason === 'funder-empty' ? 3 : 0);

const memo = `${REFILL_MEMO_PREFIX} ${force ? 'manual' : 'low'} ${fmt(relayerUqor)}`;
const msg = bank.send({ fromAddress: funder.cosmos, toAddress: RELAYER_QOR, amount: [{ denom: 'uqor', amount: plan.amountUqor.toString() }] });
const s = await seqOf(funder.cosmos);
const signer = new EthNativeSigner(funder, { signMode: 'hybrid', rest: REST });
const c = await StargateClient.connect(net.endpoints.rpc);
let r;
try {
  r = await signer.signAndBroadcast(c, { chainId: net.chainId, accountNumber: s.accountNumber, sequence: s.sequence, fee: { amount: [{ denom: 'uqor', amount: '60000' }], gas: '400000' }, messages: [msg], memo } as any);
} finally { c.disconnect(); }
out({ step: 'sent', tx: r.transactionHash, code: r.code, amountQor: fmt(plan.amountUqor), memo, explorer: EXPL + r.transactionHash });
if (r.code !== 0) process.exit(1);
const after = await bankUqor(RELAYER_QOR);
out({ step: 'after', relayerQor: fmt(after), unit: 'QOR', perQor: UQOR_PER_QOR.toString() });

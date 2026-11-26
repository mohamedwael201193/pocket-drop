// Ops top-up: move test QOR from the main test wallet to our own operations wallets (refill funder, sponsor,
// relayer) so the live app keeps running through judging. Diana TESTNET ONLY; QOR here has no monetary value.
// Recipients are fixed to the addresses recorded in HANDOFF.md / backend config; nothing else can be paid.
// Secrets are read by lib.mjs and never printed. Writes frontend/evidence/v4/refill/topup-<date>.json.
// usage: QORE_ENV_FILE=... node contracts-v4/script/topup-ops.mjs [--dry]
import fs from 'node:fs';
import path from 'node:path';
import { loadMain, fundFromMain, bankUqor, REST, ROOT, sleep } from './lib.mjs';

const MAIN_EVM = '0x8ab5ce4fcd45cc69fee31ea6e9e6222c1e18bbdd';
const PLAN = [
  { role: 'refill funder', cosmos: 'qor17ur48yaln4f2pemfzzh9j028uame2kgvhqfg2r', evm: '0xf7075393Bf9D52a0E76910Ae593d47e77795590c', uqor: 40_000_000 },
  { role: 'sponsor', cosmos: 'qor1rcew9w8qf4y2twytmcna05g89gas4q3p429uwh', evm: '0x1e32e2B8e04d48a5b88bdE27d7D1072A3B0A8221', uqor: 30_000_000 },
  { role: 'relayer', cosmos: 'qor17mn0ktfnhmesgd5zvk8zk60n5tuxzmxdc8ymnl', evm: '0xF6e6fb2d33Bef3043682658E2b69F3a2F8616cCD', uqor: 6_000_000 },
];
const CAP_UQOR = 100_000_000; // never more than 100 QOR per run
const dry = process.argv.includes('--dry');
const total = PLAN.reduce((s, p) => s + p.uqor, 0);
if (total > CAP_UQOR) throw new Error('plan exceeds cap');

const main = await loadMain();
if (main.evm.toLowerCase() !== MAIN_EVM) throw new Error('main wallet mismatch');
const q = (u) => (Number(u) / 1e6).toFixed(6);
const before = await bankUqor(main.cosmos);
console.log(`main ${main.cosmos} balance ${q(before)} QOR; plan ${q(total)} QOR`);
if (before < BigInt(total + 2_000_000)) throw new Error('main balance too low');

const rows = [];
for (const p of PLAN) {
  const b0 = await bankUqor(p.cosmos);
  if (dry) { console.log(`[dry] ${p.role} ${p.cosmos} ${q(b0)} -> +${q(p.uqor)}`); continue; }
  const hash = await fundFromMain(main, p.cosmos, p.uqor);
  let tx = null;
  for (let i = 0; i < 20 && !tx; i++) {
    await sleep(3000);
    const r = await fetch(`${REST}/cosmos/tx/v1beta1/txs/${hash}`);
    if (r.ok) tx = (await r.json()).tx_response;
  }
  if (!tx || tx.code !== 0) throw new Error(`${p.role}: tx ${hash} not confirmed with code 0`);
  const b1 = await bankUqor(p.cosmos);
  const row = { role: p.role, to: p.cosmos, toEvm: p.evm, amountQor: q(p.uqor), tx: hash, height: Number(tx.height), time: tx.timestamp, code: tx.code, balanceBeforeQor: q(b0), balanceAfterQor: q(b1) };
  console.log(JSON.stringify(row));
  rows.push(row);
}
if (!dry) {
  const after = await bankUqor(main.cosmos);
  const out = { label: 'RECORDED, TEAM-RUN internal top-up between own wallets (Diana testnet, no monetary value)', script: 'contracts-v4/script/topup-ops.mjs', from: main.cosmos, fromEvm: MAIN_EVM, mainBeforeQor: q(before), mainAfterQor: q(after), rows };
  const f = path.join(ROOT, '..', 'frontend', 'evidence', 'v4', 'refill', `topup-${new Date().toISOString().slice(0, 10)}.json`);
  fs.writeFileSync(f, JSON.stringify(out, null, 1) + '\n');
  console.log('wrote', path.relative(path.join(ROOT, '..'), f));
}

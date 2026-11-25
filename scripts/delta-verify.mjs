// Read-only re-check of a recorded measured-delta run (frontend/evidence/v4/e2e/delta-run-*.json) against Diana.
//   node scripts/delta-verify.mjs [file]     (Node 20+, no npm install, no keys)
// Path A: every recorded tx (create, bind, PoP registration, claim, first spend) is on chain with code 0 / status 1, the
//   recipient Pocket has code (it was deployed by its own first spend), and the account's key is registered with PoP.
// Path B: the direct transfer is on chain with code 0, no spend attempt was accepted, the account still holds the amount,
//   and it still has no registered ML-DSA-87 key (LIVE).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(repo, 'frontend', 'evidence', 'v4', 'e2e');
const file = process.argv[2] ?? path.join(dir, fs.readdirSync(dir).filter((f) => /^delta-run-.*\.json$/.test(f)).sort().pop());
const J = JSON.parse(fs.readFileSync(file, 'utf8'));
const RPC = process.env.EVM_RPC_URL ?? 'https://evm-testnet.qore.host';
const REST = process.env.REST_URL ?? 'https://api-testnet.qore.host';
let pass = 0, fail = 0;
const check = (ok, msg) => { if (ok) pass++; else fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function rpc(method, params) {
  for (let i = 0; ; i++) {
    try { const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }); const j = await r.json(); if (j.error) throw new Error(j.error.message); return j.result; }
    catch (e) { if (i >= 3) throw e; await sleep(800 * (i + 1)); }
  }
}
async function txOk(hash) {
  if (/^0x/.test(hash)) { const rc = await rpc('eth_getTransactionReceipt', [hash]); return { ok: rc?.status === '0x1', what: `status ${rc?.status ?? 'missing'}` }; }
  const r = await fetch(`${REST}/cosmos/tx/v1beta1/txs/${hash}`, { headers: { 'user-agent': 'curl/8' } });
  const t = (await r.json().catch(() => ({}))).tx_response;
  return { ok: t?.code === 0, what: `code ${t?.code ?? 'missing'}` };
}
const keyStatus = async (a) => { const d = await rpc('eth_call', [{ to: '0x0000000000000000000000000000000000000a02', data: '0x850dfe51' + a.slice(2).toLowerCase().padStart(64, '0') }, 'latest']); return { registered: BigInt('0x' + d.slice(2, 66)) === 1n, proven: BigInt('0x' + d.slice(194, 258)) === 1n }; };
const balance = async (a) => BigInt(await rpc('eth_getBalance', [a, 'latest']));

console.log(`measured-delta run ${path.basename(file)} (${J.note})\n`);
for (const r of J.pathA) {
  for (const [k, h] of Object.entries(r.txs)) { const t = await txOk(h); check(t.ok, `${r.id} ${k} ${h.slice(0, 14)}… ${t.what}`); }
  const code = await rpc('eth_getCode', [r.pocket, 'latest']);
  const ks = await keyStatus(r.account);
  check(r.spent === true && code !== '0x' && ks.registered && ks.proven, `${r.id} ${r.account.slice(0, 10)}… Pocket deployed by its own first spend, key registered with PoP (LIVE), ${r.secondsToFirstSpend}s from opening the link to the spend (RECORDED)`);
}
const amtWei = BigInt(Math.round(Number(J.amountQor) * 1e6)) * 10n ** 12n;
for (const r of J.pathB) {
  const t = await txOk(r.txs.directSend); check(t.ok, `${r.id} direct transfer ${r.txs.directSend.slice(0, 14)}… ${t.what}`);
  check(r.attempts.length > 0 && r.attempts.every((a) => !(a.accepted && (a.status === 'success' || a.code === 0))), `${r.id} spend attempts refused: ${r.attempts.map((a) => `${a.kind}: ${a.error ?? a.status ?? a.code}`).join(' | ').slice(0, 200)}`);
  const [bal, ks] = await Promise.all([balance(r.account), keyStatus(r.account)]);
  check(bal >= amtWei && !ks.registered, `${r.id} ${r.account.slice(0, 10)}… still holds ${Number(bal) / 1e18} QOR and has no registered ML-DSA-87 key (LIVE)`);
}
console.log(`\n${J.summary?.pathA ?? ''}; ${J.summary?.pathB ?? ''}.\n${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);

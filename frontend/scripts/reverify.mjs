// Re-verify the Pocket Drop v4 deployment and its recorded live results against the chain. Testnet only, read-only, no keys.
//   node frontend/scripts/reverify.mjs      (Node 20+, no npm install: keccak256 and the JSON-RPC calls are inline below)
// Checks:
//   1. every recorded v4 contract has code on Diana and its keccak256 equals the recorded runtime keccak
//   2. PocketRouter points at the recorded factory / drop / pool; the factory at the vault implementation
//   3. the timelock constants on the vault implementation equal the recorded values
//   4. every recorded live EVM transaction is mined with the status we claim (success / reverted)
//   5. Q-Day drill: each bait Pocket is still owned by its key account, its registered ML-DSA-87 key is the one it pins
//      (keccak256 of the 0x0A02 pubkey == ownerKeyHash), it still holds its QOR, and every setup tx is mined as recorded
//   6. Q-Day attack attempts (committed snapshot + the live /api/qday log): every mined attempt reverted, alarm not raised
//   7. persona campaign, sponsored onboarding runs and the spend ledger: every EVM hash mined with status 1
//   8. every Cosmos tx hash in the evidence (registrations, funding, sponsor sends) has code 0 via the Cosmos REST API
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, '..', '..');
const readJson = (...p) => JSON.parse(fs.readFileSync(path.join(repo, ...p), 'utf8'));
const v4 = readJson('frontend', 'src', 'data', 'v4.json');
const RPC = process.env.EVM_RPC_URL ?? 'https://evm-testnet.qore.host';
const REST = process.env.REST_URL ?? 'https://api-testnet.qore.host';
const API = process.env.PD_API_URL ?? 'https://pocketdrop-api.vercel.app';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function retry(fn, tries = 4) { for (let i = 1; ; i++) { try { return await fn(); } catch (e) { if (i >= tries) throw e; await sleep(600 * i); } } }

// ---- Keccak-256 (original Keccak padding 0x01, as used by Ethereum), 64-bit lanes as BigInt ----
const M64 = (1n << 64n) - 1n;
const RC = []; { let r = 1n; for (let i = 0; i < 24; i++) { let c = 0n; for (let j = 0; j < 7; j++) { r = ((r << 1n) ^ ((r >> 7n) * 0x71n)) & 0xffn; if (r & 2n) c ^= 1n << ((1n << BigInt(j)) - 1n); } RC.push(c); } }
const ROT = [0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14];
const rotl = (x, n) => (n === 0 ? x : ((x << BigInt(n)) | (x >> BigInt(64 - n))) & M64);
function keccakF(s) {
  for (let round = 0; round < 24; round++) {
    const C = [0, 1, 2, 3, 4].map((x) => s[x] ^ s[x + 5] ^ s[x + 10] ^ s[x + 15] ^ s[x + 20]);
    for (let x = 0; x < 5; x++) { const d = C[(x + 4) % 5] ^ rotl(C[(x + 1) % 5], 1); for (let y = 0; y < 25; y += 5) s[x + y] ^= d; }
    const B = new Array(25);
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) B[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(s[x + 5 * y], ROT[x + 5 * y]);
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) s[x + 5 * y] = B[x + 5 * y] ^ (~B[((x + 1) % 5) + 5 * y] & M64 & B[((x + 2) % 5) + 5 * y]);
    s[0] ^= RC[round];
  }
}
export function keccak256(bytes) {
  const rate = 136; const padded = new Uint8Array(Math.ceil((bytes.length + 1) / rate) * rate);
  padded.set(bytes); padded[bytes.length] ^= 0x01; padded[padded.length - 1] ^= 0x80;
  const s = new Array(25).fill(0n);
  for (let off = 0; off < padded.length; off += rate) {
    for (let i = 0; i < rate / 8; i++) { let v = 0n; for (let b = 7; b >= 0; b--) v = (v << 8n) | BigInt(padded[off + i * 8 + b]); s[i] ^= v; }
    keccakF(s);
  }
  let out = '0x'; for (let i = 0; i < 4; i++) for (let b = 0; b < 8; b++) out += Number((s[i] >> BigInt(8 * b)) & 0xffn).toString(16).padStart(2, '0');
  return out;
}
const hexToBytes = (h) => Uint8Array.from((h.slice(2).match(/../g) ?? []).map((b) => parseInt(b, 16)));
const selector = (sig) => keccak256(new TextEncoder().encode(sig)).slice(0, 10);

// ---- minimal JSON-RPC ----
let rid = 0;
const rpc = (method, params) => retry(() => rpc1(method, params));
async function rpc1(method, params) {
  const res = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'curl/8' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rid, method, params }) });
  if (!res.ok) throw new Error(`${method}: HTTP ${res.status}`);
  const j = await res.json(); if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result;
}
const call = (to, sig) => rpc('eth_call', [{ to, data: selector(sig) }, 'latest']);
const asAddress = (word) => '0x' + word.slice(-40);
const asUint = (word) => BigInt(word).toString();

if (Number(await rpc('eth_chainId', [])) !== 9800) throw new Error('not Diana (chain id 9800)');
// self-test of the inline keccak against two known vectors
if (keccak256(new Uint8Array()) !== '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470' || selector('transfer(address,uint256)') !== '0xa9059cbb') throw new Error('keccak self-test failed');

let pass = 0; let fail = 0;
const check = (ok, label) => { if (ok) pass++; else fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); };
const eq = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

for (const env of ['prod', 'lab']) {
  const i = v4.instances[env];
  for (const k of ['router', 'factory', 'vaultImpl', 'drop', 'pool']) {
    const code = await rpc('eth_getCode', [i[k].address, 'latest']);
    check(!!code && code !== '0x', `${env}.${k} has code at ${i[k].address}`);
    check(!!code && eq(keccak256(hexToBytes(code)), i[k].codeKeccak), `${env}.${k} runtime keccak256 equals the recorded ${i[k].codeKeccak.slice(0, 12)}…`);
  }
  for (const fn of ['factory', 'drop', 'pool']) {
    const got = asAddress(await call(i.router.address, `${fn}()`));
    check(eq(got, i[fn].address), `${env}.router.${fn}() == recorded ${fn}`);
  }
  const impl = asAddress(await call(i.factory.address, 'implementation()'));
  check(eq(impl, i.vaultImpl.address), `${env}.factory.implementation() == recorded vault implementation`);
  for (const fn of ['TIMELOCK', 'RECOVERY_DELAY', 'FREEZE_PERIOD', 'UNANIMOUS_RECOVERY_DELAY']) {
    const got = asUint(await call(i.vaultImpl.address, `${fn}()`));
    check(String(got) === String(i.readBack[fn]), `${env}.vault.${fn} == ${i.readBack[fn]} s`);
  }
}

// ---- 4. the v4 live suite ----
const seenHash = new Set();
let evmTxs = 0; let cosmosTxs = 0;
async function receiptCheck(hash, want, label) {
  evmTxs++; seenHash.add(hash.toLowerCase());
  try {
    const rc = await rpc('eth_getTransactionReceipt', [hash]);
    const st = rc && (rc.status === '0x1' ? 'success' : 'reverted');
    check(!!rc && st === want, `tx ${hash.slice(0, 12)}… is ${st ?? 'missing'} (recorded ${want}): ${label.slice(0, 70)}`);
  } catch { check(false, `tx ${hash.slice(0, 12)}… not found: ${label.slice(0, 70)}`); }
}
async function cosmosCheck(hash, label, height) {
  cosmosTxs++; seenHash.add(hash.toLowerCase());
  try {
    const j = await retry(async () => {
      const r = await fetch(`${REST}/cosmos/tx/v1beta1/txs/${hash}`, { headers: { 'user-agent': 'curl/8' } });
      if (r.status === 404 || r.status === 400) return null;
      if (!r.ok) throw new Error(`REST ${r.status}`);
      return r.json();
    });
    const t = j?.tx_response;
    const okH = height == null || String(t?.height) === String(height);
    check(!!t && t.code === 0 && okH, `cosmos ${hash.slice(0, 12)}… code ${t ? t.code : 'missing'}${height != null ? ` at height ${t?.height ?? '?'} (recorded ${height})` : ''}: ${label.slice(0, 70)}`);
  } catch (e) { check(false, `cosmos ${hash.slice(0, 12)}… not readable (${e.message}): ${label.slice(0, 70)}`); }
}
/** Run checks a few at a time so the public RPC is not hammered; output order stays the input order. */
async function inBatches(items, fn, size = 6) { for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(fn)); }
const isEvmHash = (h) => typeof h === 'string' && /^0x[0-9a-fA-F]{64}$/.test(h);
const isCosmosHash = (h) => typeof h === 'string' && /^[0-9A-Fa-f]{64}$/.test(h);
const section = (t) => console.log(`\n== ${t}`);
const tally = {};
const mark = (k, before) => { tally[k] = { evm: evmTxs - before.e, cosmos: cosmosTxs - before.c }; };
let b = { e: 0, c: 0 };

section('v4 live suite (src/data/v4.json)');
await inBatches(v4.liveRows.filter((r) => isEvmHash(r.hash) && (r.status === 'success' || r.status === 'reverted')), (r) => receiptCheck(r.hash, r.status, r.step));
await inBatches(v4.liveRows.filter((r) => isCosmosHash(r.hash)), (r) => cosmosCheck(r.hash, r.step));
mark('v4 suite', b);

// ---- 5. Q-Day drill baits ----
section('Q-Day drill baits (contracts-v4/deployments/qday-baits.json)');
b = { e: evmTxs, c: cosmosTxs };
const qd = readJson('contracts-v4', 'deployments', 'qday-baits.json');
const word = (d, n) => d.slice(2 + 64 * n, 2 + 64 * (n + 1));
const pad = (addr) => addr.toLowerCase().replace(/^0x/, '').padStart(64, '0');
for (const bt of qd.baits) {
  if (bt.deployed) {
    const owner = asAddress(await call(bt.pocket, 'owner()'));
    const pinned = await call(bt.pocket, 'ownerKeyHash()');
    check(eq(owner, bt.keyAccount), `${bt.id} Pocket ${bt.pocket.slice(0, 10)}… still owned by its key account ${bt.keyAccount.slice(0, 10)}…`);
    check(eq(pinned, bt.ownerKeyHash), `${bt.id} Pocket still pins the recorded ML-DSA-87 key hash ${bt.ownerKeyHash.slice(0, 12)}…`);
  } else {
    // counterfactual bait: funded at its predicted address, never deployed; deploying it needs the owner's PQ signature
    const code = await rpc('eth_getCode', [bt.pocket, 'latest']);
    check(code === '0x', `${bt.id} counterfactual Pocket ${bt.pocket.slice(0, 10)}… is still undeployed (no one has claimed the address)`);
  }
  const ks = await rpc('eth_call', [{ to: '0x0000000000000000000000000000000000000a02', data: selector('pqcKeyStatus(address)') + pad(bt.keyAccount) }, 'latest']);
  const registered = BigInt('0x' + word(ks, 0)) === 1n; const algo = Number(BigInt('0x' + word(ks, 1)));
  const off = Number(BigInt('0x' + word(ks, 2))) * 2; const len = Number(BigInt('0x' + ks.slice(2 + off, 2 + off + 64)));
  const pk = '0x' + ks.slice(2 + off + 64, 2 + off + 64 + len * 2);
  check(registered && len === 2592 && eq(keccak256(hexToBytes(pk)), bt.ownerKeyHash), `${bt.id} key account's registered PQ key (0x0A02, algo ${algo}, ${len} bytes) hashes to the pinned key: unchanged`);
  const bal = BigInt(await rpc('eth_getBalance', [bt.pocket, 'latest']));
  check(bal >= 200000000000000000n, `${bt.id} Pocket still holds ${Number(bal) / 1e18} QOR (funded 0.2): not drained`);
}
await inBatches(qd.txs.filter((t) => isEvmHash(t.hash)), (t) => receiptCheck(t.hash, t.status, `qday setup: ${t.step}`));
await inBatches(qd.txs.filter((t) => isCosmosHash(t.hash)), (t) => cosmosCheck(t.hash, `qday setup: ${t.step}`, t.height));
mark('Q-Day bait setup', b);

// ---- 6. Q-Day attack attempts ----
section('Q-Day attack attempts (contracts-v4/deployments/qday-attempts.json + live /api/qday)');
b = { e: evmTxs, c: cosmosTxs };
const attempts = new Map();
for (const a of readJson('contracts-v4', 'deployments', 'qday-attempts.json').attempts) attempts.set(a.tx.toLowerCase(), a);
let live = null;
try {
  live = await retry(async () => { const r = await fetch(`${API}/api/qday`); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }, 3);
} catch (e) { console.log(`note: live /api/qday not reachable (${e.message}); checking the committed snapshot only`); }
if (live) {
  check(live.alarm && live.alarm.raised === false, `live breach alarm reads no breach (${(live.alarm?.reasons ?? []).join('; ') || 'no reasons'})`);
  const rows = [...(live.log?.onChain?.rows ?? []), ...(live.log?.teamBot?.rows ?? [])].filter((r) => r.source !== 'team-setup');
  for (const r of rows) if (!attempts.has(r.tx.toLowerCase())) attempts.set(r.tx.toLowerCase(), { ...r, liveOnly: true });
}
await inBatches([...attempts.values()], (a) => receiptCheck(a.tx, 'reverted', `${a.source} attempt on ${a.bait}: ${a.call}${a.liveOnly ? ' (live log, newer than the snapshot)' : ''}`));
mark('Q-Day attack attempts', b);

// ---- 7/8. personas, sponsor runs, spend ledger ----
const ev = path.join(repo, 'frontend', 'evidence', 'v4');
const evidenceSets = [];
for (const f of fs.readdirSync(path.join(ev, 'e2e')).filter((f) => /^personas-.*\.json$/.test(f)).sort()) {
  const P = JSON.parse(fs.readFileSync(path.join(ev, 'e2e', f), 'utf8'));
  evidenceSets.push([`persona campaign (${f})`, P.personas.flatMap((p) => Object.entries(p.txs ?? {}).map(([k, h]) => [h, `P${p.id} ${k}`]))]);
}
for (const f of fs.readdirSync(path.join(ev, 'e2e')).filter((f) => /^sponsor-live-.*\.json$/.test(f)).sort()) {
  const S = JSON.parse(fs.readFileSync(path.join(ev, 'e2e', f), 'utf8'));
  evidenceSets.push([`sponsored onboarding run (${f})`, Object.entries(S.txs ?? {}).map(([k, h]) => [h, `sponsor run: ${k}`])]);
}
evidenceSets.push(['spend ledger (evidence/v4/spend.json)', JSON.parse(fs.readFileSync(path.join(ev, 'spend.json'), 'utf8')).entries.map((e) => [e.hash, `spend: ${e.note}`])]);
for (const [name, list] of evidenceSets) {
  section(name);
  b = { e: evmTxs, c: cosmosTxs };
  const fresh = list.filter(([h]) => (isEvmHash(h) || isCosmosHash(h)) && !seenHash.has(h.toLowerCase()) && (seenHash.add(h.toLowerCase()), true));
  await inBatches(fresh.filter(([h]) => isEvmHash(h)), ([h, l]) => receiptCheck(h, 'success', l));
  await inBatches(fresh.filter(([h]) => isCosmosHash(h)), ([h, l]) => cosmosCheck(h, l));
  console.log(`(${list.length - fresh.length} entries already checked above or not a tx hash)`);
  mark(name.split(' (')[0], b);
}

console.log('\nper source (unique hashes):');
for (const [k, v] of Object.entries(tally)) console.log(`  ${k.padEnd(28)} ${String(v.evm).padStart(4)} EVM  ${String(v.cosmos).padStart(3)} Cosmos`);
console.log(`\n${pass} passed, ${fail} failed. ${evmTxs} EVM transactions and ${cosmosTxs} Cosmos transactions checked against the chain.`);
process.exit(fail ? 1 : 0);

// Re-verify the Pocket Drop v4 deployment and its recorded live results against the chain. Testnet only, read-only, no keys.
//   node frontend/scripts/reverify.mjs      (Node 20+, no npm install: keccak256 and the JSON-RPC calls are inline below)
// Checks:
//   1. every recorded v4 contract has code on Diana and its keccak256 equals the recorded runtime keccak
//   2. PocketRouter points at the recorded factory / drop / pool; the factory at the vault implementation
//   3. the timelock constants on the vault implementation equal the recorded values
//   4. every recorded live EVM transaction is mined with the status we claim (success / reverted)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const v4 = JSON.parse(fs.readFileSync(path.join(here, '..', 'src', 'data', 'v4.json'), 'utf8'));
const RPC = process.env.EVM_RPC_URL ?? 'https://evm-testnet.qore.host';

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
async function rpc(method, params) {
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

let evmTxs = 0; let skipped = 0;
for (const r of v4.liveRows) {
  if (!r.hash) continue;
  if (!r.hash.startsWith('0x')) { skipped++; continue; } // Cosmos txs (registrations, funding) are not EVM receipts
  if (r.status !== 'success' && r.status !== 'reverted') continue;
  evmTxs++;
  try {
    const rc = await rpc('eth_getTransactionReceipt', [r.hash]);
    const st = rc && (rc.status === '0x1' ? 'success' : 'reverted');
    check(!!rc && st === r.status, `tx ${r.hash.slice(0, 12)}… is ${st ?? 'missing'} (recorded ${r.status}): ${r.step.slice(0, 70)}`);
  } catch { check(false, `tx ${r.hash.slice(0, 12)}… not found: ${r.step.slice(0, 70)}`); }
}
console.log(`\n${pass} passed, ${fail} failed. ${evmTxs} recorded EVM transactions checked, ${skipped} Cosmos transactions (registrations and funding) not checked here.`);
process.exit(fail ? 1 : 0);

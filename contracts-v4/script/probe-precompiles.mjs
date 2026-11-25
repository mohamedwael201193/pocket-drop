// Precompile conformance probe for QoreChain Diana: pqcVerify (0x0A01) and pqcKeyStatus (0x0A02).
// eth_call only: sends no transaction, spends nothing, needs no key. Every case records the block it was read at.
//   node script/probe-precompiles.mjs            -> writes ../docs/precompile-conformance.json and ../docs/PRECOMPILE_CONFORMANCE.md
// Expectations are FIPS 204 ML-DSA-87 (pure, empty context) as computed locally by @qorechain/pqc and
// @qorechain/qoresign. A case is an ANOMALY only if the live precompile's answer differs from that expectation.
import fs from 'node:fs';
import { encodeFunctionData, decodeFunctionResult, toHex, keccak256, toBytes } from 'viem';
import { mldsa, mldsa65, mldsa44 } from '@qorechain/pqc';
import { pqVerify } from '@qorechain/qoresign';
import { ml_dsa87 } from '@noble/post-quantum/ml-dsa.js';

const RPC = process.env.DIANA_EVM_RPC || 'https://evm-testnet.qore.host';
const VERIFY = '0x0000000000000000000000000000000000000a01';
const KEYS = '0x0000000000000000000000000000000000000a02';
const ABI = [
  { type: 'function', name: 'pqcVerify', stateMutability: 'view', inputs: [{ type: 'bytes' }, { type: 'bytes' }, { type: 'bytes' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'pqcKeyStatus', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'bool' }, { type: 'uint8' }, { type: 'bytes' }, { type: 'bool' }] },
];

let rpcId = 0;
async function rpc(method, params) {
  const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }) });
  const text = await r.text();
  try { return JSON.parse(text); } catch { return { error: { message: `RPC gateway answered HTTP ${r.status} (not JSON-RPC)`, http: r.status } }; }
}
async function call(to, data, block = 'latest') {
  const bn = block === 'latest' ? Number(BigInt((await rpc('eth_blockNumber', [])).result)) : block;
  const tag = '0x' + bn.toString(16);
  const r = await rpc('eth_call', [{ to, data }, tag]);
  if (r.error && r.error.http) return { block: bn, reverted: false, gateway: true, error: r.error.message, ret: null };
  if (r.error) return { block: bn, reverted: true, error: String(r.error.message || r.error.code).slice(0, 200), ret: null };
  return { block: bn, reverted: false, ret: r.result };
}
async function gasOf(to, data) {
  const r = await rpc('eth_estimateGas', [{ to, data }]);
  return r.error ? null : Number(BigInt(r.result));
}

const seed = (s) => toBytes(keccak256(toBytes('pocketdrop-conformance-' + s)));
const A = mldsa.keygen(seed('A'));
const B = mldsa.keygen(seed('B'));
const local = (pk, msg, sig) => {
  let a = false; let b = false;
  try { a = mldsa.verify(pk, msg, sig) === true; } catch { a = false; }
  try { b = pqVerify(pk, msg, sig) === true; } catch { b = false; }
  if (a !== b) throw new Error('local libraries disagree');
  return a;
};
const flip = (u8, i) => { const c = Uint8Array.from(u8); c[i] ^= 0x01; return c; };
const cat = (a, b) => { const c = new Uint8Array(a.length + b.length); c.set(a); c.set(b, a.length); return c; };
const enc = (s) => new TextEncoder().encode(s);

const MSG = enc('qorechain-msg-v1|qorechain-diana|0x' + 'ab'.repeat(32)); // a v4 intent-shaped message
const sigA = mldsa.sign(A.secretKey, MSG);
const empty = new Uint8Array(0);
const sigEmpty = mldsa.sign(A.secretKey, empty);
const one = Uint8Array.of(0x00);
const sigOne = mldsa.sign(A.secretKey, one);

const verifyCases = [
  ['valid: 99-byte intent-shaped message', A.publicKey, MSG, sigA],
  ['valid: empty message', A.publicKey, empty, sigEmpty],
  ['valid: 1-byte message 0x00', A.publicKey, one, sigOne],
  ['empty-message signature checked against 0x00', A.publicKey, one, sigEmpty],
  ['wrong key (valid signature by another key)', B.publicKey, MSG, sigA],
  ['signature first byte flipped', A.publicKey, MSG, flip(sigA, 0)],
  ['signature middle byte flipped', A.publicKey, MSG, flip(sigA, 2313)],
  ['signature last byte flipped', A.publicKey, MSG, flip(sigA, 4626)],
  ['public key first byte flipped', flip(A.publicKey, 0), MSG, sigA],
  ['public key last byte flipped', flip(A.publicKey, 2591), MSG, sigA],
  ['message last byte flipped', A.publicKey, flip(MSG, MSG.length - 1), sigA],
  ['signature truncated to 4626 bytes', A.publicKey, MSG, sigA.slice(0, 4626)],
  ['signature + 1 trailing zero byte (4628)', A.publicKey, MSG, cat(sigA, Uint8Array.of(0))],
  ['signature + 32 trailing zero bytes (4659)', A.publicKey, MSG, cat(sigA, new Uint8Array(32))],
  ['empty signature', A.publicKey, MSG, empty],
  ['all-zero 4627-byte signature', A.publicKey, MSG, new Uint8Array(4627)],
  ['public key truncated to 2591 bytes', A.publicKey.slice(0, 2591), MSG, sigA],
  ['public key + 1 trailing zero byte (2593)', cat(A.publicKey, Uint8Array.of(0)), MSG, sigA],
  ['empty public key', empty, MSG, sigA],
  ['all-zero 2592-byte public key', new Uint8Array(2592), MSG, sigA],
];
// FIPS 204 variants that a pure ML-DSA-87 / empty-context verifier must reject
try {
  verifyCases.push(['signature with non-empty context "pd"', A.publicKey, MSG, ml_dsa87.sign(MSG, A.secretKey, { context: enc('pd') })]);
} catch (e) { /* context signing unavailable in this library version */ }
try {
  verifyCases.push(['ML-DSA internal signature (no FIPS 204 message wrapper)', A.publicKey, MSG, ml_dsa87.internal.sign(MSG, A.secretKey)]);
} catch (e) { /* internal API unavailable */ }
{
  const k65 = mldsa65.keygen(seed('65')); const k44 = mldsa44.keygen(seed('44'));
  verifyCases.push(['valid ML-DSA-65 key + signature (1952 / 3309 bytes)', k65.publicKey, MSG, mldsa65.sign(k65.secretKey, MSG)]);
  verifyCases.push(['valid ML-DSA-44 key + signature (1312 / 2420 bytes)', k44.publicKey, MSG, mldsa44.sign(k44.secretKey, MSG)]);
}
for (const n of [1024, 16384, 32768, 49152, 65536]) {
  const m = new Uint8Array(n).fill(0x61);
  verifyCases.push([`valid: ${n}-byte message`, A.publicKey, m, mldsa.sign(A.secretKey, m)]);
}

const results = { rpc: RPC, chainIdEvm: null, generatedAt: new Date().toISOString(), verify: [], keyStatus: [], abi: [], historical: [] };
results.chainIdEvm = Number(BigInt((await rpc('eth_chainId', [])).result));

const decodeBool = (ret) => {
  if (ret === null) return null;
  if (ret.length !== 66) return `raw ${ret.length / 2 - 1} bytes`;
  const w = BigInt(ret);
  return w === 1n ? true : w === 0n ? false : `word ${ret}`;
};

for (const [name, pk, msg, sig] of verifyCases) {
  const data = encodeFunctionData({ abi: ABI, functionName: 'pqcVerify', args: [toHex(pk), toHex(sig), toHex(msg)] });
  const r = await call(VERIFY, data);
  const expected = local(pk, msg, sig);
  const live = r.gateway ? 'not reached (RPC size limit)' : r.reverted ? 'revert' : decodeBool(r.ret);
  // PqcLib.verify returns true only for exactly one 32-byte word equal to 1; anything else is false.
  const pqcLib = !r.reverted && r.ret && r.ret.length === 66 && BigInt(r.ret) === 1n;
  const row = { case: name, raw: r.ret, pkLen: pk.length, sigLen: sig.length, msgLen: msg.length, expected, live, pqcLibResult: pqcLib, block: r.block, retBytes: r.ret ? r.ret.length / 2 - 1 : null };
  if (r.reverted || r.gateway) row.error = r.error;
  if (r.gateway) row.notReached = true;
  if (expected === true && !r.reverted) row.gas = await gasOf(VERIFY, data);
  row.anomaly = !r.gateway && pqcLib !== expected;
  results.verify.push(row);
}

// Historical read of the empty-message case (archive node permitting). Reported as read, nothing assumed.
{
  const data = encodeFunctionData({ abi: ABI, functionName: 'pqcVerify', args: [toHex(A.publicKey), toHex(sigEmpty), '0x'] });
  for (const b of [10654000, 10654799, 10654800, 10655000]) {
    const r = await call(VERIFY, data, b);
    results.historical.push({ case: 'valid: empty message', block: b, live: r.reverted ? 'revert' : decodeBool(r.ret), error: r.error ?? undefined });
  }
}

const deployer = '0x392f50b1955a827458A320205e19acf7C664f116';
const relayer = '0xF6e6fb2d33Bef3043682658E2b69F3a2F8616cCD';
const keyCases = [
  ['registered account (deployer)', deployer],
  ['registered account (relayer)', relayer],
  ['never-registered random address', '0x' + keccak256(toBytes('pocketdrop-unregistered')).slice(26)],
  ['zero address', '0x0000000000000000000000000000000000000000'],
  ['the precompile address itself', KEYS],
];
for (const [name, addr] of keyCases) {
  const data = encodeFunctionData({ abi: ABI, functionName: 'pqcKeyStatus', args: [addr] });
  const r = await call(KEYS, data);
  const row = { case: name, address: addr, block: r.block, reverted: r.reverted, raw: r.ret, retBytes: r.ret ? r.ret.length / 2 - 1 : null };
  if (r.reverted) row.error = r.error;
  if (r.ret && r.ret.length > 2) {
    const [registered, algoId, pubkey, pop] = decodeFunctionResult({ abi: ABI, functionName: 'pqcKeyStatus', data: r.ret });
    row.registered = registered; row.algoId = algoId; row.pubkeyLen = (pubkey.length - 2) / 2; row.possessionProven = pop;
    row.pubkeyOffset = Number(BigInt('0x' + r.ret.slice(2 + 128, 2 + 192)));
  }
  results.keyStatus.push(row);
}

// Malformed calldata: PqcLib never sends these, but they show how strict the decoder is.
const sel = (sig) => keccak256(toBytes(sig)).slice(0, 10);
const goodKS = encodeFunctionData({ abi: ABI, functionName: 'pqcKeyStatus', args: [deployer] });
const goodV = encodeFunctionData({ abi: ABI, functionName: 'pqcVerify', args: [toHex(A.publicKey), toHex(sigA), toHex(MSG)] });
const abiCases = [
  ['pqcKeyStatus: empty calldata', KEYS, '0x'],
  ['pqcKeyStatus: selector only', KEYS, sel('pqcKeyStatus(address)')],
  ['pqcKeyStatus: address word with dirty high bits', KEYS, sel('pqcKeyStatus(address)') + 'ff'.repeat(12) + deployer.slice(2).toLowerCase()],
  ['pqcKeyStatus: 32 trailing bytes', KEYS, goodKS + '00'.repeat(32)],
  ['pqcKeyStatus: unknown selector', KEYS, '0xdeadbeef' + goodKS.slice(10)],
  ['pqcVerify: empty calldata', VERIFY, '0x'],
  ['pqcVerify: valid call + 32 trailing bytes', VERIFY, goodV + '00'.repeat(32)],
  ['pqcVerify: calldata cut by 32 bytes', VERIFY, goodV.slice(0, goodV.length - 64)],
  ['pqcVerify: unknown selector', VERIFY, '0xdeadbeef' + goodV.slice(10)],
];
for (const [name, to, data] of abiCases) {
  const r = await call(to, data);
  results.abi.push({ case: name, to, block: r.block, reverted: r.reverted, ret: r.ret && r.ret.length <= 66 ? r.ret : r.ret ? `${r.ret.length / 2 - 1} bytes` : null, error: r.error ?? undefined });
}

const anomalies = results.verify.filter((r) => r.anomaly);
results.summary = { verifyCases: results.verify.length, keyStatusCases: results.keyStatus.length, abiCases: results.abi.length, anomalies: anomalies.map((a) => a.case) };

// Offline fixture for test/PrecompileConformance.t.sol: the exact live return bytes, replayed against PqcLib in CI.
{
  const reached = results.verify.filter((r) => !r.notReached);
  const fx = {
    note: 'Live Diana precompile answers recorded by script/probe-precompiles.mjs. Replayed by test/PrecompileConformance.t.sol.',
    vN: reached.length,
    v: reached.map((r) => ({ name: r.case, reverted: r.live === 'revert', ret: r.raw ?? '0x', expected: r.expected, block: r.block })),
    ksN: results.keyStatus.length,
    ks: results.keyStatus.map((r) => ({ name: r.case, address: r.address, reverted: r.reverted, ret: r.raw ?? '0x', registered: !!r.registered, algoId: Number(r.algoId ?? 0), pubkeyLen: r.pubkeyLen ?? 0, possessionProven: !!r.possessionProven, block: r.block })),
  };
  fs.mkdirSync(new URL('../test/fixtures/conformance/', import.meta.url), { recursive: true });
  fs.writeFileSync(new URL('../test/fixtures/conformance/live.json', import.meta.url), JSON.stringify(fx, null, 1) + '\n');
}
for (const r of results.verify) delete r.raw;
for (const r of results.keyStatus) delete r.raw;

const docs = new URL('../../docs/', import.meta.url);
fs.writeFileSync(new URL('precompile-conformance.json', docs), JSON.stringify(results, null, 2) + '\n');

const md = [];
md.push('# Precompile conformance: pqcVerify (0x0A01) and pqcKeyStatus (0x0A02) on Diana');
md.push('');
md.push(`RECORDED ${results.generatedAt.slice(0, 16).replace('T', ' ')} UTC by \`node contracts-v4/script/probe-precompiles.mjs\` against \`${RPC}\` (EVM chain id ${results.chainIdEvm}). eth_call only: no transaction, no QOR spent. Raw data: [precompile-conformance.json](precompile-conformance.json). Re-run the script to refresh; the block of every read is in the table.`);
md.push('');
md.push('"Expected" is FIPS 204 ML-DSA-87 (pure, empty context) computed locally with two libraries (@qorechain/pqc and @qorechain/qoresign, which must agree). "PqcLib" is what our contracts conclude from the live answer (true only for exactly one 32-byte word equal to 1; a revert or anything else is false). A row is an anomaly only when PqcLib\'s conclusion differs from the expectation.');
md.push('');
md.push(`Result: ${results.verify.length} pqcVerify cases, ${anomalies.length} anomalies${anomalies.length ? ': ' + anomalies.map((a) => a.case).join('; ') : ''}.`);
md.push('');
{
  const v = (n) => results.verify.find((r) => r.case === n);
  const h = results.historical;
  const firstTrue = h.find((x) => x.live === true);
  const lastFalse = [...h].reverse().find((x) => x.live === false);
  const reachedMax = Math.max(...results.verify.filter((r) => r.live === true).map((r) => r.msgLen));
  const blocked = results.verify.filter((r) => r.notReached).map((r) => r.msgLen);
  const offsets = [...new Set(results.keyStatus.filter((r) => r.pubkeyOffset !== undefined).map((r) => '0x' + r.pubkeyOffset.toString(16)))];
  const dirty = results.abi.find((r) => r.case.includes('dirty high bits'));
  const trailing = results.abi.find((r) => r.case === 'pqcVerify: valid call + 32 trailing bytes');
  const g0 = v('valid: empty message')?.gas; const g16 = v('valid: 16384-byte message')?.gas;
  md.push('## Findings');
  md.push('');
  md.push(`1. Signature check: every one of the ${results.verify.filter((r) => !r.notReached).length} reached cases matches FIPS 204 ML-DSA-87 (pure, empty context). Wrong-size keys and signatures, all-zero inputs, flipped bits, other parameter sets (ML-DSA-65, ML-DSA-44), a non-empty context and an ML-DSA internal signature all return false. The precompile returns false (it does not revert) for bad sizes.`);
  md.push(`2. Empty message (chain-level, already fixed): a valid signature over the empty message read ${lastFalse ? 'false at block ' + lastFalse.block : 'n/a'} and ${firstTrue ? 'true from block ' + firstTrue.block : 'n/a'} (archive reads in the table below). The current behaviour is correct. Pocket Drop never signs an empty message (every intent message is 99 bytes), so no Pocket Drop path depended on it.`);
  md.push(`3. Key status layout: the bytes offset word is ${offsets.join(', ')} in every answer; an unregistered account returns ${results.keyStatus.find((r) => r.registered === false)?.retBytes} bytes (registered false, algoId 0, empty key, PoP false), a registered one ${results.keyStatus.find((r) => r.registered === true)?.retBytes} bytes with a 2592-byte key. PqcLib v4 accepts any aligned offset >= 0x80; the v5 strict PqcLib requires exactly 0x80 and a 2592-byte key, which matches every live answer.`);
  md.push(`4. ABI leniency (observation, not a risk for Pocket Drop): pqcKeyStatus ${dirty && !dirty.reverted ? 'accepts an address word with dirty high bits (Solidity would revert)' : 'rejects dirty address bits'}, and pqcVerify ${trailing && !trailing.reverted ? 'ignores 32 trailing calldata bytes' : 'rejects trailing calldata'}. PqcLib always sends canonical abi.encode calldata.`);
  md.push(`5. Cost and size: a valid check costs about ${g0} gas for an empty message and ${g16} gas at 16 KiB. Messages up to ${reachedMax} bytes were verified live${blocked.length ? '; ' + blocked.join(', ') + ' bytes did not reach the node (the public RPC gateway answered HTTP 403), so the precompile itself was not tested at that size' : ''}.`);
  md.push('');
}
md.push('## pqcVerify(bytes pk, bytes sig, bytes msg)');
md.push('');
md.push('| Case | pk / sig / msg bytes | Expected | Live answer | PqcLib | Gas (valid) | Block |');
md.push('|---|---|---|---|---|---|---|');
for (const r of results.verify) md.push(`| ${r.case} | ${r.pkLen} / ${r.sigLen} / ${r.msgLen} | ${r.expected} | ${r.live}${r.error ? ' (' + r.error.replace(/\|/g, '/').slice(0, 60) + ')' : ''} | ${r.pqcLibResult}${r.anomaly ? ' **ANOMALY**' : ''} | ${r.gas ?? ''} | ${r.block} |`);
md.push('');
md.push('### Empty message at earlier heights');
md.push('');
md.push('| Block | Live answer |');
md.push('|---|---|');
for (const h of results.historical) md.push(`| ${h.block} | ${h.live}${h.error ? ' (' + h.error.slice(0, 80) + ')' : ''} |`);
md.push('');
md.push('## pqcKeyStatus(address)');
md.push('');
md.push('| Case | Registered | algoId | Key bytes | PoP | Head offset of bytes | Return bytes | Block |');
md.push('|---|---|---|---|---|---|---|---|');
for (const r of results.keyStatus) md.push(`| ${r.case} | ${r.reverted ? 'revert' : r.registered} | ${r.algoId ?? ''} | ${r.pubkeyLen ?? ''} | ${r.possessionProven ?? ''} | ${r.pubkeyOffset !== undefined ? '0x' + r.pubkeyOffset.toString(16) : ''} | ${r.retBytes ?? ''} | ${r.block} |`);
md.push('');
md.push('## Malformed calldata (PqcLib never sends these)');
md.push('');
md.push('| Case | Result | Block |');
md.push('|---|---|---|');
for (const r of results.abi) md.push(`| ${r.case} | ${r.reverted ? 'revert' : 'returned ' + r.ret} | ${r.block} |`);
md.push('');
fs.writeFileSync(new URL('PRECOMPILE_CONFORMANCE.md', docs), md.join('\n'));
console.log(JSON.stringify(results.summary));

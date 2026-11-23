// Writes test/fixtures/keystatus/vectors.json: raw pqcKeyStatus return data cases shared by two decoders.
//   - "contract": what PqcLib.keyStatus (src/PqcLib.sol) must return; asserted by test/KeyStatusVectors.t.sol.
//   - "strict":   what frontend/src/lib/keystatus.ts must return; asserted by frontend/test/keystatus.test.ts.
// The two live cases are the RECORDED Diana bytes from test/fixtures/keystatus/live-diana.json; every other case is an
// ILLUSTRATION built from them by changing one field.
//   node script/gen-keystatus-vectors.mjs
import fs from 'node:fs';

const dir = new URL('../test/fixtures/keystatus/', import.meta.url);
const live = JSON.parse(fs.readFileSync(new URL('live-diana.json', dir), 'utf8'));
const hex = (b) => '0x' + Buffer.from(b).toString('hex');
const bytes = (h) => Buffer.from(h.slice(2), 'hex');
const w = (n) => { const b = Buffer.alloc(32); let v = BigInt(n); for (let i = 31; i >= 0; i--) { b[i] = Number(v & 0xffn); v >>= 8n; } return b; };
const setWord = (buf, i, n) => { const b = Buffer.from(buf); w(n).copy(b, i * 32); return b; };
const pad = (n) => Buffer.alloc((32 - (n % 32)) % 32);

const REG = bytes(live.registered.raw);
const UNREG = bytes(live.unregistered.raw);
const PK = REG.subarray(160, 160 + 2592);

/** JS model of PqcLib.keyStatus (the Solidity is the reference; Foundry checks this model against it). */
function contractModel(b) {
  const no = { ok: false, registered: false, algoId: 0, proven: false, pkLen: 0 };
  const n = b.length;
  if (n < 160) return no;
  const rd = (at) => BigInt('0x' + b.subarray(at, at + 32).toString('hex'));
  const reg = rd(0), algo = rd(32), off = rd(64), pop = rd(96);
  if (reg > 1n || pop > 1n || algo > 255n) return no;
  if (off < 128n || off % 32n !== 0n || off > BigInt(n - 32)) return no;
  const len = BigInt('0x' + b.subarray(Number(off), Number(off) + 32).toString('hex'));
  if (len > 8192n || off + 32n + len > BigInt(n)) return no;
  return { ok: true, registered: reg === 1n, algoId: Number(algo), proven: pop === 1n, pkLen: Number(len) };
}

const head = (reg, algo, off, pop) => Buffer.concat([w(reg), w(algo), w(off), w(pop)]);
const cases = [
  ['live-registered', REG, 'ok'],
  ['live-unregistered', UNREG, 'ok'],
  ['registered-word-is-2', setWord(REG, 0, 2), 'bool-registered'],
  ['proven-word-is-2', setWord(REG, 3, 2), 'bool-proven'],
  ['algo-256', setWord(REG, 1, 256), 'algo-range'],
  ['offset-0x60', setWord(REG, 2, 0x60), 'offset'],
  ['offset-0x81', setWord(REG, 2, 0x81), 'offset'],
  ['offset-0xa0-with-gap', Buffer.concat([head(1, 1, 0xa0, 1), w(0), w(2592), PK]), 'offset'],
  ['length-2593-past-buffer', setWord(REG, 4, 2593), 'length-out-of-buffer'],
  ['length-huge', setWord(REG, 4, (1n << 255n)), 'length-out-of-buffer'],
  ['ml-dsa-key-2591-bytes', Buffer.concat([head(1, 1, 0x80, 1), w(2591), PK.subarray(0, 2591), pad(2591)]), 'pk-length'],
  ['padding-not-zero', Buffer.concat([head(1, 2, 0x80, 1), w(5), Buffer.from('0102030405', 'hex'), Buffer.alloc(26), Buffer.from('ff', 'hex')]), 'padding-not-zero'],
  ['trailing-word', Buffer.concat([REG, w(0)]), 'trailing-bytes'],
  ['unaligned-extra-byte', Buffer.concat([REG, Buffer.alloc(1)]), 'unaligned'],
  ['short-128-bytes', REG.subarray(0, 128), 'short'],
  ['registered-not-proven', setWord(REG, 3, 0), 'ok'],
  ['unregistered-with-key', Buffer.concat([head(0, 0, 0x80, 0), w(5), Buffer.from('0102030405', 'hex'), Buffer.alloc(27)]), 'unregistered-with-key'],
  ['empty', Buffer.alloc(0), 'short'],
];

const vectors = cases.map(([name, b, strict]) => ({
  name,
  label: name.startsWith('live-') ? 'RECORDED' : 'ILLUSTRATION',
  raw: hex(b),
  contract: contractModel(b),
  strict,
}));
fs.writeFileSync(new URL('vectors.json', dir), JSON.stringify({ count: vectors.length, source: 'script/gen-keystatus-vectors.mjs', vectors }, null, 1) + '\n');
console.log(`wrote ${vectors.length} vectors`);
for (const v of vectors) console.log(v.name.padEnd(26), 'contract', v.contract.ok ? 'ok  ' : 'FAIL', 'strict', v.strict);

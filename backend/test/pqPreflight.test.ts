import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { encodeFunctionData, toFunctionSelector, type Hex } from 'viem';
import { PQ_ARG_ABI, pqPreflight } from '../src/pqPreflight.js';
import { decodeKeyStatusStrict, isUsableKey } from '../src/keystatus.js';
import { handleRoute, type RouteDeps } from '../src/route.js';
import { MemoryLimiter } from '../src/ratelimit.js';
import { setSink } from '../src/log.js';
import type { Relayer } from '../src/relayer.js';
import { ADDR, CONTRACT, cfg } from './helpers.js';

setSink(() => {});
const root = path.resolve(__dirname, '..', '..');
const abiDir = path.join(root, 'contracts-v4', 'abi');
const haveAbi = fs.existsSync(abiDir);
const fx = path.join(root, 'contracts-v4', 'test', 'fixtures');
const haveFx = fs.existsSync(path.join(fx, 'keys.json'));
const hex = (n: number, b = 'ab') => ('0x' + b.repeat(n)) as Hex;
const POCKET = '0x74b604e8f1bb729a6e43dcd893f01747688e3e8f' as Hex;

describe.skipIf(!haveAbi)('PQ_ARG_ABI matches the deployed contract ABIs', () => {
  const fns = ['PocketVault', 'PocketDrop', 'DropPool'].flatMap((f) => {
    const j = JSON.parse(fs.readFileSync(path.join(abiDir, `${f}.json`), 'utf8'));
    return ((j.abi ?? j) as { type: string; name: string; stateMutability: string; inputs: { type: string; name: string }[] }[])
      .filter((x) => x.type === 'function' && x.stateMutability !== 'view' && x.stateMutability !== 'pure');
  });
  const sel = (x: { name: string; inputs: { type: string }[] }) => toFunctionSelector(`${x.name}(${x.inputs.map((i) => i.type).join(',')})`);
  it('every listed function exists in a contract with the same selector and argument names', () => {
    for (const a of PQ_ARG_ABI) {
      const m = fns.find((f) => sel(f) === sel(a as never));
      expect(m, a.name).toBeTruthy();
      expect(m!.inputs.map((i) => i.name)).toEqual(a.inputs.map((i) => i.name));
    }
  });
  it('every state-changing function that takes bytes / bytes[] is listed (no signature path is missed)', () => {
    const want = new Set(fns.filter((f) => f.inputs.some((i) => i.type === 'bytes' || i.type === 'bytes[]')).map(sel));
    const have = new Set(PQ_ARG_ABI.map((a) => sel(a as never)));
    expect([...want].filter((s) => !have.has(s))).toEqual([]);
    expect(have.size).toBe(17);
  });
});

describe('pqPreflight', () => {
  it('passes exact ML-DSA-87 sizes and flags anything else', () => {
    const ok = encodeFunctionData({ abi: PQ_ARG_ABI, functionName: 'spend', args: [ADDR as Hex, 1n, 2n, hex(4627)] });
    expect(pqPreflight(ok)).toEqual({ known: true, fn: 'spend', issues: [] });
    const short = encodeFunctionData({ abi: PQ_ARG_ABI, functionName: 'spend', args: [ADDR as Hex, 1n, 2n, hex(4626)] });
    expect(pqPreflight(short)).toMatchObject({ known: true, issues: [{ arg: 'sig', bytes: 4626, expected: 4627 }] });
    const empty = encodeFunctionData({ abi: PQ_ARG_ABI, functionName: 'cancelPending', args: [2n, '0x'] });
    expect(pqPreflight(empty)).toMatchObject({ issues: [{ arg: 'sig', bytes: 0 }] });
  });
  it('checks link keys, both pool signatures and each guardian signature by index', () => {
    const bind = encodeFunctionData({ abi: PQ_ARG_ABI, functionName: 'bind', args: [1n, ADDR as Hex, hex(32), ADDR as Hex, hex(2591), hex(4627)] });
    expect(pqPreflight(bind)).toMatchObject({ fn: 'bind', issues: [{ arg: 'linkPk', bytes: 2591, expected: 2592 }] });
    const poolClaim = encodeFunctionData({ abi: PQ_ARG_ABI, functionName: 'claim', args: [1n, ADDR as Hex, ADDR as Hex, hex(2592), hex(4627), hex(4628)] });
    expect(pqPreflight(poolClaim)).toMatchObject({ fn: 'claim', issues: [{ arg: 'recipientSig', bytes: 4628 }] });
    const rec = encodeFunctionData({ abi: PQ_ARG_ABI, functionName: 'proposeRecovery', args: [ADDR as Hex, hex(32), 9n, [ADDR as Hex, ADDR as Hex], [hex(4627), hex(10)]] });
    expect(pqPreflight(rec)).toMatchObject({ issues: [{ arg: 'sigs', index: 1, bytes: 10 }] });
  });
  it('leaves calls without signatures (executeQueued, finalizeRecovery, deploy only) to the simulation', () => {
    expect(pqPreflight('0x')).toEqual({ known: false });
    expect(pqPreflight('0x12345678')).toEqual({ known: false });
  });
  it.skipIf(!haveFx)('a real fixture signature (contracts-v4, signed with ML-DSA-87) passes', () => {
    const f = JSON.parse(fs.readFileSync(path.join(fx, 'vault', 'spendS_0.json'), 'utf8')) as { sig: Hex };
    const keys = JSON.parse(fs.readFileSync(path.join(fx, 'keys.json'), 'utf8')) as { pks: Record<string, Hex> };
    expect((f.sig.length - 2) / 2).toBe(4627);
    expect((keys.pks.OA.length - 2) / 2).toBe(2592);
    const d = encodeFunctionData({ abi: PQ_ARG_ABI, functionName: 'spend', args: [ADDR as Hex, 8n * 10n ** 17n, 1_900_000_000n, f.sig] });
    expect(pqPreflight(d)).toEqual({ known: true, fn: 'spend', issues: [] });
  });
});

describe('POST /api/route refuses wrong-size PQ material before simulating', () => {
  it('400 BadPqLength, nothing simulated or sent', async () => {
    const relayer = { mode: 'evm', address: ADDR, contract: CONTRACT, simulate: vi.fn(), estimate: vi.fn(), send: vi.fn() } as unknown as Relayer;
    const d: RouteDeps = { cfg: cfg(), limiter: new MemoryLimiter(), getRouterRelayer: () => relayer };
    const data = encodeFunctionData({ abi: PQ_ARG_ABI, functionName: 'spend', args: [ADDR as Hex, 1n, 2n, hex(100)] });
    const r = await handleRoute({ target: POCKET, data }, '9.9.9.9', d);
    expect(r.status).toBe(400);
    expect((r.body as { error: { name: string } }).error.name).toBe('BadPqLength');
    expect(relayer.simulate).not.toHaveBeenCalled();
    expect(relayer.send).not.toHaveBeenCalled();
  });
});

describe('strict pqcKeyStatus decoder (backend copy)', () => {
  const fe = path.join(root, 'frontend', 'src', 'lib', 'keystatus.ts');
  it.skipIf(!fs.existsSync(fe))('is byte-identical to the frontend copy', () => {
    expect(fs.readFileSync(path.join(__dirname, '..', 'src', 'keystatus.ts'), 'utf8')).toBe(fs.readFileSync(fe, 'utf8'));
  });
  const vf = path.join(fx, 'keystatus', 'vectors.json');
  it.skipIf(!fs.existsSync(vf))('gives the strict result for every shared vector', () => {
    const { vectors } = JSON.parse(fs.readFileSync(vf, 'utf8')) as { vectors: { name: string; raw: string; strict: string }[] };
    for (const v of vectors) {
      const r = decodeKeyStatusStrict(v.raw);
      expect(r.ok ? 'ok' : r.reason, v.name).toBe(v.strict);
    }
    expect(isUsableKey(decodeKeyStatusStrict(vectors[0].raw))).toBe(true);
  });
});

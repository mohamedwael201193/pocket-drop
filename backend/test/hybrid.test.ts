import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import { encodeAbiParameters, encodeFunctionData, encodeFunctionResult, parseAbi, type Hex } from 'viem';
import { crossVmResponses, hybridVerified, pbFields } from '../src/cosmos.js';
import { createHybridRelayer, feeFor, hybridGas, relayMemo, relayerFor, HYBRID_GAS_CAP } from '../src/hybridRelayer.js';
import { decodeRouteReturn } from '../src/route.js';
import { routerAbi } from '../src/abi4.js';
import { getConfig } from '../src/config.js';
import { evmToQor, type Relayer } from '../src/relayer.js';
import { CONTRACT, KEY, cfg } from './helpers.js';

// Real Diana txs (22 Nov 2026): a hybrid MsgCrossVMCall that ran PocketRouter.relay(V, executeQueued(1)), and one whose EVM call reverted.
const OK = JSON.parse(fs.readFileSync(new URL('./fixtures/xvm-93FC5B4B.json', import.meta.url), 'utf8')).tx_response;
const FAIL = JSON.parse(fs.readFileSync(new URL('./fixtures/xvm-B05749E6.json', import.meta.url), 'utf8')).tx_response;
const PQC = ('0x' + '22'.repeat(32)) as Hex; // throwaway

describe('cosmos tx result reader', () => {
  it('reads the MsgCrossVMCallResponse of a real hybrid relay', () => {
    const [r] = crossVmResponses(OK.data);
    expect(r.executed).toBe(true);
    expect(r.messageId).toBe('9df93d694230890c6e1e730f902c32c8');
    // PocketRouter.relay returned empty bytes (executeQueued returns nothing): abi.encode(bytes(""))
    expect(r.data).toBe(encodeAbiParameters([{ type: 'bytes' }], ['0x']));
    expect(Number(r.gasUsed)).toBeGreaterThan(0);
  });
  it('sees the chain-verified hybrid signature on the real tx, and nothing on empty data', () => {
    expect(hybridVerified(OK)).toBe(true);
    expect(hybridVerified({ events: [] })).toBe(false);
    expect(crossVmResponses(undefined)).toEqual([]);
    expect(crossVmResponses(FAIL.data)).toEqual([]);
  });
  it('rejects truncated protobuf', () => {
    expect(() => pbFields(Uint8Array.from([0x0a, 0x05, 0x01]))).toThrow(/truncated/);
    expect(() => pbFields(Uint8Array.from([0x08, 0x80]))).toThrow(/truncated varint/);
    expect(() => pbFields(Uint8Array.from([0x0b]))).toThrow(/wire type/);
  });
});

describe('gas, fee, memo', () => {
  it('uses the dry run plus 15% and 20k, else overhead + 1.5x EVM gas, capped', () => {
    expect(hybridGas(511_277n, 350_000n)).toBe(607_968n);
    expect(hybridGas(null, 350_000n)).toBe(975_000n);
    expect(hybridGas(10_000_000n, 1n)).toBe(HYBRID_GAS_CAP);
    expect(feeFor(600_000n)).toBe(66_000n); // the fee the real tx paid
  });
  it('names the relay', () => {
    expect(relayMemo(['route', 'prod', 'relay', '0xabc'])).toBe('pd route prod relay 0xabc');
    expect(relayMemo(['v3', 'bind', undefined, ''])).toBe('pd v3 bind');
    expect(relayMemo(['x'.repeat(400)]).length).toBe(250);
  });
});

function chain(over: { broadcast?: unknown[]; tx?: unknown; sim?: unknown } = {}) {
  const broadcasts = [...(over.broadcast ?? [{ tx_response: { code: 0, txhash: OK.txhash } }])];
  const calls: string[] = [];
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${url.replace('http://rest.invalid', '')}`);
    if (url.includes('/cosmos/auth/v1beta1/accounts/')) return new Response(JSON.stringify({ account: { account_number: '7', sequence: String(calls.length) } }));
    if (url.endsWith('/simulate')) return new Response(JSON.stringify(over.sim ?? { gas_info: { gas_used: '500000' } }), { status: over.sim === null ? 500 : 200 });
    if (url.endsWith('/cosmos/tx/v1beta1/txs')) return new Response(JSON.stringify(broadcasts.shift() ?? { tx_response: { code: 0, txhash: OK.txhash } }));
    if (url.includes('/cosmos/tx/v1beta1/txs/')) return over.tx === null ? new Response('{}', { status: 404 }) : new Response(JSON.stringify({ tx_response: over.tx ?? OK }));
    throw new Error('unexpected ' + url);
  });
  const signCrossVm = vi.fn(async (i: { gas: string; sequence: bigint }) => ({ from: 'qor1x', txBytes: Buffer.from(`${i.gas}:${i.sequence}`).toString('base64') }));
  return { f: f as unknown as typeof fetch, calls, signCrossVm, signer: async () => ({ signCrossVm }) as never };
}
const hcfg = () => ({ ...cfg(), relayerPqc: PQC });
const evmFallback = (): Relayer => ({ mode: 'evm', address: '0x0000000000000000000000000000000000000001', contract: CONTRACT as Hex, simulate: vi.fn(), send: vi.fn(async () => ({ ok: true as const, hash: '0xfeed', lane: 'evm' as const, status: 'success' as const, blockNumber: 1n, gasUsed: 2n })) });

describe('createHybridRelayer', () => {
  it('needs both keys and a contract', () => {
    expect(() => createHybridRelayer({ ...hcfg(), relayerPqc: null }, { pub: {} as never })).toThrow(/RELAYER_PQC_SEED/);
    expect(() => createHybridRelayer({ ...hcfg(), relayerKey: null }, { pub: {} as never })).toThrow(/RELAYER_SECP_KEY/);
    expect(() => createHybridRelayer({ ...hcfg(), contract: null }, { pub: {} as never })).toThrow(/POCKETDROP_ADDRESS/);
  });
  it('signs a dry run, sizes gas from it, broadcasts once and reads the mined result', async () => {
    const c = chain();
    const r = createHybridRelayer(hcfg(), { pub: {} as never, fetch: c.f, signer: c.signer, pollMs: 1 });
    expect(r.mode).toBe('hybrid');
    expect(r.cosmosAddress).toBe(evmToQor(r.address));
    const s = await r.send('0xabcd', 350_000n, 'pd route prod relay 0xV');
    expect(s).toMatchObject({ ok: true, lane: 'hybrid', status: 'success', hash: OK.txhash, blockNumber: 10527710n, hybridVerified: true, feeUqor: String(feeFor(595_000n)) });
    expect(c.signCrossVm).toHaveBeenCalledTimes(2);
    expect(c.signCrossVm.mock.calls[1][0]).toMatchObject({ gas: '595000', memo: 'pd route prod relay 0xV', contract: CONTRACT, data: '0xabcd', secp: KEY, pqc: PQC });
    expect(c.calls.filter((x) => x === 'POST /cosmos/tx/v1beta1/txs')).toHaveLength(1);
  });
  it('re-reads the sequence and re-signs on code 32', async () => {
    const c = chain({ broadcast: [{ tx_response: { code: 32, txhash: 'AA', raw_log: 'account sequence mismatch' } }] });
    const s = await createHybridRelayer(hcfg(), { pub: {} as never, fetch: c.f, signer: c.signer, pollMs: 1 }).send('0x01', 350_000n);
    expect(s).toMatchObject({ ok: true, lane: 'hybrid' });
    expect(c.calls.filter((x) => x === 'POST /cosmos/tx/v1beta1/txs')).toHaveLength(2);
  });
  it('uses the overhead formula when the dry run is refused', async () => {
    const c = chain({ sim: null });
    await createHybridRelayer(hcfg(), { pub: {} as never, fetch: c.f, signer: c.signer, pollMs: 1 }).send('0x01', 350_000n);
    expect(c.signCrossVm.mock.calls[1][0].gas).toBe('975000');
  });
  it('reports a mined EVM revert as reverted, with the chain log, and never falls back after broadcast', async () => {
    const fb = evmFallback();
    const c = chain({ tx: FAIL });
    const s = await createHybridRelayer(hcfg(), { pub: {} as never, fetch: c.f, signer: c.signer, fallback: fb, pollMs: 1 }).send('0x01', 350_000n);
    expect(s).toMatchObject({ ok: true, lane: 'hybrid', status: 'reverted', failure: expect.stringContaining('execution reverted') });
    expect(fb.send).not.toHaveBeenCalled();
  });
  it('accepted but never mined: rpc error with the hash, no fallback', async () => {
    const fb = evmFallback();
    const c = chain({ tx: null });
    const s = await createHybridRelayer(hcfg(), { pub: {} as never, fetch: c.f, signer: c.signer, fallback: fb, pollMs: 1 }).send('0x01', 350_000n);
    expect(s).toMatchObject({ ok: false, reason: 'rpc', hash: OK.txhash });
    expect(fb.send).not.toHaveBeenCalled();
  }, 10_000);
  it('falls back to the EVM window when refused at broadcast or when the signer is missing', async () => {
    const fb = evmFallback();
    const c = chain({ broadcast: [{ tx_response: { code: 13, txhash: 'BB', raw_log: 'insufficient fee' } }] });
    const s = await createHybridRelayer(hcfg(), { pub: {} as never, fetch: c.f, signer: c.signer, fallback: fb, pollMs: 1 }).send('0x01', 350_000n);
    expect(s).toMatchObject({ ok: true, lane: 'evm', hash: '0xfeed', fallbackReason: expect.stringContaining('code 13') });
    const s2 = await createHybridRelayer(hcfg(), { pub: {} as never, fetch: c.f, signer: async () => { throw new Error('bundle missing'); }, fallback: fb }).send('0x01', 1n);
    expect(s2).toMatchObject({ lane: 'evm', fallbackReason: expect.stringContaining('bundle missing') });
  });
  it('without a fallback, a refusal is a plain hybrid error', async () => {
    const c = chain({ broadcast: [{ tx_response: { code: 13, txhash: 'BB', raw_log: 'insufficient fee' } }] });
    const s = await createHybridRelayer(hcfg(), { pub: {} as never, fetch: c.f, signer: c.signer, pollMs: 1 }).send('0x01', 1n);
    expect(s).toMatchObject({ ok: false, reason: 'hybrid', message: expect.stringContaining('insufficient fee') });
  });
});

describe('relayerFor and config', () => {
  it('picks hybrid only with the ML-DSA seed and RELAY_MODE not evm', () => {
    expect(relayerFor(cfg(), CONTRACT as Hex, {} as never).mode).toBe('evm');
    expect(relayerFor({ ...hcfg(), relayMode: 'hybrid' }, CONTRACT as Hex, {} as never).mode).toBe('hybrid');
    expect(relayerFor({ ...hcfg(), relayMode: 'evm' }, CONTRACT as Hex, {} as never).mode).toBe('evm');
  });
  it('parses RELAY_MODE, RELAYER_PQC_SEED and RELAY_FALLBACK', () => {
    expect(getConfig({}).relayMode).toBe('evm');
    expect(getConfig({ RELAYER_PQC_SEED: '22'.repeat(32) })).toMatchObject({ relayMode: 'hybrid', relayerPqc: '0x' + '22'.repeat(32), relayFallback: true });
    expect(getConfig({ RELAYER_PQC_SEED: '22'.repeat(32), RELAY_MODE: 'EVM' }).relayMode).toBe('evm');
    expect(getConfig({ RELAYER_PQC_SEED: 'nothex' }).relayMode).toBe('evm');
    expect(getConfig({ RELAY_FALLBACK: 'none' }).relayFallback).toBe(false);
  });
});

describe('decodeRouteReturn', () => {
  const vault = parseAbi(['function createDrop(address,bytes32,uint8,uint64,uint96,uint96,uint256,uint256,bytes) returns (uint256)', 'function createPool(address,bytes32,uint32,uint96,uint64,uint256,bytes) returns (uint256)']);
  const inner = encodeFunctionData({ abi: vault, functionName: 'createDrop', args: [CONTRACT as Hex, ('0x' + '00'.repeat(32)) as Hex, 0, 1n, 0n, 0n, 1n, 1n, '0x'] });
  it('reads the new link id from relay(bytes)', () => {
    const ret = encodeFunctionResult({ abi: routerAbi, functionName: 'relay', result: encodeAbiParameters([{ type: 'uint256' }], [42n]) });
    expect(decodeRouteReturn('relay', inner, ret)).toMatchObject({ linkId: '42' });
  });
  it('reads the Pocket and the pool id from deployAndRelay(address, bytes)', () => {
    const pinner = encodeFunctionData({ abi: vault, functionName: 'createPool', args: [CONTRACT as Hex, ('0x' + '00'.repeat(32)) as Hex, 2, 1n, 1n, 1n, '0x'] });
    const ret = encodeFunctionResult({ abi: routerAbi, functionName: 'deployAndRelay', result: [CONTRACT as Hex, encodeAbiParameters([{ type: 'uint256' }], [9n])] });
    expect(decodeRouteReturn('deployAndRelay', pinner, ret)).toMatchObject({ pocket: CONTRACT, poolId: '9' });
  });
  it('returns nothing it cannot read', () => {
    expect(decodeRouteReturn('relay', inner, undefined)).toEqual({});
    expect(decodeRouteReturn('relay', inner, '0x1234')).toEqual({});
    expect(decodeRouteReturn('relay', '0xdeadbeef', OK && encodeAbiParameters([{ type: 'bytes' }], ['0x']))).toEqual({ innerReturn: '0x' });
  });
});

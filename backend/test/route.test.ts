import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { decodeFunctionData, encodeErrorResult, encodeFunctionData, getAddress } from 'viem';
import { routerAbi, v4ErrorsAbi } from '../src/abi4.js';
import { decodeRevert } from '../src/errors.js';
import { encodeRouterCall, handleRoute, pickGas, type RouteDeps } from '../src/route.js';
import { MemoryLimiter } from '../src/ratelimit.js';
import { checkRpcBody, proxyRequest } from '../src/proxy.js';
import { setSink } from '../src/log.js';
import { routeSchema } from '../src/validation.js';
import { V4_INSTANCES } from '../src/v4.js';
import type { Relayer } from '../src/relayer.js';
import { ADDR, CONTRACT, cfg, hexBytes } from './helpers.js';

setSink(() => {});

const HASH = ('0x' + 'ef'.repeat(32)) as `0x${string}`;
const POCKET = '0x74b604e8f1bb729a6e43dcd893f01747688e3e8f';
const pocketCfg = () => ({ owner: ADDR, guardians: [] as string[], threshold: 0, dailyLimit: '5000000000000000000', userSalt: hexBytes(32, '00') });

function mk(over: Partial<Relayer> = {}, c = cfg()): { d: RouteDeps; relayer: Relayer; getRouterRelayer: ReturnType<typeof vi.fn> } {
  const relayer: Relayer = {
    mode: 'evm', address: ADDR, contract: CONTRACT as any,
    simulate: vi.fn(async () => ({ ok: true as const })),
    estimate: vi.fn(async () => 400_000n),
    send: vi.fn(async () => ({ ok: true as const, hash: HASH, lane: 'evm' as const, status: 'success' as const, blockNumber: 99n, gasUsed: 410_000n })),
    ...over,
  };
  const getRouterRelayer = vi.fn(() => relayer);
  return { d: { cfg: c, limiter: new MemoryLimiter(), getRouterRelayer }, relayer, getRouterRelayer };
}

describe('routeSchema', () => {
  it('requires a target or a pocket, never both, and data for a relay', () => {
    expect(routeSchema.safeParse({ target: POCKET, data: '0x1234' }).success).toBe(true);
    expect(routeSchema.safeParse({ data: '0x1234' }).success).toBe(false);
    expect(routeSchema.safeParse({ target: POCKET }).success).toBe(false);
    expect(routeSchema.safeParse({ target: POCKET, pocket: pocketCfg(), data: '0x' }).success).toBe(false);
    expect(routeSchema.safeParse({ pocket: pocketCfg() }).success).toBe(true); // deploy only
  });
  it('rejects bad hex, odd length, bad env, extra keys, too many guardians, huge data', () => {
    expect(routeSchema.safeParse({ target: POCKET, data: '0x123' }).success).toBe(false);
    expect(routeSchema.safeParse({ target: POCKET, data: 'zz' }).success).toBe(false);
    expect(routeSchema.safeParse({ target: POCKET, data: '0x12', env: 'main' }).success).toBe(false);
    expect(routeSchema.safeParse({ target: POCKET, data: '0x12', gas: 1 }).success).toBe(false);
    expect(routeSchema.safeParse({ pocket: { ...pocketCfg(), guardians: Array(6).fill(ADDR) } }).success).toBe(false);
    expect(routeSchema.safeParse({ target: POCKET, data: '0x' + '00'.repeat(64 * 1024 + 1) }).success).toBe(false);
    expect(routeSchema.safeParse({ pocket: { ...pocketCfg(), userSalt: '0x12' } }).success).toBe(false);
  });
  it('defaults env to prod and parses dailyLimit as bigint', () => {
    const r = routeSchema.parse({ pocket: pocketCfg() });
    expect(r.env).toBe('prod');
    expect(r.pocket?.dailyLimit).toBe(5n * 10n ** 18n);
  });
});

describe('encodeRouterCall', () => {
  it('encodes relay and deployAndRelay for the router ABI', () => {
    const relay = encodeRouterCall({ target: getAddress(POCKET), data: '0xabcd' });
    expect(decodeFunctionData({ abi: routerAbi, data: relay })).toMatchObject({ functionName: 'relay', args: [getAddress(POCKET), '0xabcd'] });
    const dep = encodeRouterCall({ pocket: { owner: ADDR, guardians: [], threshold: 0, dailyLimit: 7n, userSalt: hexBytes(32, '00') }, data: '0x' });
    expect(decodeFunctionData({ abi: routerAbi, data: dep }).functionName).toBe('deployAndRelay');
  });
});

describe('pickGas', () => {
  const c = cfg();
  it('clamps the scaled estimate and uses the cap without an estimate', () => {
    expect(pickGas(c, 1_000_000n, false)).toBe(1_400_000n);
    expect(pickGas(c, 100_000n, false)).toBe(350_000n);
    expect(pickGas(c, 100_000n, true)).toBe(700_000n);
    expect(pickGas(c, 5_000_000n, false)).toBe(1_800_000n);
    expect(pickGas(c, null, false)).toBe(1_800_000n);
  });
});

describe('POST /api/route', () => {
  it('simulates through the router, sends with an explicit gas limit, returns hash + explorer link', async () => {
    const { d, relayer, getRouterRelayer } = mk();
    const r = await handleRoute({ target: POCKET, data: '0x1234' }, '1.1.1.1', d);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, action: 'relay', env: 'prod', router: V4_INSTANCES.prod.router, txHash: HASH, status: 'success', gasLimit: '560000', blockNumber: '99' });
    expect(r.body.explorer).toBe('https://explore.qore.network/tx/' + 'ef'.repeat(32));
    expect(getRouterRelayer).toHaveBeenCalledWith('prod');
    expect(relayer.simulate).toHaveBeenCalledTimes(1);
    expect(relayer.send).toHaveBeenCalledWith(expect.stringMatching(/^0x/), 560_000n, `pd route prod relay ${getAddress(POCKET)}`);
    const sent = (relayer.send as any).mock.calls[0][0];
    expect(sent).toBe(encodeRouterCall({ target: getAddress(POCKET), data: '0x1234' }));
  });
  it('handles lazy Pocket deployment on the lab router and doubles the gas floor', async () => {
    const { d, relayer, getRouterRelayer } = mk({ estimate: vi.fn(async () => 100_000n) });
    const r = await handleRoute({ env: 'lab', pocket: pocketCfg(), data: '0x' }, '1.1.1.2', d);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ action: 'deployAndRelay', env: 'lab', router: V4_INSTANCES.lab.router, gasLimit: '700000' });
    expect(getRouterRelayer).toHaveBeenCalledWith('lab');
    expect(decodeFunctionData({ abi: routerAbi, data: (relayer.send as any).mock.calls[0][0] }).functionName).toBe('deployAndRelay');
  });
  it('answers 422 with the decoded custom error and sends nothing when the simulation reverts', async () => {
    const raw = encodeErrorResult({ abi: v4ErrorsAbi, errorName: 'BadSignature' });
    const { d, relayer } = mk({ simulate: vi.fn(async () => ({ ok: false as const, revert: decodeRevert(raw) })) });
    const r = await handleRoute({ target: POCKET, data: '0x1234' }, '1.1.1.3', d);
    expect(r.status).toBe(422);
    expect(r.body).toMatchObject({ ok: false, sent: false, error: { name: 'BadSignature', known: true } });
    expect(relayer.send).not.toHaveBeenCalled();
  });
  it('decodes v4 custom errors (router, vault, pool) with a human message', () => {
    for (const name of ['NotAllowed', 'Frozen', 'TooEarly', 'AlreadyClaimed', 'NotEnoughSigners', 'OverDailyLimit']) {
      const abiItem = v4ErrorsAbi.find((e) => e.name === name)!;
      const args = abiItem.inputs.length ? [ADDR] : [];
      const d = decodeRevert(encodeErrorResult({ abi: v4ErrorsAbi, errorName: name as any, args: args as any }));
      expect(d.name).toBe(name);
      expect(d.known).toBe(true);
      expect(d.message).not.toMatch(/^Contract error/);
    }
  });
  it('maps a closed relayer window to 503 and other send failures to 502, and a mined revert to 502', async () => {
    const win = mk({ send: vi.fn(async () => ({ ok: false as const, reason: 'window' as const, message: 'x' })) });
    expect((await handleRoute({ target: POCKET, data: '0x12' }, 'a', win.d)).status).toBe(503);
    const rpc = mk({ send: vi.fn(async () => ({ ok: false as const, reason: 'rpc' as const, message: 'down' })) });
    expect((await handleRoute({ target: POCKET, data: '0x12' }, 'b', rpc.d)).status).toBe(502);
    const rev = mk({ send: vi.fn(async () => ({ ok: true as const, hash: HASH, lane: 'evm' as const, status: 'reverted' as const, blockNumber: 1n, gasUsed: 1n })) });
    const r = await handleRoute({ target: POCKET, data: '0x12' }, 'c', rev.d);
    expect(r.status).toBe(502);
    expect(r.body).toMatchObject({ ok: false, error: { name: 'Reverted' }, txHash: HASH });
  });
  it('validates (400), accepts a JSON string, reports a missing relayer key (503), and rate limits (429)', async () => {
    const { d } = mk();
    expect((await handleRoute({ target: 'nope', data: '0x12' }, 'v1', d)).status).toBe(400);
    expect((await handleRoute('{bad', 'v2', d)).status).toBe(400);
    expect((await handleRoute(JSON.stringify({ target: POCKET, data: '0x12' }), 'v3', d)).status).toBe(200);
    expect((await handleRoute({ target: POCKET, data: '0x12' }, 'v4', mk({}, cfg({ relayerKey: null })).d)).status).toBe(503);
    const lim = mk();
    for (let i = 0; i < 20; i++) await handleRoute({ target: POCKET, data: '0x12' }, 'same-ip', lim.d);
    const r = await handleRoute({ target: POCKET, data: '0x12' }, 'same-ip', lim.d);
    expect(r.status).toBe(429);
    expect(r.headers?.['retry-after']).toBeDefined();
  });
});

describe('/rpc proxy: eth_* read calls', () => {
  it('lets read-only eth_* methods through and blocks sends and signing', () => {
    expect(checkRpcBody({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [] })).toMatchObject({ ok: true, evm: true });
    expect(checkRpcBody({ jsonrpc: '2.0', id: 1, method: 'status' })).toMatchObject({ ok: true });
    for (const m of ['eth_sendRawTransaction', 'eth_sendTransaction', 'personal_sign', 'eth_accounts']) {
      expect(checkRpcBody({ method: m })).toMatchObject({ ok: false, status: 403 });
    }
    expect(checkRpcBody([{ method: 'eth_call' }, { method: 'status' }])).toMatchObject({ ok: false, status: 400 });
  });
  it('forwards eth_* to the EVM host and CometBFT methods to the RPC host', async () => {
    const f = vi.fn(async () => new Response('{"result":"0x2648"}', { status: 200, headers: { 'content-type': 'application/json' } }));
    await proxyRequest({ method: 'POST', target: 'rpc', path: null, query: '', body: { jsonrpc: '2.0', id: 1, method: 'eth_chainId' } }, f as any);
    expect((f.mock.calls[0] as any)[0]).toBe('https://evm-testnet.qore.host/');
    await proxyRequest({ method: 'POST', target: 'rpc', path: null, query: '', body: { jsonrpc: '2.0', id: 1, method: 'status' } }, f as any);
    expect((f.mock.calls[1] as any)[0]).toBe('https://rpc-testnet.qore.host/');
  });
});

describe('v4 instances', () => {
  const file = path.resolve(__dirname, '..', '..', 'contracts-v4', 'deployments', 'diana.json');
  it.skipIf(!fs.existsSync(file))('match contracts-v4/deployments/diana.json', () => {
    const all = JSON.parse(fs.readFileSync(file, 'utf8'));
    const pairs = [['prod', all.v5_1.prod], ['lab', all.v5_1.lab], ['prodV5', all.v5.prod], ['labV5', all.v5.lab], ['prodV4', all.v4.prod], ['labV4', all.v4.lab]] as const;
    for (const [env, rec] of pairs) {
      for (const k of ['router', 'factory', 'drop', 'pool'] as const) {
        expect(V4_INSTANCES[env][k].toLowerCase()).toBe(rec[k].address.toLowerCase());
      }
    }
  });
});

describe('v5.1 bind feeTo', () => {
  const REL = '0xF6e6fb2d33Bef3043682658E2b69F3a2F8616cCD';
  const abi = [{ type: 'function', name: 'bind', stateMutability: 'nonpayable', outputs: [], inputs: [
    { name: 'linkId', type: 'uint256' }, { name: 'recipient', type: 'address' }, { name: 'recipientKeyHash', type: 'bytes32' },
    { name: 'payTo', type: 'address' }, { name: 'feeTo', type: 'address' }, { name: 'linkPk', type: 'bytes' }, { name: 'linkSig', type: 'bytes' }] }] as const;
  const bind = (feeTo: `0x${string}`) => encodeFunctionData({ abi, functionName: 'bind', args: [1n, REL, `0x${'11'.repeat(32)}`, REL, feeTo, '0x', '0x'] });
  it('the relayer submits a current-generation bind only when feeTo is the relayer', async () => {
    const { bindFeeToIssue } = await import('../src/route.js');
    const { V4_INSTANCES } = await import('../src/v4.js');
    expect(bindFeeToIssue('prod', V4_INSTANCES.prod.drop, bind(REL), REL)).toBeNull();
    expect(bindFeeToIssue('prod', V4_INSTANCES.prod.drop, bind('0x000000000000000000000000000000000000dEaD'), REL)).toMatch(/not to the relayer/);
    expect(bindFeeToIssue('lab', V4_INSTANCES.lab.drop, bind('0x000000000000000000000000000000000000dEaD'), REL)).toMatch(/not to the relayer/);
    // previous generations and other targets are not affected
    expect(bindFeeToIssue('prodV5', V4_INSTANCES.prodV5.drop, bind('0x000000000000000000000000000000000000dEaD'), REL)).toBeNull();
    expect(bindFeeToIssue('prod', V4_INSTANCES.prod.pool, bind('0x000000000000000000000000000000000000dEaD'), REL)).toBeNull();
  });
});

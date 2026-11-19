import { describe, expect, it, vi } from 'vitest';
import { getConfig } from '../src/config.js';
import { getHealth, getWindow, windowWarning } from '../src/health.js';
import { CORS, clientIp, gate, send, buildDeps } from '../src/http.js';
import { log, redact, setSink } from '../src/log.js';
import { cfg, hexBytes } from './helpers.js';

describe('config', () => {
  it('defaults and parsing', () => {
    const c = getConfig({});
    expect(c).toMatchObject({ contract: null, relayerKey: null, deployBlock: null, gasBind: 900_000n, gasClaim: 800_000n });
    const k = '11'.repeat(32);
    const c2 = getConfig({ POCKETDROP_ADDRESS: '0x' + '1'.repeat(40), RELAYER_SECP_KEY: k, POCKETDROP_DEPLOY_BLOCK: '12', GAS_BIND: '5', STATS_LOOKBACK_BLOCKS: 'x', UPSTASH_REDIS_REST_URL: 'u', UPSTASH_REDIS_REST_TOKEN: 't' });
    expect(c2).toMatchObject({ relayerKey: '0x' + k, deployBlock: 12n, gasBind: 5n, statsLookback: 150_000n, upstashUrl: 'u' });
    expect(getConfig({ POCKETDROP_ADDRESS: 'nope', RELAYER_SECP_KEY: 'zz', POCKETDROP_DEPLOY_BLOCK: 'q' })).toMatchObject({ contract: null, relayerKey: null, deployBlock: null });
    expect(getConfig({ RELAYER_SECP_KEY: '0x' + k }).relayerKey).toBe('0x' + k);
  });
});

describe('log redaction', () => {
  it('redacts secret-looking keys and long hex, stringifies bigint, keeps hashes', () => {
    const out = redact({ relayerKey: 'abc', linkSig: hexBytes(4627), note: hexBytes(2592), txHash: '0x12', linkId: 5n, nested: { token: 't', ok: 1 }, list: [1, 2], n: null }) as any;
    expect(out.relayerKey).toBe('[redacted]');
    expect(out.linkSig).toBe('[redacted]');
    expect(out.note).toBe('0x<2592B>');
    expect(out.txHash).toBe('0x12');
    expect(out.linkId).toBe('5');
    expect(out.nested).toEqual({ token: '[redacted]', ok: 1 });
    expect(redact(undefined)).toBeUndefined();
    expect(redact({ a: { b: { c: { d: { e: { f: 1 } } } } } })).toBeTruthy();
  });
  it('writes one JSON line per event', () => {
    const lines: string[] = [];
    setSink((l) => lines.push(l));
    log('info', 'x.y', { a: 1, secret: 's' });
    const j = JSON.parse(lines[0]);
    expect(j).toMatchObject({ level: 'info', event: 'x.y', a: 1, secret: '[redacted]' });
    setSink(() => {});
  });
  it('default sink writes to stdout', () => {
    const w = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    setSink((l) => process.stdout.write(l + '\n'));
    log('warn', 'e');
    expect(w).toHaveBeenCalled();
    w.mockRestore();
    setSink(() => {});
  });
});

describe('health', () => {
  const rest = (j: any, ok = true) => vi.fn(async () => ({ ok, status: ok ? 200 : 500, json: async () => j })) as any;
  it('reports relayer, balance and window state', async () => {
    const pub = { getBalance: vi.fn(async () => 5n * 10n ** 18n), getBlockNumber: vi.fn(async () => 99n) } as any;
    const h: any = await getHealth(cfg(), pub, rest({ found: true, live: true, remaining_blocks: '10', remaining_txs: '3', remaining_value: '100', max_value: '200', expiry_height: '9', allowed_targets: ['0x1'] }));
    expect(h).toMatchObject({ ok: true, network: 'diana-testnet', contract: cfg().contract, headBlock: '99', relayer: { balance: '5', unit: 'QOR' }, window: { live: true, remainingTxs: '3', remainingBlocks: '10' } });
    expect(h.relayer.cosmosAddress).toMatch(/^qor1/);
  });
  it('not ok when window closed, contract missing, rpc failing or key missing', async () => {
    const pub = { getBalance: vi.fn(async () => 1n), getBlockNumber: vi.fn(async () => 1n) } as any;
    expect((await getHealth(cfg(), pub, rest({ found: false, live: false }))).ok).toBe(false);
    expect((await getHealth(cfg({ contract: null }), pub, rest({ live: true }))).ok).toBe(false);
    const bad = { getBalance: vi.fn(async () => { throw new Error('x'); }), getBlockNumber: vi.fn(async () => { throw new Error('x'); }) } as any;
    const h: any = await getHealth(cfg(), bad, rest({ live: true }));
    expect(h).toMatchObject({ ok: false, headBlock: null, relayer: { balance: null } });
    expect(await getHealth(cfg({ relayerKey: null }), pub, rest({}))).toMatchObject({ ok: false, relayer: null });
  });
  it('window query failures are reported not thrown', async () => {
    expect(await getWindow(cfg(), 'qor1x', rest({}, false))).toMatchObject({ queryable: false, error: 'rest 500' });
    expect(await getWindow(cfg(), 'qor1x', (async () => { throw new Error('net'); }) as any)).toMatchObject({ queryable: false, error: 'net' });
    expect(await getWindow(cfg(), 'qor1x', (async () => { throw 's'; }) as any)).toMatchObject({ queryable: false, error: 's' });
    const pub = { getBalance: async () => 1n, getBlockNumber: async () => 1n } as any;
    expect((await getHealth(cfg(), pub, rest({ live: true }))).ok).toBe(true);
  });
});

describe('http helpers', () => {
  const mkRes = () => {
    const h: Record<string, string> = {};
    return { statusCode: 0, h, setHeader: (k: string, v: string) => { h[k] = v; }, body: '', end(b?: string) { this.body = b ?? ''; } } as any;
  };
  it('clientIp prefers x-forwarded-for, then x-real-ip, then socket', () => {
    expect(clientIp({ headers: { 'x-forwarded-for': '9.9.9.9, 1.1.1.1' }, socket: {} } as any)).toBe('9.9.9.9');
    expect(clientIp({ headers: { 'x-forwarded-for': ['8.8.8.8'] }, socket: {} } as any)).toBe('8.8.8.8');
    expect(clientIp({ headers: { 'x-real-ip': '7.7.7.7' }, socket: {} } as any)).toBe('7.7.7.7');
    expect(clientIp({ headers: { 'x-real-ip': ['6.6.6.6'] }, socket: {} } as any)).toBe('6.6.6.6');
    expect(clientIp({ headers: {}, socket: { remoteAddress: '5.5.5.5' } } as any)).toBe('5.5.5.5');
    expect(clientIp({ headers: {}, socket: undefined } as any)).toBe('unknown');
  });
  it('send sets status, CORS, json', () => {
    const res = mkRes();
    send(res, { status: 201, body: { a: 1 }, headers: { 'retry-after': '3' } });
    expect(res.statusCode).toBe(201);
    expect(res.h['access-control-allow-origin']).toBe(CORS['access-control-allow-origin']);
    expect(res.h['retry-after']).toBe('3');
    expect(JSON.parse(res.body)).toEqual({ a: 1 });
    const res2 = mkRes();
    send(res2, { status: 200, body: {} });
    expect(res2.h['content-type']).toMatch(/json/);
  });
  it('gate handles OPTIONS and wrong methods', () => {
    const r1 = mkRes();
    expect(gate({ method: 'OPTIONS' } as any, r1, 'POST')).toBe(true);
    expect(r1.statusCode).toBe(204);
    const r2 = mkRes();
    expect(gate({ method: 'GET' } as any, r2, 'POST')).toBe(true);
    expect(r2.statusCode).toBe(405);
    expect(r2.h.allow).toBe('POST');
    expect(gate({ method: 'POST' } as any, mkRes(), 'POST')).toBe(false);
  });
  it('buildDeps wires config, limiter, clients and a lazy relayer', () => {
    const d = buildDeps();
    expect(d.cfg).toBeTruthy();
    expect(d.limiter).toBeTruthy();
    expect(() => d.getRelayer()).toThrow(); // no key/contract in test env
  });
});

describe('windowWarning', () => {
  it('warns below 2000 blocks, on expiry, and stays quiet when healthy', () => {
    expect(windowWarning({ queryable: true, live: true, remainingBlocks: '1999' })).toMatchObject({ level: 'low' });
    expect(windowWarning({ queryable: true, live: true, remainingBlocks: '2000' })).toBeNull();
    expect(windowWarning({ queryable: true, live: false, remainingBlocks: '0' })).toMatchObject({ level: 'expired' });
    expect(windowWarning({ queryable: false })).toMatchObject({ level: 'unknown' });
  });
});

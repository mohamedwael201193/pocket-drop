import { describe, expect, it, vi } from 'vitest';
import { checkRestPath, checkRpcBody, proxyRequest, MAX_BATCH, MAX_BODY_BYTES } from '../src/proxy.js';

const okFetch = (body = '{"ok":1}', ct = 'application/json') => vi.fn(async () => new Response(body, { status: 200, headers: { 'content-type': ct } }));
const rest = (path: string | null, method = 'GET') => ({ method, target: 'rest', path, query: '', body: null });

describe('proxy allowlist', () => {
  it('allows tx_search and other listed rpc methods, rejects others', () => {
    for (const m of ['tx_search', 'status', 'broadcast_tx_sync', 'abci_query']) expect(checkRpcBody({ method: m }).ok).toBe(true);
    for (const m of ['unsafe_flush_mempool', 'dial_peers', 'net_info', '']) expect(checkRpcBody({ method: m })).toMatchObject({ ok: false, status: 403 });
    expect(checkRpcBody({})).toMatchObject({ ok: false, status: 403 });
    expect(checkRpcBody(null)).toMatchObject({ ok: false, status: 403 });
  });
  it('validates batches and bodies', () => {
    expect(checkRpcBody([{ method: 'status' }, { method: 'tx' }]).ok).toBe(true);
    expect(checkRpcBody([{ method: 'status' }, { method: 'dial_peers' }])).toMatchObject({ ok: false, status: 403 });
    expect(checkRpcBody([])).toMatchObject({ ok: false, status: 400 });
    expect(checkRpcBody(Array.from({ length: MAX_BATCH + 1 }, () => ({ method: 'status' })))).toMatchObject({ ok: false, status: 400 });
    expect(checkRpcBody('{bad')).toMatchObject({ ok: false, status: 400 });
    expect(checkRpcBody('x'.repeat(MAX_BODY_BYTES + 1))).toMatchObject({ ok: false, status: 413 });
    expect(checkRpcBody('{"method":"status"}').ok).toBe(true);
  });
  it('rest path allowlist and traversal protection', () => {
    expect(checkRestPath('cosmos/bank/v1beta1/balances/qor1abc')).toMatchObject({ ok: true, path: '/cosmos/bank/v1beta1/balances/qor1abc' });
    expect(checkRestPath('/qorechain/pqc/v1/evm_window/qor1abc').ok).toBe(true);
    for (const p of ['cosmos/staking/v1beta1/validators', 'cosmos/bank/v1beta1/balances/../../auth', 'cosmos/bank/v1beta1/balances/%2e%2e/x', 'cosmos/bank/v1beta1//balances/', 'cosmos/bank/v1beta1/balances/a\\b', '', 'cosmos/bank/v1beta1/balances/%3Fx'])
      expect(checkRestPath(p).ok, p).toBe(false);
    expect(checkRestPath(null).ok).toBe(false);
    expect(checkRestPath('cosmos/bank/v1beta1/balances/%E0%A4%A')).toMatchObject({ ok: false, status: 400 });
  });
});

describe('proxyRequest', () => {
  it('rejects unknown target and wrong methods', async () => {
    expect((await proxyRequest({ method: 'GET', target: 'x', path: null, query: '', body: null })).status).toBe(404);
    expect((await proxyRequest({ method: 'GET', target: 'rpc', path: null, query: '', body: null })).status).toBe(405);
    expect((await proxyRequest(rest('cosmos/bank/v1beta1/balances/x', 'POST'))).status).toBe(405);
  });
  it('forwards allowlisted rpc to the rpc host only', async () => {
    const f = okFetch();
    const r = await proxyRequest({ method: 'POST', target: 'rpc', path: null, query: '', body: { jsonrpc: '2.0', id: 1, method: 'tx_search', params: {} } }, f as any);
    expect(r.status).toBe(200);
    expect((f.mock.calls[0] as any)[0]).toBe('https://rpc-testnet.qore.host/');
  });
  it('blocks disallowed rpc without calling upstream', async () => {
    const f = okFetch();
    const r = await proxyRequest({ method: 'POST', target: 'rpc', path: null, query: '', body: { method: 'dial_peers' } }, f as any);
    expect(r.status).toBe(403);
    expect(f).not.toHaveBeenCalled();
  });
  it('forwards rest with query and blocks traversal', async () => {
    const f = vi.fn(async () => new Response('x', { status: 200 }));
    const r = await proxyRequest({ ...rest('cosmos/tx/v1beta1/txs/ABC'), query: 'a=1' }, f as any);
    expect((f.mock.calls[0] as any)[0]).toBe('https://api-testnet.qore.host/cosmos/tx/v1beta1/txs/ABC?a=1');
    expect(r.contentType).toBeTruthy();
    expect((await proxyRequest(rest('../etc'), f as any)).status).toBe(403);
  });
  it('returns 502 on upstream failure (Error and non-Error)', async () => {
    const e1 = await proxyRequest(rest('cosmos/tx/v1beta1/txs/A'), (async () => { throw new Error('down'); }) as any);
    expect(e1).toMatchObject({ status: 502 });
    const e2 = await proxyRequest(rest('cosmos/tx/v1beta1/txs/A'), (async () => { throw 'str'; }) as any);
    expect(e2.body).toContain('str');
  });
  it('passes rpc content-type through', async () => {
    const r = await proxyRequest({ method: 'POST', target: 'rpc', path: null, query: '', body: '{"method":"status"}' }, okFetch('{}', 'application/json; charset=utf-8') as any);
    expect(r.contentType).toContain('json');
  });
});

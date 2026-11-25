// Hits the DEPLOYED endpoints. Skipped unless PD_API_URL is set, e.g.
//   PD_API_URL=https://pocket-drop-api.vercel.app npx vitest run test/integration.test.ts
// Optional: PD_LINK_ID=<existing link id> to also check GET /api/link/:id.
import { describe, expect, it } from 'vitest';

const BASE = process.env.PD_API_URL?.replace(/\/$/, '');
const d = BASE ? describe : describe.skip;
const j = async (path: string, init?: RequestInit) => {
  const r = await fetch(BASE + path, init);
  return { status: r.status, body: (await r.json().catch(() => null)) as any, headers: r.headers };
};
const post = (path: string, body: unknown) => j(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

d('deployed API', () => {
  it('GET /api/health reports relayer, window, network', async () => {
    const { body, headers } = await j('/api/health');
    expect(body.network).toBe('diana-testnet');
    expect(body.relayer.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(body.window).toBeTruthy();
    expect(headers.get('access-control-allow-origin')).toBe('*');
    expect(JSON.stringify(body)).not.toMatch(/RELAYER_SECP_KEY|private/i);
  });
  it('POST /api/bind rejects malformed input with 400 and never sends', async () => {
    const { status, body } = await post('/api/bind', { linkId: '1' });
    expect(status).toBe(400);
    expect(body.error.name).toBe('ValidationError');
    expect(body.network).toBe('diana-testnet');
  });
  it('POST /api/claim rejects malformed input', async () => {
    expect((await post('/api/claim', { linkId: 'x', recipientSig: '0x00' })).status).toBe(400);
  });
  it('GET on POST endpoints is 405; OPTIONS is 204', async () => {
    expect((await j('/api/bind')).status).toBe(405);
    expect((await fetch(BASE + '/api/bind', { method: 'OPTIONS' })).status).toBe(204);
  });
  it('/rpc proxies allowlisted methods and blocks others', async () => {
    const ok = await post('/rpc', { jsonrpc: '2.0', id: 1, method: 'status', params: [] });
    expect(ok.status).toBe(200);
    expect(ok.body.result.node_info.network).toBe('qorechain-diana');
    const r = await fetch(BASE + '/rpc', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method: 'dial_peers' }) });
    expect(r.status).toBe(403);
  });
  it('/rest/* proxies allowlisted paths and blocks others', async () => {
    expect((await j('/rest/cosmos/base/tendermint/v1beta1/node_info')).status).toBe(200);
    expect((await fetch(BASE + '/rest/cosmos/staking/v1beta1/validators')).status).toBe(403);
  });
  it('GET /api/stats responds (200 once the contract is configured, else 503)', async () => {
    const { status, body } = await j('/api/stats');
    expect([200, 503]).toContain(status);
    expect(body.network).toBe('diana-testnet');
    if (status === 200) expect(body.counts).toBeTruthy();
  });
  it('GET /api/link/abc is 400', async () => {
    expect((await j('/api/link/abc')).status).toBe(400);
  });
  (process.env.PD_LINK_ID ? it : it.skip)('GET /api/link/:id for a known link', async () => {
    const { status, body } = await j('/api/link/' + process.env.PD_LINK_ID);
    expect(status).toBe(200);
    expect(body.link.id).toBe(process.env.PD_LINK_ID);
  });
});

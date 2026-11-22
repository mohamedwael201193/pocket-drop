import { beforeEach, describe, expect, it } from 'vitest';
import { hybridSignBytes, pqcVerify } from '@qorechain/sdk';
import { TxBody, TxRaw } from 'cosmjs-types/cosmos/tx/v1beta1/tx';
import { encodeFunctionData, parseAbi } from 'viem';
import { handlePqSign, macOf, resetSignerState } from '../src/pqSignerHandler.js';
import { crossVmParts, pqKeyFor, relayerAddressOf } from '../src/pqSplit.js';
import { pqRemote, pqSignMac, splitSigner } from '../src/hybridRelayer.js';
import { getConfig } from '../src/config.js';
import * as signerMod from '../src/sponsorSigner.js';

const SECP = '11'.repeat(32), SEED = '22'.repeat(32), HMAC = 'k'.repeat(40);
const me = relayerAddressOf(SECP);
const ENV = { RELAYER_PQC_SEED: SEED, PQ_SIGNER_HMAC: HMAC, RELAYER_COSMOS: me.cosmos, RELAYER_PUBKEY: Buffer.from(me.pubkey).toString('hex') };
const ROUTER = '0xb0d8fd2379e06ed5d48371b41baa6dd0a31cf209';
const relay = encodeFunctionData({ abi: parseAbi(['function relay(address target, bytes data) returns (bytes)']), functionName: 'relay', args: ['0x0000000000000000000000000000000000000001', '0x'] });
const IN = { secp: SECP, contract: ROUTER, data: relay, memo: 'pd route prod relay 0x01', gas: 900_000n, feeUqor: '120000', accountNumber: 7n, sequence: 42n, version: 'v2' as const };
const NOW = 1_800_000_000_000;
const post = (body: string, o: { ts?: string; mac?: string } = {}, env: Record<string, string> = ENV, now = NOW) => {
  const ts = o.ts ?? String(Math.floor(now / 1000));
  return handlePqSign({ method: 'POST', headers: { 'x-pd-ts': ts, 'x-pd-mac': o.mac ?? macOf(HMAC, ts, body) }, body }, env, now);
};
const reqOf = (o: Partial<typeof IN> = {}) => { const p = crossVmParts({ ...IN, ...o }); return JSON.stringify({ b0: p.b0, authInfo: p.authInfo, chainId: p.chainId, version: p.version }); };

beforeEach(() => resetSignerState());

describe('isolated PQ signer', () => {
  it('publishes only public facts', () => {
    const r = handlePqSign({ method: 'GET', headers: {}, body: '' }, ENV, NOW);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ relayer: me.cosmos, targets: expect.arrayContaining([ROUTER]) });
    expect(JSON.stringify(r.body)).not.toContain(SEED);
    expect(r.body.pqPublicKeyKeccak).toMatch(/^0x[0-9a-f]{64}$/);
  });
  it('signs an allowed relay; the signature verifies against the relayer PQ key', () => {
    const body = reqOf();
    const r = post(body);
    expect(r.status).toBe(200);
    const q = JSON.parse(body);
    const msg = hybridSignBytes('v2', q.chainId, Buffer.from(q.b0, 'base64'), Buffer.from(q.authInfo, 'base64'));
    expect(pqcVerify(pqKeyFor(SEED, me.cosmos).publicKey, msg, Buffer.from(String(r.body.signature), 'base64'))).toBe(true);
  });
  it('refuses a bad MAC, a stale timestamp, a policy breach, and when unconfigured', () => {
    const body = reqOf();
    expect(post(body, { mac: 'ab'.repeat(32) }).status).toBe(401);
    expect(post(body, { ts: String(Math.floor(NOW / 1000) - 600) }).status).toBe(401);
    expect(post(body.replace('"v2"', '"v1"'), { mac: macOf(HMAC, String(Math.floor(NOW / 1000)), body) }).status).toBe(401); // body changed after MAC
    const off = post(reqOf({ contract: '0x0000000000000000000000000000000000000bad' }));
    expect(off.status).toBe(403);
    expect(off.body.error).toMatch(/target/);
    expect(post(reqOf({ feeUqor: '900000' })).status).toBe(403);
    expect(post(body, {}, { ...ENV, RELAYER_PQC_SEED: '' }).status).toBe(503);
    expect(handlePqSign({ method: 'PUT', headers: {}, body: '' }, ENV, NOW).status).toBe(405);
  });
  it('stops at the hourly budget', () => {
    const env = { ...ENV, PQ_SIGNER_MAX_PER_HOUR: '2' };
    expect(post(reqOf(), {}, env).status).toBe(200);
    expect(post(reqOf(), {}, env).status).toBe(200);
    expect(post(reqOf(), {}, env).status).toBe(429);
  });
});

describe('API side with the isolated signer', () => {
  it('signs a relay in two halves; the tx carries a valid ML-DSA-87 extension and a 64-byte secp256k1 signature', async () => {
    // the fetch goes straight to the signer core
    const f = (async (_url: string, init: RequestInit) => {
      const h = init.headers as Record<string, string>;
      const r = handlePqSign({ method: 'POST', headers: { 'x-pd-ts': h['x-pd-ts'], 'x-pd-mac': h['x-pd-mac'] }, body: String(init.body) }, ENV, Date.now());
      return new Response(JSON.stringify(r.body), { status: r.status });
    }) as never;
    expect(pqSignMac(HMAC, '1', 'x')).toBe(macOf(HMAC, '1', 'x'));
    const split = await splitSigner(pqRemote('https://signer.invalid/api/pq-sign', HMAC, f), 'http://rest.invalid', async () => ({ ...signerMod, signBytesVersion: async () => 'v2' as const }))();
    const out = await split.signCrossVm({ secp: SECP, pqc: '0x' as never, rest: '', contract: ROUTER, data: relay, memo: IN.memo, gas: '900000', feeUqor: '120000', accountNumber: 7n, sequence: 42n });
    expect(out.from).toBe(me.cosmos);
    const raw = TxRaw.decode(Buffer.from(out.txBytes, 'base64'));
    const body = TxBody.decode(raw.bodyBytes);
    expect(body.extensionOptions).toHaveLength(1);
    expect(body.memo).toBe(IN.memo);
    expect(raw.signatures[0]).toHaveLength(64);
  });
  it('config: hybrid mode with only the isolated signer, and the URL must be https', () => {
    const c = getConfig({ RELAYER_SECP_KEY: SECP, PQ_SIGNER_URL: 'https://x.example/api/pq-sign', PQ_SIGNER_HMAC: HMAC });
    expect(c).toMatchObject({ relayMode: 'hybrid', relayerPqc: null, pqSignerUrl: 'https://x.example/api/pq-sign' });
    expect(getConfig({ RELAYER_SECP_KEY: SECP, PQ_SIGNER_URL: 'http://x.example', PQ_SIGNER_HMAC: HMAC }).relayMode).toBe('evm');
    expect(getConfig({ RELAYER_SECP_KEY: SECP, PQ_SIGNER_URL: 'https://x.example', PQ_SIGNER_HMAC: 'short' }).relayMode).toBe('evm');
  });
});

// The isolated ML-DSA-87 signer for relays (deployed as its own Vercel project, see signer/README.md). It holds ONLY the
// relayer's PQ seed; the API holds only the secp256k1 key. It signs one thing: the hybrid sign bytes of a single
// MsgCrossVMCall from our relayer into the two routers or the v3 drop, with an allowed selector, a bounded fee and gas,
// and a "pd " memo (pqSplit.checkPolicy). Requests are authenticated with HMAC-SHA256 over "<unix ts>.<body>" (+-120 s).
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { getNetwork } from '@qorechain/sdk';
import { PolicyError, pqKeyFor, pqSign, type PqPolicy, type PqSignRequest } from './pqSplit.js';

export const TARGETS = [
  '0x13b8e379e50da657b943781d2816fc17473ae376', // PocketRouter v5, production
  '0x6de5f7d06e5a4c9563d405b39c192d8d2de1be75', // PocketRouter v5, lab
  '0xb0d8fd2379e06ed5d48371b41baa6dd0a31cf209', // PocketRouter v4, production
  '0x0b4ee3c8a7a63716c5700b2711ad57a461b7ac2d', // PocketRouter, lab
  '0x29f53b4b8031e7ba1785dc8c7a1c0be413a4bd97', // PocketDrop v3
];
export const SELECTORS = [
  '0xc28e83fd', // relay(address,bytes)
  '0xbad867c0', // deployAndRelay(...)
  '0x88d7fcfe', // v3 bind
  '0x38926b6d', // v3 claim
];
export const MAX_FEE_UQOR = 600_000n;
export const MAX_GAS = 4_000_000n;
export const SKEW_SEC = 120;

type Env = Record<string, string | undefined>;
export interface SignerResult { status: number; body: Record<string, unknown> }

const hexOk = (v: string | undefined, n: number) => !!v && new RegExp(`^(0x)?[0-9a-fA-F]{${n * 2}}$`).test(v.trim());
let keyCache: { seed: string; relayer: string; key: ReturnType<typeof pqKeyFor> } | null = null;
const hour = { start: 0, n: 0 };

export function policyFrom(env: Env): PqPolicy | null {
  const relayer = env.RELAYER_COSMOS?.trim().toLowerCase();
  const pub = env.RELAYER_PUBKEY?.trim().replace(/^0x/, '').toLowerCase();
  if (!relayer || !/^qor1[0-9a-z]{38}$/.test(relayer) || !pub || !/^0[23][0-9a-f]{64}$/.test(pub)) return null;
  return { relayer, relayerPubkey: pub, targets: TARGETS, selectors: SELECTORS, chainId: getNetwork('testnet').chainId, maxFeeUqor: MAX_FEE_UQOR, maxGas: MAX_GAS };
}

export const macOf = (key: string, ts: string, body: string) => createHmac('sha256', key).update(`${ts}.${body}`).digest('hex');

/** Pure core, so the tests drive it without HTTP. */
export function handlePqSign(req: { method: string; headers: Record<string, string | undefined>; body: string }, env: Env, now = Date.now()): SignerResult {
  const pol = policyFrom(env);
  const seed = env.RELAYER_PQC_SEED?.trim();
  const hmac = env.PQ_SIGNER_HMAC?.trim();
  if (!pol || !hexOk(seed, 32) || !hmac || hmac.length < 32) return { status: 503, body: { ok: false, error: 'signer not configured' } };
  if (!keyCache || keyCache.seed !== seed || keyCache.relayer !== pol.relayer) keyCache = { seed: seed!, relayer: pol.relayer, key: pqKeyFor(seed!.replace(/^0x/, ''), pol.relayer) };
  const pkHash = `0x${Buffer.from(keccak_256(keyCache.key.publicKey)).toString('hex')}`;
  const max = Number(env.PQ_SIGNER_MAX_PER_HOUR ?? 600) || 600;
  if (now - hour.start > 3_600_000) { hour.start = now; hour.n = 0; }

  if (req.method === 'GET') {
    // public facts only: which relayer, which PQ public key (hash), what it will sign
    return { status: 200, body: { ok: true, role: 'isolated ML-DSA-87 relay signer', relayer: pol.relayer, pqPublicKeyKeccak: pkHash, targets: TARGETS, selectors: SELECTORS, maxFeeUqor: MAX_FEE_UQOR.toString(), maxGas: MAX_GAS.toString(), signedThisHour: hour.n, maxPerHour: max } };
  }
  if (req.method !== 'POST') return { status: 405, body: { ok: false, error: 'POST only' } };
  const ts = req.headers['x-pd-ts'] ?? '', mac = req.headers['x-pd-mac'] ?? '';
  if (!/^\d{9,11}$/.test(ts) || Math.abs(now / 1000 - Number(ts)) > SKEW_SEC) return { status: 401, body: { ok: false, error: 'stale or missing timestamp' } };
  const want = Buffer.from(macOf(hmac, ts, req.body), 'hex'), got = Buffer.from(/^[0-9a-f]{64}$/.test(mac) ? mac : '', 'hex');
  if (got.length !== want.length || !timingSafeEqual(got, want)) return { status: 401, body: { ok: false, error: 'bad mac' } };
  if (hour.n >= max) return { status: 429, body: { ok: false, error: 'hourly signing budget used' } };
  let r: PqSignRequest;
  try { r = JSON.parse(req.body) as PqSignRequest; } catch { return { status: 400, body: { ok: false, error: 'bad json' } }; }
  if (typeof r?.b0 !== 'string' || typeof r?.authInfo !== 'string' || typeof r?.chainId !== 'string' || r.b0.length > 20_000 || r.authInfo.length > 2_000) return { status: 400, body: { ok: false, error: 'bad request' } };
  try {
    const { signature, checked } = pqSign(r, pol, keyCache.key);
    hour.n++;
    console.log(JSON.stringify({ level: 'info', event: 'pq.signed', target: checked.target, selector: checked.selector, memo: checked.memo.slice(0, 80), feeUqor: checked.feeUqor.toString(), gas: checked.gas.toString() }));
    return { status: 200, body: { ok: true, signature, pqPublicKeyKeccak: pkHash } };
  } catch (e) {
    if (e instanceof PolicyError) { console.log(JSON.stringify({ level: 'warn', event: 'pq.refused', reason: e.message })); return { status: 403, body: { ok: false, error: e.message } }; }
    return { status: 500, body: { ok: false, error: 'signing failed' } };
  }
}
export const resetSignerState = () => { keyCache = null; hour.start = 0; hour.n = 0; };

/** Vercel Node adapter. Reads the raw body itself (the MAC covers the exact bytes). */
export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const chunks: Buffer[] = [];
  let size = 0;
  if (req.method === 'POST') for await (const c of req) { size += (c as Buffer).length; if (size > 64_000) { res.statusCode = 413; res.end(); return; } chunks.push(c as Buffer); }
  const h = (k: string) => { const v = req.headers[k]; return Array.isArray(v) ? v[0] : v; };
  const out = handlePqSign({ method: req.method ?? 'GET', headers: { 'x-pd-ts': h('x-pd-ts'), 'x-pd-mac': h('x-pd-mac') }, body: Buffer.concat(chunks).toString('utf8') }, process.env);
  res.statusCode = out.status;
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(out.body));
}

import type { IncomingMessage, ServerResponse } from 'node:http';
import { getConfig } from './config.js';
import { reply, type Deps, type HttpResult } from './handlers.js';
import { getLimiter } from './ratelimit.js';
import { createRelayer, makePublicClient, type Relayer } from './relayer.js';

export type Req = IncomingMessage & { body?: unknown; query?: Record<string, string | string[] | undefined> };

export function clientIp(req: Pick<IncomingMessage, 'headers' | 'socket'>): string {
  const xf = req.headers['x-forwarded-for'];
  const first = (Array.isArray(xf) ? xf[0] : xf)?.split(',')[0]?.trim();
  const real = req.headers['x-real-ip'];
  return first || (Array.isArray(real) ? real[0] : real) || req.socket?.remoteAddress || 'unknown';
}

export const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type',
  'cache-control': 'no-store',
};

export function send(res: ServerResponse, r: HttpResult) {
  res.statusCode = r.status;
  for (const [k, v] of Object.entries({ ...CORS, ...(r.headers ?? {}) })) res.setHeader(k, v);
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(r.body));
}

/** Handle CORS preflight and method gating. Returns true if the request was fully answered. */
export function gate(req: Req, res: ServerResponse, method: 'GET' | 'POST'): boolean {
  if (req.method === 'OPTIONS') { res.statusCode = 204; for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v); res.end(); return true; }
  if (req.method !== method) { send(res, { ...reply(405, { ok: false, error: { name: 'MethodNotAllowed', message: `Use ${method}.` } }), headers: { allow: method } }); return true; }
  return false;
}

let relayerCache: Relayer | null = null;
export function buildDeps(): Deps {
  const cfg = getConfig();
  const pub = makePublicClient(cfg);
  return { cfg, limiter: getLimiter(), pub, getRelayer: () => (relayerCache ??= createRelayer(cfg, { pub })) };
}

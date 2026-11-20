import type { ServerResponse } from 'node:http';

import { buildRouteDeps, clientIp, send, CORS, type Req } from '../src/http.js';
import { reply } from '../src/handlers.js';
import { getQday, handleAttempt, makeChain } from '../src/qday.js';
import { makePublicClient } from '../src/relayer.js';
import { RULES } from '../src/ratelimit.js';
import { log } from '../src/log.js';

/** GET /api/qday: live drill state. POST /api/qday: put one bait attempt on chain through the relayer (rate-limited). */
export default async function handler(req: Req, res: ServerResponse) {
  if (req.method === 'OPTIONS') { res.statusCode = 204; for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v); res.end(); return; }
  const d = buildRouteDeps();
  if (req.method === 'GET') {
    const rl = await d.limiter.hit('qday:read', clientIp(req), RULES.readIp);
    if (!rl.ok) return send(res, reply(429, { ok: false, error: { name: 'RateLimited', message: 'Too many requests.' } }));
    try { send(res, { status: 200, body: await getQday(makeChain(makePublicClient(d.cfg), d.cfg), process.env) }); }
    catch (e) { log('error', 'qday.failed', { message: e instanceof Error ? e.message : String(e) }); send(res, reply(502, { ok: false, error: { name: 'ReadFailed', message: 'Could not read the drill state.' } })); }
    return;
  }
  if (req.method === 'POST') {
    if (!d.cfg.relayerKey) return send(res, reply(503, { ok: false, error: { name: 'NotConfigured', message: 'RELAYER_SECP_KEY is not configured.' } }));
    return send(res, await handleAttempt(req.body, clientIp(req), { cfg: d.cfg, limiter: d.limiter, relayer: d.getRouterRelayer('prod'), env: process.env, botToken: process.env.QDAY_BOT_TOKEN?.trim() || null }));
  }
  send(res, reply(405, { ok: false, error: { name: 'MethodNotAllowed', message: 'Use GET or POST.' } }));
}


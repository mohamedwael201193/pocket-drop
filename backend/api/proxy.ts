import type { ServerResponse } from 'node:http';
import { clientIp, CORS, send, type Req } from '../src/http.js';
import { reply } from '../src/handlers.js';
import { getLimiter, RULES } from '../src/ratelimit.js';
import { proxyRequest } from '../src/proxy.js';

// /rpc  -> /api/proxy?t=rpc          /rest/<path> -> /api/proxy?t=rest&p=<path>   (see vercel.json)
export default async function handler(req: Req, res: ServerResponse) {
  if (req.method === 'OPTIONS') { res.statusCode = 204; for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v); return void res.end(); }
  const rl = await getLimiter().hit('proxy:ip', clientIp(req), RULES.proxyIp);
  if (!rl.ok) return send(res, reply(429, { ok: false, error: { name: 'RateLimited', message: 'Too many requests.' } }, { 'retry-after': String(rl.retryAfterSec) }));
  const u = new URL(req.url ?? '/', 'http://x');
  const target = u.searchParams.get('t');
  const path = u.searchParams.get('p');
  u.searchParams.delete('t'); u.searchParams.delete('p');
  const r = await proxyRequest({ method: req.method ?? 'GET', target, path, query: u.searchParams.toString(), body: req.body });
  res.statusCode = r.status;
  for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v);
  res.setHeader('content-type', r.contentType);
  res.end(r.body);
}

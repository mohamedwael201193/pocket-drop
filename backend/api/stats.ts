import type { ServerResponse } from 'node:http';
import { buildDeps, clientIp, gate, send, type Req } from '../src/http.js';
import { reply } from '../src/handlers.js';
import { RULES } from '../src/ratelimit.js';
import { getStats, loadOwnAccounts } from '../src/stats.js';
import { log } from '../src/log.js';

export default async function handler(req: Req, res: ServerResponse) {
  if (gate(req, res, 'GET')) return;
  const d = buildDeps();
  const rl = await d.limiter.hit('stats:ip', clientIp(req), RULES.statsIp);
  if (!rl.ok) return send(res, reply(429, { ok: false, error: { name: 'RateLimited', message: 'Too many requests.' } }, { 'retry-after': String(rl.retryAfterSec) }));
  try {
    const r = await getStats(d.pub as any, d.cfg, loadOwnAccounts());
    if (!r.ok) return send(res, reply(r.status, { ok: false, error: { name: 'NotConfigured', message: r.error } }));
    send(res, { status: 200, body: { ok: true, ...(r.value as object) } });
  } catch (e) {
    log('error', 'stats.failed', { message: e instanceof Error ? e.message : String(e) });
    send(res, reply(502, { ok: false, error: { name: 'IndexFailed', message: 'Could not read chain logs.' } }));
  }
}

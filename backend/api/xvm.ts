import type { ServerResponse } from 'node:http';
import { buildDeps, clientIp, gate, send, type Req } from '../src/http.js';
import { reply } from '../src/handlers.js';
import { RULES } from '../src/ratelimit.js';
import { log } from '../src/log.js';
import { eventsOf, hybridRelays, jsonSafe } from '../src/xvm.js';
import { linkReader } from '../src/xvmLive.js';
import { V4_ENVS, type V4Env } from '../src/v4.js';

/** GET /api/xvm?env=prod|lab|prodV4|labV4 (prod/lab = current v5, *V4 = previous v4): every hybrid relay (MsgCrossVMCall into the PocketRouter) decoded, and the events it stands for. */
export default async function handler(req: Req, res: ServerResponse) {
  if (gate(req, res, 'GET')) return;
  const d = buildDeps();
  const rl = await d.limiter.hit('stats:ip', clientIp(req), RULES.statsIp);
  if (!rl.ok) return send(res, reply(429, { ok: false, error: { name: 'RateLimited', message: 'Too many requests.' } }, { 'retry-after': String(rl.retryAfterSec) }));
  const q = req.query?.env ?? new URL(req.url ?? '/', 'http://x').searchParams.get('env');
  const env = q === undefined || q === null ? 'prod' : (V4_ENVS as string[]).includes(String(q)) ? (String(q) as V4Env) : null;
  if (!env) return send(res, reply(400, { ok: false, error: { name: 'ValidationError', message: 'env must be prod, lab, prodV4 or labV4.' } }));
  try {
    const relays = await hybridRelays(env, d.cfg.rest);
    const events = await eventsOf(env, relays, new Set(), linkReader(d.pub as never));
    send(res, { status: 200, body: jsonSafe({ ok: true, env, count: relays.length, relays, events, note: 'A MsgCrossVMCall leaves no EVM log. These are the successful cross-VM calls into the PocketRouter, found on the native lane (crossvm_request event), decoded from their calldata and return value; claim recipients and cancel refunds are read from contract state.' }) as Record<string, unknown>, headers: { 'cache-control': 'public, s-maxage=10' } });
  } catch (e) {
    log('error', 'xvm.failed', { message: e instanceof Error ? e.message : String(e) });
    send(res, reply(502, { ok: false, error: { name: 'IndexFailed', message: 'Could not read the native-lane index.' } }));
  }
}

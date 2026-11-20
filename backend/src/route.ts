import { encodeFunctionData, type Address, type Hex } from 'viem';
import { routerAbi } from './abi4.js';
import { EXPLORER_TX, type Config } from './config.js';
import { log } from './log.js';
import { RULES, type Limiter } from './ratelimit.js';
import type { Relayer } from './relayer.js';
import { reply, type HttpResult } from './handlers.js';
import { V4_INSTANCES, type V4Env } from './v4.js';
import { formatIssues, routeSchema } from './validation.js';
import { noteRouteRefusal } from './qday.js';

export interface RouteDeps {
  cfg: Config;
  limiter: Limiter;
  /** The relayer bound to the PocketRouter of `env` (its window is scoped to the routers). */
  getRouterRelayer: (env: V4Env) => Relayer;
}

interface EncodeInput {
  target?: Address;
  pocket?: { owner: Address; guardians: Address[]; threshold: number; dailyLimit: bigint; userSalt: Hex };
  data: Hex;
}

/** Router calldata for a validated request. */
export function encodeRouterCall(v: EncodeInput): Hex {
  if (v.pocket) {
    const p = v.pocket;
    return encodeFunctionData({ abi: routerAbi, functionName: 'deployAndRelay', args: [p.owner, p.guardians, p.threshold, p.dailyLimit, p.userSalt, v.data] });
  }
  return encodeFunctionData({ abi: routerAbi, functionName: 'relay', args: [v.target as Address, v.data] });
}

/** Gas limit = clamp(estimate * pct, min, max); the cap applies when the node cannot estimate. */
export function pickGas(cfg: Pick<Config, 'gasRouteMin' | 'gasRouteMax' | 'gasRoutePct'>, estimate: bigint | null, lazy: boolean): bigint {
  const floor = lazy ? cfg.gasRouteMin * 2n : cfg.gasRouteMin;
  if (estimate === null) return cfg.gasRouteMax;
  const g = (estimate * cfg.gasRoutePct) / 100n;
  return g < floor ? floor : g > cfg.gasRouteMax ? cfg.gasRouteMax : g;
}

const notConfigured = (what: string) => reply(503, { ok: false, error: { name: 'NotConfigured', message: `${what} is not configured on this deployment yet.` } });

/**
 * POST /api/route: relay a user-signed Pocket intent through PocketRouter.
 * rate limit, validate (zod), simulate with eth_call through the router (422 plus the decoded custom error, nothing sent),
 * then send with an explicit gas limit and wait for the receipt. The relayer only pays gas and holds no user key. The router
 * forwards only to factory Pockets, PocketDrop and DropPool, so authority always comes from the ML-DSA signatures inside `data`.
 */
export async function handleRoute(rawBody: unknown, ip: string, d: RouteDeps): Promise<HttpResult> {
  const ipHit = await d.limiter.hit('route:ip', ip, RULES.routeIp);
  if (!ipHit.ok) return reply(429, { ok: false, error: { name: 'RateLimited', message: `Too many requests. Retry in ${ipHit.retryAfterSec}s.` } }, { 'retry-after': String(ipHit.retryAfterSec) });

  let body = rawBody;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { return reply(400, { ok: false, error: { name: 'InvalidJson', message: 'Body is not valid JSON.' } }); } }
  const parsed = routeSchema.safeParse(body);
  if (!parsed.success) return reply(400, { ok: false, error: { name: 'ValidationError', message: 'Invalid request.', issues: formatIssues(parsed.error) } });
  const v = parsed.data;

  const key = (v.pocket ? `p:${v.pocket.owner}` : `t:${v.target}`).toLowerCase();
  const tHit = await d.limiter.hit('route:target', key, RULES.routeTarget);
  if (!tHit.ok) return reply(429, { ok: false, error: { name: 'RateLimited', message: `Too many requests for this Pocket. Retry in ${tHit.retryAfterSec}s.` } }, { 'retry-after': String(tHit.retryAfterSec) });

  if (!d.cfg.relayerKey) return notConfigured('RELAYER_SECP_KEY');
  const router = V4_INSTANCES[v.env].router;
  const data = encodeRouterCall(v);
  const relayer = d.getRouterRelayer(v.env);
  const action = v.pocket ? 'deployAndRelay' : 'relay';

  const sim = await relayer.simulate(data);
  if (!sim.ok) {
    log('warn', 'route.simulate_revert', { env: v.env, action, error: sim.revert.name });
    if (v.env === 'prod') noteRouteRefusal(data, router, sim.revert.name);
    return reply(422, {
      ok: false, sent: false, env: v.env, action,
      error: { name: sim.revert.name, message: sim.revert.message, selector: sim.revert.selector, known: sim.revert.known, args: sim.revert.args?.map((a) => (typeof a === 'bigint' ? a.toString() : a)) },
      hint: 'Simulated with eth_call through the router before sending; nothing was submitted.',
    });
  }

  const est = relayer.estimate ? await relayer.estimate(data) : null;
  const gas = pickGas(d.cfg, est, !!v.pocket);
  const sent = await relayer.send(data, gas);
  if (!sent.ok) {
    log('error', 'route.send_failed', { env: v.env, action, reason: sent.reason, message: sent.message });
    if (sent.reason === 'window') {
      return reply(503, { ok: false, error: { name: 'RelayerWindowUnavailable', message: 'The relayer EVM authorisation window is closed or exhausted. The operator must renew it (scripts/renew-window.mjs). Nothing was submitted.' } }, { 'retry-after': '60' });
    }
    return reply(502, { ok: false, error: { name: 'SendFailed', message: sent.message } });
  }
  log(sent.status === 'success' ? 'info' : 'error', 'route.done', { env: v.env, action, txHash: sent.hash, status: sent.status, gasUsed: sent.gasUsed.toString() });
  const out = { action, env: v.env, router, txHash: sent.hash, status: sent.status, blockNumber: sent.blockNumber.toString(), gasUsed: sent.gasUsed.toString(), gasLimit: gas.toString(), explorer: EXPLORER_TX + sent.hash.replace(/^0x/, '') };
  return sent.status === 'success'
    ? reply(200, { ok: true, ...out })
    : reply(502, { ok: false, ...out, error: { name: 'Reverted', message: 'Transaction was mined but reverted.' } });
}

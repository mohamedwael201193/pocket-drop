// Rate limiting for serverless.
//
// Default: in-memory fixed window per (bucket, key). On Vercel every warm function instance has its OWN memory,
// so the effective limit is "per instance": a determined client hitting many cold instances can exceed it.
// If UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are set, a shared Upstash counter is used instead
// (fail-open to in-memory if Upstash errors). The relayer window cap and the contract are the hard bounds;
// this is abuse friction, not a security boundary.

export interface Rule { limit: number; windowSec: number }
export interface RateResult { ok: boolean; remaining: number; retryAfterSec: number }
export interface Limiter { hit(bucket: string, key: string, rule: Rule): Promise<RateResult> }

export const RULES = {
  bindIp: { limit: 10, windowSec: 60 },
  bindLink: { limit: 6, windowSec: 600 },
  claimIp: { limit: 10, windowSec: 60 },
  claimLink: { limit: 6, windowSec: 600 },
  readIp: { limit: 120, windowSec: 60 },
  statsIp: { limit: 20, windowSec: 60 },
  proxyIp: { limit: 300, windowSec: 60 },
} satisfies Record<string, Rule>;

export class MemoryLimiter implements Limiter {
  private store = new Map<string, { count: number; resetAt: number }>();
  constructor(private now: () => number = Date.now, private maxKeys = 5000) {}

  async hit(bucket: string, key: string, rule: Rule): Promise<RateResult> {
    const t = this.now();
    const id = `${bucket}:${key}`;
    let e = this.store.get(id);
    if (!e || e.resetAt <= t) {
      if (this.store.size >= this.maxKeys) this.sweep(t);
      e = { count: 0, resetAt: t + rule.windowSec * 1000 };
      this.store.set(id, e);
    }
    e.count += 1;
    const ok = e.count <= rule.limit;
    return { ok, remaining: Math.max(0, rule.limit - e.count), retryAfterSec: ok ? 0 : Math.max(1, Math.ceil((e.resetAt - t) / 1000)) };
  }

  private sweep(t: number) {
    for (const [k, v] of this.store) if (v.resetAt <= t) this.store.delete(k);
    if (this.store.size >= this.maxKeys) this.store.clear();
  }
}

export class UpstashLimiter implements Limiter {
  constructor(
    private url: string,
    private token: string,
    private fallback: Limiter,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  async hit(bucket: string, key: string, rule: Rule): Promise<RateResult> {
    const k = `pd:rl:${bucket}:${key}:${Math.floor(Date.now() / (rule.windowSec * 1000))}`;
    try {
      const r = await this.fetchImpl(`${this.url.replace(/\/$/, '')}/pipeline`, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
        body: JSON.stringify([['INCR', k], ['EXPIRE', k, String(rule.windowSec)]]),
      });
      if (!r.ok) throw new Error(`upstash ${r.status}`);
      const j = (await r.json()) as { result?: unknown }[];
      const count = Number(j?.[0]?.result);
      if (!Number.isFinite(count)) throw new Error('upstash bad reply');
      const ok = count <= rule.limit;
      return { ok, remaining: Math.max(0, rule.limit - count), retryAfterSec: ok ? 0 : rule.windowSec };
    } catch {
      return this.fallback.hit(bucket, key, rule);
    }
  }
}

let shared: Limiter | null = null;
export function getLimiter(env: Record<string, string | undefined> = process.env): Limiter {
  if (shared) return shared;
  const mem = new MemoryLimiter();
  shared = env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN ? new UpstashLimiter(env.UPSTASH_REDIS_REST_URL, env.UPSTASH_REDIS_REST_TOKEN, mem) : mem;
  return shared;
}
export function resetLimiterForTests() { shared = null; }

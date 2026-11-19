import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryLimiter, UpstashLimiter, getLimiter, resetLimiterForTests } from '../src/ratelimit.js';

afterEach(() => resetLimiterForTests());

describe('MemoryLimiter', () => {
  it('allows up to the limit then blocks with retry-after, per key', async () => {
    const l = new MemoryLimiter(() => 1000);
    const rule = { limit: 3, windowSec: 60 };
    for (let i = 0; i < 3; i++) expect((await l.hit('b', 'ip1', rule)).ok).toBe(true);
    const blocked = await l.hit('b', 'ip1', rule);
    expect(blocked).toMatchObject({ ok: false, remaining: 0 });
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
    expect((await l.hit('b', 'ip2', rule)).ok).toBe(true);
    expect((await l.hit('other', 'ip1', rule)).ok).toBe(true);
  });
  it('resets after the window', async () => {
    let t = 0;
    const l = new MemoryLimiter(() => t);
    const rule = { limit: 1, windowSec: 10 };
    await l.hit('b', 'k', rule);
    expect((await l.hit('b', 'k', rule)).ok).toBe(false);
    t = 10_001;
    expect((await l.hit('b', 'k', rule)).ok).toBe(true);
  });
  it('sweeps expired keys and clears when full', async () => {
    let t = 0;
    const l = new MemoryLimiter(() => t, 3);
    const rule = { limit: 1, windowSec: 10 };
    for (const k of ['a', 'b', 'c']) await l.hit('b', k, rule);
    t = 11_000;
    expect((await l.hit('b', 'd', rule)).ok).toBe(true);
    const l2 = new MemoryLimiter(() => 0, 2);
    for (const k of ['a', 'b', 'c', 'd']) expect((await l2.hit('b', k, rule)).ok).toBe(true);
  });
});

describe('UpstashLimiter', () => {
  const rule = { limit: 2, windowSec: 60 };
  it('uses the shared counter', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify([{ result: 2 }, { result: 1 }]), { status: 200 }));
    const l = new UpstashLimiter('https://u.example/', 'tok', new MemoryLimiter(), f as any);
    expect(await l.hit('b', 'k', rule)).toMatchObject({ ok: true, remaining: 0 });
    expect((f.mock.calls[0] as any)[1].headers.authorization).toBe('Bearer tok');
    const f2 = vi.fn(async () => new Response(JSON.stringify([{ result: 3 }]), { status: 200 }));
    const l2 = new UpstashLimiter('https://u.example', 'tok', new MemoryLimiter(), f2 as any);
    expect(await l2.hit('b', 'k', rule)).toMatchObject({ ok: false, retryAfterSec: 60 });
  });
  it('fails open to memory on http error, network error and bad payload', async () => {
    const one = { limit: 1, windowSec: 60 };
    const fetches = [async () => new Response('x', { status: 500 }), async () => { throw new Error('net'); }, async () => new Response('[{"result":"x"}]', { status: 200 })];
    for (const f of fetches) {
      const l = new UpstashLimiter('https://u', 't', new MemoryLimiter(), f as any);
      expect((await l.hit('b', 'k', one)).ok).toBe(true);
      expect((await l.hit('b', 'k', one)).ok).toBe(false);
    }
  });
});

describe('getLimiter', () => {
  it('is memory by default and upstash when creds exist; singleton', () => {
    expect(getLimiter({})).toBeInstanceOf(MemoryLimiter);
    expect(getLimiter({})).toBe(getLimiter({}));
    resetLimiterForTests();
    expect(getLimiter({ UPSTASH_REDIS_REST_URL: 'https://u', UPSTASH_REDIS_REST_TOKEN: 't' })).toBeInstanceOf(UpstashLimiter);
  });
});

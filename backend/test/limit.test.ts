import { describe, expect, it, vi } from 'vitest';
import { mapLimited, ranges } from '../src/limit.js';
import { collectLogs } from '../src/stats.js';
import { makeV4Reader } from '../src/statsv4.js';
import { STATS_CACHE } from '../api/stats.js';

const tick = () => new Promise((r) => setTimeout(r, 2));

describe('mapLimited / ranges', () => {
  it('keeps order and never runs more than n at once', async () => {
    let live = 0, peak = 0;
    const out = await mapLimited([5, 4, 3, 2, 1, 0], 2, async (x) => { live++; peak = Math.max(peak, live); await tick(); live--; return x * 2; });
    expect(out).toEqual([10, 8, 6, 4, 2, 0]);
    expect(peak).toBe(2);
    expect(await mapLimited([], 4, async () => 1)).toEqual([]);
  });
  it('splits a block span into inclusive ranges', () => {
    expect(ranges(0n, 12_000n, 5000n)).toEqual([[0n, 4999n], [5000n, 9999n], [10_000n, 12_000n]]);
    expect(ranges(5n, 4n, 10n)).toEqual([]);
  });
});

describe('collectLogs in parallel', () => {
  it('bounds concurrency and returns logs in block order', async () => {
    let live = 0, peak = 0;
    const getLogs = vi.fn(async (a: any) => { live++; peak = Math.max(peak, live); await tick(); live--; return [{ blockNumber: a.fromBlock }]; });
    const r = await collectLogs({ getLogs } as any, '0x0000000000000000000000000000000000000001', 0n, 99_999n, { chunk: 5000n, concurrency: 4 });
    expect(getLogs).toHaveBeenCalledTimes(20);
    expect(peak).toBe(4);
    expect(r.logs.map((l: any) => l.blockNumber)).toEqual([...Array(20).keys()].map((i) => BigInt(i * 5000)));
    expect(r).toMatchObject({ scannedTo: 99_999n, truncated: false });
  });
});

describe('makeV4Reader', () => {
  it('scans each contract once for all of its events and filters by name', async () => {
    const getLogs = vi.fn(async (a: any) => [
      { eventName: 'LinkCreated', args: { linkId: 1n }, blockNumber: a.fromBlock, transactionHash: '0x01' },
      { eventName: 'LinkClaimed', args: { linkId: 1n }, blockNumber: a.fromBlock + 1n, transactionHash: '0x02' },
    ]);
    const r = makeV4Reader({ getLogs }, 1000n, undefined, 3);
    const A = '0x00000000000000000000000000000000000000aa';
    const [c, k, b] = await Promise.all([r.events(A, 'LinkCreated', 0n, 2999n), r.events(A, 'LinkClaimed', 0n, 2999n), r.events(A, 'LinkBound', 0n, 2999n)]);
    expect(getLogs).toHaveBeenCalledTimes(3); // 3 ranges, shared by the three event names
    expect((getLogs.mock.calls[0] as any)[0].events.length).toBeGreaterThan(5);
    expect(c.map((e) => e.blockNumber)).toEqual([0n, 1000n, 2000n]);
    expect(k).toHaveLength(3);
    expect(b).toEqual([]);
  });
  it('drops a failed scan so the next call retries', async () => {
    let n = 0;
    const r = makeV4Reader({ getLogs: async () => { n++; if (n === 1) throw new Error('rpc'); return []; } }, 1000n);
    const A = '0x00000000000000000000000000000000000000bb';
    await expect(r.events(A, 'LinkCreated', 0n, 10n)).rejects.toThrow('rpc');
    await expect(r.events(A, 'LinkCreated', 0n, 10n)).resolves.toEqual([]);
  });
});

describe('/api/stats cache headers', () => {
  it('lets the CDN serve a stale copy while it re-reads, never the browser', () => {
    expect(STATS_CACHE['vercel-cdn-cache-control']).toMatch(/max-age=30, stale-while-revalidate=300/);
    expect(STATS_CACHE['cache-control']).toMatch(/max-age=0/);
  });
});

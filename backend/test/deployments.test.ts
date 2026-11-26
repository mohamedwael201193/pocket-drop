import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { deploymentsSummary, generation, GENERATIONS } from '../src/deployments.js';
import { getHealth, SPONSOR_ADDRESS } from '../src/health.js';
import { getConfig } from '../src/config.js';

const file = path.resolve(__dirname, '..', '..', 'contracts-v4', 'deployments', 'diana.json');
const key = { 'v5.2': 'v5_2', 'v5.1': 'v5_1', v5: 'v5', v4: 'v4' } as const;

describe('deployments summary', () => {
  it.skipIf(!fs.existsSync(file))('every address matches contracts-v4/deployments/diana.json', () => {
    const all = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const g of GENERATIONS) {
      const rec = all[key[g]];
      const x = generation(g);
      for (const inst of ['prod', 'lab'] as const) {
        for (const k of ['router', 'factory', 'vaultImpl', 'drop', 'pool'] as const) {
          expect(x[inst][k].toLowerCase(), `${g} ${inst} ${k}`).toBe(rec[inst][k].address.toLowerCase());
        }
      }
      expect(x.pqGuardedCounter.toLowerCase()).toBe(rec.shared.counter.address.toLowerCase());
    }
  });
  it('current is v5.2 and comes first; previous lists the three older generations', () => {
    const d = deploymentsSummary();
    expect(d.current.generation).toBe('v5.2');
    expect(d.current.prod.router).toBe('0xe0a2679ae760a843880489c8cf8da15c00559a88');
    expect(d.previous.map((p) => p.generation)).toEqual(['v5.1', 'v5', 'v4']);
  });
  it('/api/health carries the current set, keeps the legacy `contract` field and reads the sponsor balance', async () => {
    const pub = { getBalance: vi.fn(async ({ address }: { address: string }) => (address === SPONSOR_ADDRESS ? 31n * 10n ** 18n : 10n * 10n ** 18n)), getBlockNumber: vi.fn(async () => 5n) } as any;
    const f = vi.fn(async () => new Response('{}', { status: 404 })) as any;
    const cfg = getConfig({ POCKETDROP_ADDRESS: '0x29F53b4B8031E7bA1785dC8C7a1C0Be413a4bd97', RELAYER_SECP_KEY: '0x' + '11'.repeat(32) });
    const h: any = await getHealth(cfg, pub, f, {});
    expect(h.contract).toBe('0x29F53b4B8031E7bA1785dC8C7a1C0Be413a4bd97');
    expect(h.contractRole).toMatch(/legacy v3/);
    expect(h.deployments.current.prod.vaultImpl).toBe('0x02375366fc06356e0020c93fbe9d5d8fcbeb4f16');
    expect(h.sponsor.balance).toBe('31');
    expect(h.relayer.balance).toBe('10');
  });
});

describe('last warm-up', () => {
  it('reads the latest completed warm-stats run, caches it, and reports errors without guessing', async () => {
    const { lastWarmUp, resetWarmUpCache } = await import('../src/warmup.js');
    resetWarmUpCache();
    const ok = vi.fn(async () => new Response(JSON.stringify({ workflow_runs: [{ updated_at: '2026-11-26T04:30:00Z', conclusion: 'success', html_url: 'https://github.com/x/runs/1' }] }), { status: 200 })) as any;
    let t = 0;
    const a = await lastWarmUp(ok, () => t);
    expect(a).toMatchObject({ lastRunAt: '2026-11-26T04:30:00Z', conclusion: 'success' });
    t = 60_000; await lastWarmUp(ok, () => t);
    expect(ok).toHaveBeenCalledTimes(1);
    resetWarmUpCache();
    const bad = vi.fn(async () => new Response('{}', { status: 403 })) as any;
    const b = await lastWarmUp(bad, () => 0);
    expect(b.lastRunAt).toBeNull();
    expect(b.error).toBe('github 403');
  });
});

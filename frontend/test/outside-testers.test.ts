import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import testers from '../src/data/outside-testers.json';

const evidence = JSON.parse(readFileSync(resolve(__dirname, '../evidence/outside-testers.json'), 'utf8')) as typeof testers;
const own = JSON.parse(readFileSync(resolve(__dirname, '../../backend/config/own-accounts.json'), 'utf8')) as { accounts: Record<string, string> };
const ownAddrs = new Set(Object.values(own.accounts).map((a) => a.toLowerCase()));

describe('recorded outside testers', () => {
  it('the evidence file and the app data file are the same snapshot', () => {
    expect(testers).toEqual(evidence);
  });

  it('lists only external v5.2 public-pool claims, with full addresses and hashes', () => {
    expect(testers.kind).toBe('RECORDED');
    expect(testers.call).toBe('https://x.com/PocketDropq/status/2126385715638321258');
    expect(testers.pool).toMatchObject({
      version: 'v5.2',
      contract: '0xab3ac2fedb07c1e419ea86f41d49d417dd10dbf9',
      id: 's5',
      poolId: 5,
      slots: 20,
      perSlotQor: '0.5',
      hostLabel: 'TEAM-RUN',
    });
    expect(testers.claims.length).toBeGreaterThan(0);
    for (const c of testers.claims) {
      expect(c.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(c.tx).toMatch(/^[0-9A-F]{64}$/);
      expect(ownAddrs.has(c.address.toLowerCase()), c.address).toBe(false);
    }
    const txs = testers.claims.map((c) => c.tx);
    expect(new Set(txs).size).toBe(txs.length);
  });

  it('the snapshot has no timestamps', () => {
    const raw = JSON.stringify(testers);
    expect(raw).not.toMatch(/20\d{2}-\d{2}-\d{2}/);
    expect(raw.toLowerCase()).not.toContain('timestamp');
    expect(Object.keys(testers.claims[0]).sort()).toEqual(['address', 'tx']);
  });
});

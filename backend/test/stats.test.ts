import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeEventTopics, encodeAbiParameters, type Log } from 'viem';
import { pocketDropAbi } from '../src/abi.js';
import { setSink } from '../src/log.js';
import { buildStats, collectLogs, getStats, kindOf, loadOwnAccounts, resetStatsCache } from '../src/stats.js';
import { ADDR, CONTRACT, cfg } from './helpers.js';

setSink(() => {});
const OWN = '0xF6e6fb2d33Bef3043682658E2b69F3a2F8616cCD';
const EXT = '0x3333333333333333333333333333333333333333';
const ev = (name: string) => pocketDropAbi.find((x) => x.type === 'event' && x.name === name) as any;

function mkLog(name: string, args: Record<string, unknown>, block = 10n): Log {
  const e = ev(name);
  const indexed = e.inputs.filter((i: any) => i.indexed), plain = e.inputs.filter((i: any) => !i.indexed);
  const topics = encodeEventTopics({ abi: [e], eventName: name, args: Object.fromEntries(indexed.map((i: any) => [i.name, args[i.name]])) } as any);
  const data = plain.length ? encodeAbiParameters(plain, plain.map((i: any) => args[i.name])) : '0x';
  return { address: CONTRACT, topics, data, blockNumber: block, transactionHash: ('0x' + 'aa'.repeat(32)) as any, logIndex: 0, transactionIndex: 0, blockHash: '0x', removed: false } as any;
}
const own = new Map([[OWN.toLowerCase(), 'relayer']]);

const logs = [
  mkLog('LinkCreated', { linkId: 1n, sender: OWN, mode: 1, amount: 2n * 10n ** 18n, drip: 0n, relayerFee: 0n, expiry: 99n, linkKeyHash: '0x' + '55'.repeat(32) }),
  mkLog('LinkCreated', { linkId: 2n, sender: EXT, mode: 0, amount: 10n ** 18n, drip: 0n, relayerFee: 0n, expiry: 99n, linkKeyHash: '0x' + '55'.repeat(32) }),
  mkLog('LinkBound', { linkId: 1n, recipient: ADDR, recipientKeyHash: '0x' + '44'.repeat(32), bindDeadline: 5n, rebind: false, relayer: OWN }),
  mkLog('LinkClaimed', { linkId: 1n, recipient: ADDR, amount: 2n * 10n ** 18n, relayer: OWN }, 12n),
  mkLog('LinkConfirmed', { linkId: 2n, recipient: ADDR, recipientKeyHash: '0x' + '44'.repeat(32) }),
  { ...mkLog('LinkCancelled', { linkId: 2n, sender: EXT, refunded: 1n }), },
  mkLog('LinkRefunded', { linkId: 3n, sender: EXT, refunded: 1n, caller: EXT }),
  { address: CONTRACT, topics: ['0x' + '99'.repeat(32)], data: '0x' } as any, // undecodable, skipped
];

describe('buildStats', () => {
  it('counts events, sums volume, splits own vs external addresses (never "users")', () => {
    const s = buildStats(logs, own);
    expect(s.counts).toMatchObject({ created: 2, bound: 1, claimed: 1, confirmed: 1, cancelled: 1, refunded: 1 });
    expect(s.volume).toMatchObject({ created: '3', claimed: '2', unit: 'QOR' });
    expect(s.addresses.own).toBe(1);
    expect(s.addresses.external).toBe(2);
    expect(s.addresses.ownLabels).toEqual(['relayer']);
    expect(s.addresses.byRole.sender).toEqual({ own: 1, external: 1 });
    expect(JSON.stringify(s)).not.toMatch(/users?"/i);
    expect(s.recent[0].kind).toBe('refunded');
    expect(s.recent.find((e) => e.name === 'LinkCreated')!.addresses.find((a) => a.role === 'sender')).toBeTruthy();
    expect(s.recent.find((e) => e.linkId === '1' && e.kind === 'created')!.addresses[0]).toMatchObject({ own: true, label: 'relayer' });
  });
  it('kindOf classification', () => {
    expect(kindOf('LinkCreated')).toBe('created');
    expect(kindOf('Withdrawn')).toBe('other');
    expect(kindOf('FooBound')).toBe('bound');
  });
});

describe('collectLogs', () => {
  it('chunks bounded ranges', async () => {
    const getLogs = vi.fn(async () => []);
    const r = await collectLogs({ getLogs, getBlockNumber: vi.fn() } as any, CONTRACT as any, 0n, 12_000n, { chunk: 5000n });
    expect(getLogs).toHaveBeenCalledTimes(3);
    expect(r).toMatchObject({ scannedTo: 12_000n, truncated: false });
    expect((getLogs.mock.calls[1] as any)[0]).toMatchObject({ fromBlock: 5000n, toBlock: 9999n });
  });
  it('caps the number of chunks and reports truncation', async () => {
    const r = await collectLogs({ getLogs: async () => [] } as any, CONTRACT as any, 0n, 100_000n, { chunk: 1000n, maxChunks: 3 });
    expect(r).toMatchObject({ truncated: true, scannedTo: 2999n });
  });
  it('halves the chunk on RPC range errors, rethrows at the floor', async () => {
    let n = 0;
    const getLogs = vi.fn(async (a: any) => { n++; if (a.toBlock - a.fromBlock > 1200n) throw new Error('range too large'); return []; });
    const r = await collectLogs({ getLogs } as any, CONTRACT as any, 0n, 4000n, { chunk: 5000n });
    expect(r.truncated).toBe(false);
    expect(n).toBeGreaterThan(2);
    await expect(collectLogs({ getLogs: async () => { throw new Error('dead'); } } as any, CONTRACT as any, 0n, 100n, { chunk: 200n })).rejects.toThrow('dead');
  });
});

describe('getStats', () => {
  beforeEach(() => resetStatsCache());
  const pub = (l: Log[] = logs) => ({ getBlockNumber: vi.fn(async () => 5000n), getLogs: vi.fn(async () => l) } as any);
  it('503 without a contract', async () => {
    expect(await getStats(pub(), cfg({ contract: null }), own)).toMatchObject({ ok: false, status: 503 });
  });
  it('indexes from lookback, caches for the ttl', async () => {
    const p = pub();
    let t = 0;
    const a = await getStats(p, cfg({ statsLookback: 1000n }), own, () => t);
    expect(a.ok && (a.value as any).fromBlock).toBe('4000');
    expect((a.value as any).network).toBe('diana-testnet');
    t = 5000;
    await getStats(p, cfg(), own, () => t);
    expect(p.getBlockNumber).toHaveBeenCalledTimes(1);
    t = 40_000;
    await getStats(p, cfg(), own, () => t);
    expect(p.getBlockNumber).toHaveBeenCalledTimes(2);
  });
  it('uses deployBlock when set and lookback beyond genesis starts at 0', async () => {
    const a = await getStats(pub([]), cfg({ deployBlock: 77n }), own);
    expect((a as any).value.fromBlock).toBe('77');
    resetStatsCache();
    const b = await getStats(pub([]), cfg({ statsLookback: 10n ** 9n }), own);
    expect((b as any).value.fromBlock).toBe('0');
  });
  it('marks truncated scans', async () => {
    const big = { getBlockNumber: async () => 10n ** 9n, getLogs: async () => [] } as any;
    const a = await getStats(big, cfg({ deployBlock: 0n }), own);
    expect((a as any).value.truncated).toBe(true);
    expect((a as any).value.note).toMatch(/lower bound/);
  });
});

describe('loadOwnAccounts', () => {
  it('reads a file, ignores bad addresses, missing file -> empty', () => {
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'own-')), 'o.json');
    fs.writeFileSync(f, JSON.stringify({ accounts: { a: OWN, bad: '0x12' } }));
    const m = loadOwnAccounts(f);
    expect(m.get(OWN.toLowerCase())).toBe('a');
    expect(m.size).toBe(1);
    expect(loadOwnAccounts(f + '.missing').size).toBe(0);
  });
  it('default path finds the committed config/own-accounts.json (deployer, relayer, burner, main, recipients)', () => {
    const m = loadOwnAccounts();
    const labels = new Set(m.values());
    for (const l of ['relayer', 'burner', 'mainTestWallet']) expect(labels.has(l)).toBe(true);
  });
});

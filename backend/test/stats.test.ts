import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeEventTopics, encodeAbiParameters, type Log } from 'viem';
import { pocketDropAbi } from '../src/abi.js';
import { setSink } from '../src/log.js';
import { buildStats, collectLogs, getStats, kindOf, loadOwnAccounts, ownAccountsCandidates, resetStatsCache } from '../src/stats.js';
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
    expect((a.value as any).ownAccountsListed).toBe(own.size);
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
  it('module-relative fallback path points at the same committed file', () => {
    const c = ownAccountsCandidates();
    expect(c.some((f) => f.endsWith(path.join('config', 'own-accounts.json')))).toBe(true);
    for (const f of c) expect(loadOwnAccounts(f).size).toBe(loadOwnAccounts().size);
  });
  it('the frontend copy (src/data/own.json) lists exactly the same addresses', () => {
    const fe = path.join(process.cwd(), '..', 'frontend', 'src', 'data', 'own.json');
    if (!fs.existsSync(fe)) return; // backend checked out alone
    const a = [...loadOwnAccounts().keys()].sort();
    const b = [...loadOwnAccounts(fe).keys()].sort();
    expect(b).toEqual(a);
  });
  it('every key and Pocket created by a QA run (frontend/evidence/v4/qa/*.json) is own, so /radar never counts QA as outside use', () => {
    const m = loadOwnAccounts();
    const dir = path.join(process.cwd(), '..', 'frontend', 'evidence', 'v4', 'qa');
    if (!fs.existsSync(dir)) return;
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
    expect(files.length).toBeGreaterThanOrEqual(1);
    for (const f of files) {
      const list = (JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as { accounts: { label: string; address: string }[] }).accounts;
      expect(list.length).toBeGreaterThan(0);
      for (const a of list) expect(m.has(a.address.toLowerCase()), `${f}: ${a.label} ${a.address}`).toBe(true);
    }
  });
  it('every account named in a v4/v5 E2E run file (frontend/evidence/v4/e2e/*.json "accounts") is own', () => {
    const m = loadOwnAccounts();
    const dir = path.join(process.cwd(), '..', 'frontend', 'evidence', 'v4', 'e2e');
    if (!fs.existsSync(dir)) return;
    let n = 0;
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
      const acc = (JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as { accounts?: Record<string, unknown> }).accounts;
      if (!acc || typeof acc !== 'object') continue;
      for (const [k, v] of Object.entries(acc)) if (typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v)) { n++; expect(m.has(v.toLowerCase()), `${f}: ${k} ${v}`).toBe(true); }
    }
    expect(n).toBeGreaterThan(0);
  });
  it('the TEAM-RUN accounts that live /api/stats counted as external on 26 Nov 2026 are own (scripts/list-external.ts)', () => {
    const m = loadOwnAccounts();
    // v5 e2e chromium-390 a-confirmed sender key + recipient key, v4 e2e webkit-390 recipient key, v3 link 29 recipient
    for (const a of ['0x874406CbcD2009a3e1853dE6794F2Cec8366F11B', '0x71A50B0E3ca7ce94A5A95E3265D0dDCC653DF6CD', '0x43Dce76e6e73f4dD617C7F989776F335A1d92484', '0x718b9e52fD791d93589Eb174965c7A73F9405146']) {
      expect(m.has(a.toLowerCase()), a).toBe(true);
      expect(m.get(a.toLowerCase())).toMatch(/^TEAM-RUN /);
    }
  });
  it('every sender recorded in the v3-contract E2E evidence and the v3 live-test recipients are own', () => {
    const m = loadOwnAccounts();
    const ev = path.join(process.cwd(), '..', 'frontend', 'evidence');
    if (!fs.existsSync(ev)) return;
    const files = [
      ...fs.readdirSync(ev).filter((f) => /^e2e-.*\.json$/.test(f)).map((f) => path.join(ev, f)),
      ...fs.readdirSync(path.join(ev, 'v2')).filter((f) => /^e2e-.*\.json$/.test(f)).map((f) => path.join(ev, 'v2', f)),
      ...fs.readdirSync(path.join(ev, 'v3', 'e2e')).filter((f) => f.endsWith('.json') && f !== 'tx-verification.json').map((f) => path.join(ev, 'v3', 'e2e', f)),
    ];
    expect(files.length).toBeGreaterThanOrEqual(16);
    for (const f of files) {
      const s = (JSON.parse(fs.readFileSync(f, 'utf8')) as { sender?: string }).sender;
      if (s) expect(m.has(s.toLowerCase()), f).toBe(true);
    }
  });
});

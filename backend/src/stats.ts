import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeEventLog, formatEther, type Address, type Log, type PublicClient } from 'viem';
import { pocketDropAbi } from './abi.js';
import { NETWORK, type Config } from './config.js';
import { log } from './log.js';

export type OwnMap = Map<string, string>;

/** Default locations of config/own-accounts.json: the working directory (local runs, tests) and the path next to this
 * module (serverless bundles, where the working directory is not guaranteed to be the project root). */
export function ownAccountsCandidates(): string[] {
  const out = [path.join(process.cwd(), 'config', 'own-accounts.json')];
  try { out.push(fileURLToPath(new URL('../config/own-accounts.json', import.meta.url))); } catch { /* no file URL */ }
  return [...new Set(out)];
}

/** Load config/own-accounts.json ({ accounts: { label: 0x... } }). Missing file -> empty map (everything external). */
export function loadOwnAccounts(file?: string): OwnMap {
  const candidates = file ? [file] : ownAccountsCandidates();
  for (const f of candidates) {
    try {
      const j = JSON.parse(fs.readFileSync(f, 'utf8')) as { accounts?: Record<string, string> };
      const m: OwnMap = new Map();
      for (const [label, addr] of Object.entries(j.accounts ?? {})) if (/^0x[0-9a-fA-F]{40}$/.test(addr)) m.set(addr.toLowerCase(), label);
      return m;
    } catch { /* try next */ }
  }
  return new Map();
}
export type Kind = 'created' | 'bound' | 'confirmed' | 'claimed' | 'cancelled' | 'refunded' | 'other';
export const kindOf = (name: string): Kind => {
  const n = name.toLowerCase();
  for (const k of ['created', 'bound', 'confirmed', 'claimed', 'cancelled', 'refunded'] as const) if (n.includes(k)) return k;
  return 'other';
};

export interface IndexedEvent { name: string; kind: Kind; linkId: string | null; blockNumber: string; txHash: string; addresses: { role: string; address: string; own: boolean; label?: string }[]; amount?: string }

type LogsClient = Pick<PublicClient, 'getBlockNumber' | 'getLogs'>;

export interface StatsOptions { chunk?: bigint; maxChunks?: number }

export async function collectLogs(pub: LogsClient, address: Address, from: bigint, to: bigint, opts: StatsOptions = {}) {
  let chunk = opts.chunk ?? 5000n;
  const maxChunks = opts.maxChunks ?? 40;
  const out: Log[] = [];
  let cursor = from, calls = 0, truncated = false;
  while (cursor <= to) {
    if (calls >= maxChunks) { truncated = true; break; }
    const end = cursor + chunk - 1n > to ? to : cursor + chunk - 1n;
    try {
      out.push(...(await pub.getLogs({ address, fromBlock: cursor, toBlock: end })));
      cursor = end + 1n;
      calls++;
    } catch (e) {
      if (chunk > 250n) { chunk = chunk / 2n; continue; } // RPC range limit: shrink and retry
      throw e;
    }
  }
  return { logs: out, scannedTo: cursor - 1n, truncated };
}

export function buildStats(logs: Log[], own: OwnMap) {
  const counts: Record<Kind, number> = { created: 0, bound: 0, confirmed: 0, claimed: 0, cancelled: 0, refunded: 0, other: 0 };
  let createdWei = 0n, claimedWei = 0n;
  const addr = { own: new Map<string, string>(), external: new Set<string>() };
  const roles: Record<string, Set<string>> = {};
  const events: IndexedEvent[] = [];
  for (const l of logs) {
    let name: string, args: Record<string, unknown>;
    try {
      const d = decodeEventLog({ abi: pocketDropAbi, data: l.data, topics: l.topics as any, strict: false }) as any;
      name = d.eventName as string; args = (d.args ?? {}) as Record<string, unknown>;
    } catch { continue; }
    const kind = kindOf(name);
    counts[kind]++;
    const addresses: IndexedEvent['addresses'] = [];
    for (const [k, v] of Object.entries(args)) {
      if (typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v)) {
        const label = own.get(v.toLowerCase());
        addresses.push({ role: k, address: v, own: !!label, label });
        (roles[k] ??= new Set()).add(v.toLowerCase());
        if (label) addr.own.set(v.toLowerCase(), label); else addr.external.add(v.toLowerCase());
      }
    }
    const amount = typeof args.amount === 'bigint' ? args.amount : undefined;
    if (amount !== undefined) { if (kind === 'created') createdWei += amount; if (kind === 'claimed') claimedWei += amount; }
    events.push({ name, kind, linkId: typeof args.linkId === 'bigint' ? args.linkId.toString() : null, blockNumber: (l.blockNumber ?? 0n).toString(), txHash: l.transactionHash ?? '', addresses, amount: amount?.toString() });
  }
  const split = (set: Set<string>) => { let o = 0; for (const a of set) if (own.has(a)) o++; return { own: o, external: set.size - o }; };
  const byRole: Record<string, { own: number; external: number }> = {};
  for (const [r, s] of Object.entries(roles)) byRole[r] = split(s);
  return {
    counts,
    volume: { createdWei: createdWei.toString(), created: formatEther(createdWei), claimedWei: claimedWei.toString(), claimed: formatEther(claimedWei), unit: 'QOR' },
    // Distinct on-chain ADDRESSES, never "users": one person can hold many addresses.
    addresses: { own: addr.own.size, external: addr.external.size, byRole, ownLabels: [...new Set(addr.own.values())].sort() },
    recent: events.slice(-25).reverse(),
  };
}

let cache: { at: number; value: unknown } | null = null;
export const resetStatsCache = () => { cache = null; };

export async function getStats(pub: LogsClient, cfg: Config, own: OwnMap, now: () => number = Date.now, ttlMs = 30_000) {
  if (!cfg.contract) return { ok: false as const, status: 503, error: 'POCKETDROP_ADDRESS is not configured' };
  if (cache && now() - cache.at < ttlMs) return { ok: true as const, value: cache.value };
  const head = await pub.getBlockNumber();
  const from = cfg.deployBlock ?? (head > cfg.statsLookback ? head - cfg.statsLookback : 0n);
  const { logs, scannedTo, truncated } = await collectLogs(pub, cfg.contract as Address, from, head);
  const value = {
    network: NETWORK, contract: cfg.contract, fromBlock: from.toString(), toBlock: scannedTo.toString(), headBlock: head.toString(),
    truncated, note: truncated ? 'Scan was capped; counts are a lower bound. Set POCKETDROP_DEPLOY_BLOCK to index from deployment.' : undefined,
    ownAccountsNote: 'Addresses listed in config/own-accounts.json (team/test accounts) are marked own; all others are external. Counts are addresses, not users.',
    // How many addresses the deployed function actually loaded; 0 means the list was not bundled and every address reads as external.
    ownAccountsListed: own.size,
    ...buildStats(logs, own),
    generatedAt: new Date(now()).toISOString(),
  };
  cache = { at: now(), value };
  log('info', 'stats.indexed', { logs: logs.length, from: from.toString(), to: scannedTo.toString(), truncated });
  return { ok: true as const, value };
}

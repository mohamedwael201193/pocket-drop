import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeEventLog, formatEther, type Address, type Log, type PublicClient } from 'viem';
import { pocketDropAbi } from './abi.js';
import { NETWORK, type Config } from './config.js';
import { log } from './log.js';
import { getV4Stats, makeV4Reader } from './statsv4.js';
import { hybridEventsFor } from './xvmLive.js';
import { mapLimited, ranges } from './limit.js';

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

export interface StatsOptions { chunk?: bigint; maxChunks?: number; concurrency?: number }

/** All logs of `address` in [from, to]: ranges of `chunk` blocks fetched in parallel (bounded), in block order. A range
 *  the RPC refuses is halved until 250 blocks, then the error is thrown. More than `maxChunks` ranges -> truncated. */
export async function collectLogs(pub: LogsClient, address: Address, from: bigint, to: bigint, opts: StatsOptions = {}) {
  const chunk = opts.chunk ?? 5000n;
  const maxChunks = opts.maxChunks ?? 40;
  const all = ranges(from, to, chunk);
  const truncated = all.length > maxChunks;
  const use = all.slice(0, maxChunks);
  const fetchRange = async (f: bigint, t: bigint): Promise<Log[]> => {
    try { return await pub.getLogs({ address, fromBlock: f, toBlock: t }); } catch (e) {
      if (t - f + 1n <= 250n) throw e; // RPC range limit: halve and retry, down to a floor
      const mid = f + (t - f) / 2n;
      return [...await fetchRange(f, mid), ...await fetchRange(mid + 1n, t)];
    }
  };
  const parts = await mapLimited(use, opts.concurrency ?? 8, ([f, t]) => fetchRange(f, t));
  return { logs: parts.flat(), scannedTo: use.length ? use[use.length - 1][1] : from - 1n, truncated };
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
  const [{ logs, scannedTo, truncated }, v4] = await Promise.all([
    collectLogs(pub, cfg.contract as Address, from, head),
    'getBalance' in pub ? getV4Stats(makeV4Reader(pub, 9000n, 'readContract' in pub ? (env) => hybridEventsFor(env, cfg, pub as never) : undefined), own).catch((e) => { log('warn', 'stats.v4_failed', { message: String((e as Error)?.message ?? e) }); return null; }) : Promise.resolve(null),
  ]);
  const value = {
    network: NETWORK, contract: cfg.contract, fromBlock: from.toString(), toBlock: scannedTo.toString(), headBlock: head.toString(),
    truncated, note: truncated ? 'Scan was capped; counts are a lower bound. Set POCKETDROP_DEPLOY_BLOCK to index from deployment.' : undefined,
    ownAccountsNote: 'Addresses listed in config/own-accounts.json (team/test accounts) are marked own; all others are external. Counts are addresses, not users.',
    // How many addresses the deployed function actually loaded; 0 means the list was not bundled and every address reads as external.
    ownAccountsListed: own.size,
    // v3 (the legacy PocketDrop above) and v4 (Pockets, drops, pools) are reported separately; never summed.
    v3: { label: 'v3 PocketDrop (legacy)', ...buildStats(logs, own) },
    ...buildStats(logs, own),
    v4: v4 ?? { error: 'v4 logs could not be read just now' },
    generatedAt: new Date(now()).toISOString(),
  };
  cache = { at: now(), value };
  log('info', 'stats.indexed', { logs: logs.length, from: from.toString(), to: scannedTo.toString(), truncated });
  return { ok: true as const, value };
}

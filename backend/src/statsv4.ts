// v4 statistics for /api/stats, computed exactly like the /radar page does from chain logs (so the two agree), plus
// legacy-key telemetry: which deployed Pockets were made while the app still derived keys the v1 way.
import { parseAbi, type Address, type Hex } from 'viem';
import { V4_INSTANCES, type V4Env } from './v4.js';
import type { OwnMap } from './stats.js';
import { ranges } from './limit.js';

/** First Diana block at or after the moment the v2 browser derivation went live in production
 *  (frontend deployment dpl_ELW885X5Vs2sNUwyzQwp1guDVtwR, ready 2026-11-20 04:24:18 UTC, commit 0643538 contains 43cc149). */
export const V2_RELEASE_BLOCK = 10412597n;
export const V4_FROM: Record<V4Env, { drop: bigint; pool: bigint }> = {
  prod: { drop: 10761515n, pool: 10761519n }, lab: { drop: 10761527n, pool: 10761528n }, // v5.2 (current)
  prodV51: { drop: 10757682n, pool: 10757686n }, labV51: { drop: 10757734n, pool: 10757736n }, // v5.1 (previous)
  prodV5: { drop: 10746804n, pool: 10746804n }, labV5: { drop: 10746809n, pool: 10746809n }, // v5 (previous)
  prodV4: { drop: 10388441n, pool: 10388334n }, labV4: { drop: 10388447n, pool: 10388349n }, // v4 (previous)
};

export const V4_EVENTS = parseAbi([
  'event PocketDeployed(address indexed pocket, address indexed owner, bytes32 salt)',
  'event LinkCreated(uint256 indexed linkId, address indexed sender, uint8 mode, uint256 amount, uint256 drip, uint256 relayerFee, uint64 expiry, bytes32 linkKeyHash)',
  'event LinkBound(uint256 indexed linkId, address indexed recipient, address payTo, bytes32 recipientKeyHash, uint64 bindDeadline, bool rebind, address relayer)',
  'event LinkConfirmed(uint256 indexed linkId, address indexed recipient, bytes32 recipientKeyHash)',
  'event LinkClaimed(uint256 indexed linkId, address indexed recipient, address payTo, uint256 amount, address relayer)',
  'event LinkCancelled(uint256 indexed linkId, address indexed sender, uint256 refunded)',
  'event PoolCreated(uint256 indexed poolId, address indexed host, uint32 slots, uint96 perSlot, uint64 expiry, bytes32 linkKeyHash)',
  'event PoolClaimed(uint256 indexed poolId, address indexed recipient, address payTo, uint32 taken, address relayer)',
]);
type EvName = (typeof V4_EVENTS)[number]['name'];
export interface EvLog { args: Record<string, unknown>; blockNumber: bigint; transactionHash: Hex }

export interface V4Reader {
  head(): Promise<bigint>;
  /** Events rebuilt from hybrid relays (a MsgCrossVMCall leaves no EVM log; see xvm.ts). Optional: older readers have none. */
  hybrid?(env: V4Env): Promise<(EvLog & { eventName: string })[]>;
  events(address: Address, name: EvName, from: bigint, to: bigint): Promise<EvLog[]>;
  balance(a: Address): Promise<bigint>;
}

export interface Split { own: number; external: number }
export function buildV4Env(env: V4Env, l: Record<EvName, EvLog[]>, own: OwnMap) {
  const isOwn = (a: string) => own.has(a.toLowerCase());
  const bump = (s: Split, a: string) => { if (isOwn(a)) s.own++; else s.external++; };
  const ownerOf = new Map(l.PocketDeployed.map((d) => [String(d.args.pocket).toLowerCase(), String(d.args.owner)]));
  const via = (p: unknown) => ownerOf.get(String(p).toLowerCase()) ?? String(p);
  const S = (): Split => ({ own: 0, external: 0 });
  const pocketsOwn = S(); for (const d of l.PocketDeployed) bump(pocketsOwn, String(d.args.owner));
  const dropSenders = S(); for (const c of l.LinkCreated) bump(dropSenders, via(c.args.sender));
  const dropRecipients = S(); for (const b of l.LinkBound) bump(dropRecipients, String(b.args.recipient));
  const poolHosts = S(); for (const p of l.PoolCreated) bump(poolHosts, via(p.args.host));
  const poolClaimers = S(); for (const c of l.PoolClaimed) bump(poolClaimers, String(c.args.recipient));
  // Distinct accounts (metrics honesty): the per-role counts above count EVENTS (one per Pocket, link, rebind, slot).
  // These count each address once per role, and `all` counts each address once across every role.
  const roleAddrs: Record<'pocketOwners' | 'dropSenders' | 'dropRecipients' | 'poolHosts' | 'poolClaimers', string[]> = {
    pocketOwners: l.PocketDeployed.map((d) => String(d.args.owner)),
    dropSenders: l.LinkCreated.map((c) => via(c.args.sender)),
    dropRecipients: l.LinkBound.map((b) => String(b.args.recipient)),
    poolHosts: l.PoolCreated.map((p) => via(p.args.host)),
    poolClaimers: l.PoolClaimed.map((c) => String(c.args.recipient)),
  };
  const distinctSplit = (xs: string[]): Split => { const s = S(); for (const a of new Set(xs.map((x) => x.toLowerCase()))) bump(s, a); return s; };
  const distinctAccounts = {
    ...(Object.fromEntries(Object.entries(roleAddrs).map(([k, v]) => [k, distinctSplit(v)])) as Record<keyof typeof roleAddrs, Split>),
    all: distinctSplit(Object.values(roleAddrs).flat()),
    note: 'Each address counted once per role; `all` counts each address once across all roles. Addresses, not people.',
  };
  return {
    env, pockets: l.PocketDeployed.length, pocketsOwn, distinctAccounts,
    drops: { created: l.LinkCreated.length, bound: l.LinkBound.length, confirmed: l.LinkConfirmed.length, claimed: l.LinkClaimed.length, cancelled: l.LinkCancelled.length },
    dropSenders, dropRecipients, pools: { created: l.PoolCreated.length, slotsClaimed: l.PoolClaimed.length }, poolHosts, poolClaimers,
  };
}

/** Legacy-key telemetry from what the chain shows: deploy block vs the v2 release block, owner own/external, live balance. */
export async function keyEras(deployed: EvLog[], own: OwnMap, balance: (a: Address) => Promise<bigint>) {
  const isOwn = (a: string) => own.has(a.toLowerCase());
  const v1 = deployed.filter((d) => d.blockNumber < V2_RELEASE_BLOCK);
  const v2 = deployed.filter((d) => d.blockNumber >= V2_RELEASE_BLOCK);
  const bal = await Promise.all(v1.map((d) => balance(d.args.pocket as Address).catch(() => null)));
  const split = (xs: EvLog[]): Split => ({ own: xs.filter((d) => isOwn(String(d.args.owner))).length, external: xs.filter((d) => !isOwn(String(d.args.owner))).length });
  const holding = v1.filter((_, i) => (bal[i] ?? 0n) > 0n);
  return {
    v2ReleaseBlock: V2_RELEASE_BLOCK.toString(),
    v1Era: { total: v1.length, ...split(v1), stillHoldingQor: holding.length, stillHoldingExternal: holding.filter((d) => !isOwn(String(d.args.owner))).length, unreadable: bal.filter((b) => b === null).length },
    v2Era: { total: v2.length, ...split(v2) },
    method: 'Classified by the block each Pocket was deployed in, against the first block after the v2 key derivation went live in production. The chain cannot show how a key was derived: v1-era Pockets made by the app use v1 keys; team scripts (own) may use independent keys; a v1 browser can still deploy a counterfactual Pocket after the release, so v2-era is "made after v2 shipped", not proof of v2. Pockets never deployed are not visible.',
  };
}

export async function getV4Stats(r: V4Reader, own: OwnMap) {
  const head = await r.head();
  const out: Record<string, unknown> = {};
  await Promise.all((['prod', 'lab', 'prodV51', 'labV51', 'prodV5', 'labV5', 'prodV4', 'labV4'] as V4Env[]).map(async (env) => {
    const i = V4_INSTANCES[env]; const f = V4_FROM[env];
    const names: [Address, EvName, bigint][] = [
      [i.factory, 'PocketDeployed', f.drop], [i.drop, 'LinkCreated', f.drop], [i.drop, 'LinkBound', f.drop], [i.drop, 'LinkConfirmed', f.drop],
      [i.drop, 'LinkClaimed', f.drop], [i.drop, 'LinkCancelled', f.drop], [i.pool, 'PoolCreated', f.pool], [i.pool, 'PoolClaimed', f.pool],
    ];
    const hyP = r.hybrid ? r.hybrid(env).catch(() => null) : Promise.resolve([]);
    const res = await Promise.all(names.map(([a, n, from]) => r.events(a, n, from, head)));
    const l = Object.fromEntries(names.map(([, n], k) => [n, res[k]])) as Record<EvName, EvLog[]>;
    const hy = await hyP;
    const merged = mergeHybrid(l, hy ?? []);
    out[env] = { ...buildV4Env(env, merged, own), keyEras: await keyEras(merged.PocketDeployed, own, r.balance), hybridRelayEvents: hy === null ? null : hy.length };
  }));
  return { headBlock: head.toString(), prod: out.prod, lab: out.lab, prodV51: out.prodV51, labV51: out.labV51, prodV5: out.prodV5, labV5: out.labV5, prodV4: out.prodV4, labV4: out.labV4, current: 'v5.2', note: 'prod/lab = current v5.2 contracts, prodV51/labV51 = previous v5.1 contracts, prodV5/labV5 = previous v5 contracts, prodV4/labV4 = previous v4 contracts (reported separately, never summed here). Same method as /radar: factory, drop and pool logs since deployment, plus the events of hybrid relays (MsgCrossVMCall, which leaves no EVM log) rebuilt from the native lane; own = listed in config/own-accounts.json. Counts are addresses, not people.' };
}

/** Add hybrid-relay events to the log lists. A PocketDeployed for a Pocket already in the logs is dropped (never counted twice). */
export function mergeHybrid(l: Record<EvName, EvLog[]>, hy: (EvLog & { eventName: string })[]): Record<EvName, EvLog[]> {
  const out = Object.fromEntries(Object.entries(l).map(([k, v]) => [k, [...v]])) as Record<EvName, EvLog[]>;
  const deployed = new Set(l.PocketDeployed.map((d) => String(d.args.pocket).toLowerCase()));
  for (const e of hy) {
    const list = out[e.eventName as EvName];
    if (!list) continue;
    if (e.eventName === 'PocketDeployed') { const k = String(e.args.pocket).toLowerCase(); if (deployed.has(k)) continue; deployed.add(k); }
    list.push({ args: e.args, blockNumber: e.blockNumber, transactionHash: e.transactionHash });
  }
  return out;
}

/** Reads logs the fast way for Diana: one getLogs per range for ALL v4 events of a contract (memoised, so the 5 drop events
 *  cost one scan), ranges fetched in parallel with at most `concurrency` calls in flight across the whole reader. */
export function makeV4Reader(pub: any, chunk = 9000n, hybrid?: V4Reader['hybrid'], concurrency = 8): V4Reader {
  let inFlight = 0; const queue: (() => void)[] = [];
  const slot = async <T>(fn: () => Promise<T>): Promise<T> => {
    if (inFlight >= concurrency) await new Promise<void>((r) => queue.push(r));
    inFlight++;
    try { return await fn(); } finally { inFlight--; queue.shift()?.(); }
  };
  const scans = new Map<string, Promise<(EvLog & { eventName: string })[]>>();
  const scan = (address: Address, from: bigint, to: bigint) => {
    const k = `${address.toLowerCase()}:${from}:${to}`;
    let p = scans.get(k);
    if (!p) {
      p = Promise.all(ranges(from, to, chunk).map(([f, t]) => slot(() => pub.getLogs({ address, events: V4_EVENTS, fromBlock: f, toBlock: t }) as Promise<any[]>)))
        .then((parts) => parts.flat().map((x: any) => ({ eventName: x.eventName as string, args: x.args ?? {}, blockNumber: x.blockNumber, transactionHash: x.transactionHash })));
      p.catch(() => scans.delete(k));
      scans.set(k, p);
    }
    return p;
  };
  return {
    ...(hybrid ? { hybrid } : {}),
    head: () => pub.getBlockNumber(),
    balance: (a) => slot(() => pub.getBalance({ address: a })),
    async events(address, name, from, to) {
      return (await scan(address, from, to)).filter((e) => e.eventName === name).map(({ args, blockNumber, transactionHash }) => ({ args, blockNumber, transactionHash }));
    },
  };
}

// Live v4 statistics straight from chain logs (no backend): Pockets deployed, drops and pools, own vs external accounts,
// and a live pqcKeyStatus sample of recent senders on Diana.
import { createPublicClient, getAbiItem, http, type Hex } from 'viem';
import { dropAbi, factoryAbi, poolAbi } from './abi4';
import { dianaChain, EVM_RPC } from './config';
import { keyStatus } from './claim4';
import { INST, type Env } from './v4';
import own from '../data/own.json';
import { fetchXvm, type XvmEvent } from './api';

const OWN = new Set(Object.values((own as { accounts: Record<string, string> }).accounts).map((a) => a.toLowerCase()));
export const isOwnAddress = (a: string) => OWN.has(a.toLowerCase());
const CHUNK = 9000n;
// Radar reads many log ranges (the RPC caps a getLogs range at 10,000 blocks). One call per range and contract asks for all
// of that contract's events at once, and up to 8 ranges run at the same time (JSON-RPC batches are slower on this node:
// measured 6.4 s for a batch of 16 against 1.9 s for 16 parallel calls).
const pub = createPublicClient({ chain: dianaChain, transport: http(EVM_RPC, { retryCount: 4, retryDelay: 400, timeout: 30_000 }) });

let active = 0; const waiting: (() => void)[] = [];
async function limited<T>(f: () => Promise<T>): Promise<T> {
  if (active >= 8) await new Promise<void>((r) => waiting.push(r));
  active++;
  try { return await f(); } finally { active--; waiting.shift()?.(); }
}
type Row = { eventName: string; args: Record<string, unknown>; transactionHash: Hex; blockNumber: bigint };
/** Every log of `events` from `address`, one getLogs per 9,000-block range, grouped by event name. */
async function logsOf(address: Hex, events: ReturnType<typeof getAbiItem>[], from: bigint, head: bigint): Promise<Record<string, Omit<Row, 'eventName'>[]>> {
  const ranges: [bigint, bigint][] = [];
  for (let f = from; f <= head; f += CHUNK) ranges.push([f, f + CHUNK - 1n > head ? head : f + CHUNK - 1n]);
  const parts = await Promise.all(ranges.map(([f, t]) => limited(() => pub.getLogs({ address, events: events as never, fromBlock: f, toBlock: t }) as unknown as Promise<Row[]>)));
  const out: Record<string, Omit<Row, 'eventName'>[]> = {};
  for (const e of events) out[(e as { name: string }).name] = [];
  for (const l of parts.flat()) out[l.eventName]?.push({ args: l.args ?? {}, transactionHash: l.transactionHash, blockNumber: l.blockNumber });
  return out;
}

export interface Split { own: number; external: number }
export interface EnvStats {
  env: Env;
  pockets: number; pocketsOwn: Split;
  drops: { created: number; bound: number; confirmed: number; claimed: number; cancelled: number };
  dropSenders: Split; dropRecipients: Split;
  pools: { created: number; slotsClaimed: number }; poolHosts: Split; poolClaimers: Split;
  /** newest first; `who` is the account behind the event, `at` the block time (unix seconds) when it could be read (UX-10) */
  recent: { kind: string; id: string; tx: Hex; block: bigint; who: string; own: boolean; at?: number }[];
  /** every pool slot claim: which account took it, where it was paid, own or external, and the tx (P4) */
  claimers: { pool: string; recipient: string; payTo: string; own: boolean; tx: Hex; block: bigint }[];
  /** events rebuilt from hybrid relays and merged in (null = the API index could not be read) */
  hybridEvents?: number | null;
  /** legacy-key telemetry (item 10): deployed Pockets by deploy block against the v2 key release */
  keyEras: KeyEras;
}

/** First Diana block after the v2 browser key derivation went live in production (2026-11-20 04:24:18 UTC). Same constant as backend/src/statsv4.ts. */
export const V2_RELEASE_BLOCK = 10412597n;
export interface KeyEras { v1Era: Split & { total: number; stillHoldingQor: number; stillHoldingExternal: number }; v2Era: Split & { total: number } }
export async function keyEras(deployed: { args: Record<string, unknown>; blockNumber: bigint }[], balance: (a: Hex) => Promise<bigint>): Promise<KeyEras> {
  const v1 = deployed.filter((d) => d.blockNumber < V2_RELEASE_BLOCK);
  const v2 = deployed.filter((d) => d.blockNumber >= V2_RELEASE_BLOCK);
  const bal = await Promise.all(v1.map((d) => balance(String(d.args.pocket) as Hex).catch(() => 0n)));
  const split = (xs: typeof deployed): Split => { const o = xs.filter((d) => isOwnAddress(String(d.args.owner))).length; return { own: o, external: xs.length - o }; };
  const holding = v1.filter((_, k) => bal[k] > 0n);
  return { v1Era: { total: v1.length, ...split(v1), stillHoldingQor: holding.length, stillHoldingExternal: holding.filter((d) => !isOwnAddress(String(d.args.owner))).length }, v2Era: { total: v2.length, ...split(v2) } };
}

/** /api/stats v4 must agree with what this page counts from the chain. Returns the fields that differ (empty = agree). */
export function compareWithApi(mine: EnvStats, api: { pockets?: number; drops?: { created?: number; claimed?: number }; pools?: { created?: number }; pocketsOwn?: Split } | undefined): string[] {
  if (!api) return ['missing'];
  const d: string[] = [];
  if (api.pockets !== mine.pockets) d.push('pockets');
  if (api.drops?.created !== mine.drops.created) d.push('drops created');
  if (api.drops?.claimed !== mine.drops.claimed) d.push('drops claimed');
  if (api.pools?.created !== mine.pools.created) d.push('pools created');
  if (api.pocketsOwn?.external !== mine.pocketsOwn.external) d.push('external Pocket owners');
  return d;
}

type Ev = { args: Record<string, unknown>; transactionHash: Hex; blockNumber: bigint };
/** Add the events of hybrid relays (a MsgCrossVMCall leaves no EVM log) to the log lists, in place. A Pocket already seen in
 *  PocketDeployed logs is never counted twice. Same rule as the API's /api/stats (backend statsv4.mergeHybrid). */
export function mergeHybrid(l: Record<string, Ev[]>, hy: XvmEvent[]): void {
  const deployed = new Set(l.PocketDeployed.map((d) => String(d.args.pocket).toLowerCase()));
  for (const e of hy) {
    const list = l[e.eventName];
    if (!list) continue;
    if (e.eventName === 'PocketDeployed') { const k = String(e.args.pocket).toLowerCase(); if (deployed.has(k)) continue; deployed.add(k); }
    list.push({ args: e.args, transactionHash: e.transactionHash as Hex, blockNumber: BigInt(e.blockNumber) });
  }
}

const bump = (s: Split, a: string) => { if (isOwnAddress(a)) s.own++; else s.external++; };

export async function envStats(env: Env): Promise<EnvStats> {
  const i = INST[env];
  const head = await pub.getBlockNumber();
  const ev = (abi: readonly unknown[], name: string) => getAbiItem({ abi: abi as never, name } as never);
  const hybridP = fetchXvm(env).catch(() => null); // native-lane index, fetched while the logs load
  const [fac, drp, pol] = await Promise.all([
    logsOf(i.factory, [ev(factoryAbi, 'PocketDeployed')], i.dropFromBlock, head),
    logsOf(i.drop, ['LinkCreated', 'LinkBound', 'LinkConfirmed', 'LinkClaimed', 'LinkCancelled'].map((n) => ev(dropAbi, n)), i.dropFromBlock, head),
    logsOf(i.pool, [ev(poolAbi, 'PoolCreated'), ev(poolAbi, 'PoolClaimed')], i.poolFromBlock, head),
  ]);
  const deployed = fac.PocketDeployed, created = drp.LinkCreated, bound = drp.LinkBound, confirmed = drp.LinkConfirmed, claimed = drp.LinkClaimed, cancelled = drp.LinkCancelled, poolsMade = pol.PoolCreated, poolClaims = pol.PoolClaimed;
  const hybrid = await hybridP;
  mergeHybrid({ PocketDeployed: deployed, LinkCreated: created, LinkBound: bound, LinkConfirmed: confirmed, LinkClaimed: claimed, LinkCancelled: cancelled, PoolCreated: poolsMade, PoolClaimed: poolClaims }, hybrid ?? []);
  const ownerOf = new Map<string, string>(deployed.map((d) => [String(d.args.pocket).toLowerCase(), String(d.args.owner)]));
  const pocketsOwn: Split = { own: 0, external: 0 };
  for (const d of deployed) bump(pocketsOwn, String(d.args.owner));
  const viaPocket = (p: unknown) => ownerOf.get(String(p).toLowerCase()) ?? String(p);
  const dropSenders: Split = { own: 0, external: 0 }; for (const c of created) bump(dropSenders, viaPocket(c.args.sender));
  const dropRecipients: Split = { own: 0, external: 0 }; for (const b of bound) bump(dropRecipients, String(b.args.recipient));
  const poolHosts: Split = { own: 0, external: 0 }; for (const p of poolsMade) bump(poolHosts, viaPocket(p.args.host));
  const poolClaimers: Split = { own: 0, external: 0 }; for (const c of poolClaims) bump(poolClaimers, String(c.args.recipient));
  const tag = (who: string) => ({ who, own: isOwnAddress(who) });
  const recipientOf = new Map<string, string>(bound.map((b) => [String(b.args.linkId), String(b.args.recipient)]));
  const idOf = (p: string, n: unknown) => `${p}${n}`;
  const pre = env === 'prod' ? 'p' : 'l';
  const recent: EnvStats['recent'] = [
    ...deployed.map((x) => ({ kind: 'Pocket deployed', id: String(x.args.pocket), tx: x.transactionHash, block: x.blockNumber, ...tag(String(x.args.owner)) })),
    ...created.map((x) => ({ kind: 'Drop created', id: idOf(pre, x.args.linkId), tx: x.transactionHash, block: x.blockNumber, ...tag(viaPocket(x.args.sender)) })),
    ...claimed.map((x) => ({ kind: 'Drop claimed', id: idOf(pre, x.args.linkId), tx: x.transactionHash, block: x.blockNumber, ...tag(recipientOf.get(String(x.args.linkId)) ?? '') })),
    ...poolsMade.map((x) => ({ kind: 'Pool created', id: idOf(pre, x.args.poolId), tx: x.transactionHash, block: x.blockNumber, ...tag(viaPocket(x.args.host)) })),
    ...poolClaims.map((x) => ({ kind: 'Pool slot claimed', id: idOf(pre, x.args.poolId), tx: x.transactionHash, block: x.blockNumber, ...tag(String(x.args.recipient)) })),
  ].sort((a, b) => (a.block === b.block ? 0 : a.block < b.block ? 1 : -1)).slice(0, 8);
  const times = await Promise.all([...new Set(recent.map((r) => r.block))].map(async (b) => [b, await pub.getBlock({ blockNumber: b }).then((x) => Number(x.timestamp)).catch(() => undefined)] as const));
  const tmap = new Map(times);
  for (const r of recent) r.at = tmap.get(r.block);
  const claimers: EnvStats['claimers'] = poolClaims.map((c) => ({
    pool: idOf(pre, c.args.poolId), recipient: String(c.args.recipient), payTo: String(c.args.payTo ?? ''), own: isOwnAddress(String(c.args.recipient)), tx: c.transactionHash, block: c.blockNumber,
  })).sort((a, b) => (a.block < b.block ? 1 : -1));
  const eras = await keyEras(deployed, (a) => pub.getBalance({ address: a }));
  return {
    keyEras: eras,
    env, pockets: deployed.length, pocketsOwn,
    drops: { created: created.length, bound: bound.length, confirmed: confirmed.length, claimed: claimed.length, cancelled: cancelled.length },
    dropSenders, dropRecipients, pools: { created: poolsMade.length, slotsClaimed: poolClaims.length }, poolHosts, poolClaimers, recent, claimers,
    hybridEvents: hybrid === null ? null : hybrid.length,
  };
}

export interface PqSample { sampled: number; notEnforceable: number; notRegistered: number; head: bigint; window: number }
/** Live sample: distinct senders of the most recent EVM transactions, each checked with the pqcKeyStatus precompile. NOT a census. */
export async function pqSample(maxAccounts = 30, scanBlocks = 120): Promise<PqSample> {
  const head = await pub.getBlockNumber();
  const seen = new Set<string>();
  const nums = Array.from({ length: scanBlocks }, (_, k) => head - BigInt(k));
  for (let k = 0; k < nums.length && seen.size < maxAccounts; k += 20) {
    const blocks = await Promise.all(nums.slice(k, k + 20).map((n) => pub.getBlock({ blockNumber: n, includeTransactions: true }).catch(() => null)));
    for (const b of blocks) for (const t of b?.transactions ?? []) if (typeof t !== 'string' && seen.size < maxAccounts) seen.add(t.from.toLowerCase());
  }
  const list = [...seen];
  const st = await Promise.all(list.map((a) => keyStatus(a as Hex).catch(() => null)));
  const ok = st.filter((x): x is NonNullable<typeof x> => !!x);
  return { sampled: ok.length, notEnforceable: ok.filter((x) => !x.possessionProven).length, notRegistered: ok.filter((x) => !x.registered).length, head, window: scanBlocks };
}

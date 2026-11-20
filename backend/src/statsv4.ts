// v4 statistics for /api/stats, computed exactly like the /radar page does from chain logs (so the two agree), plus
// legacy-key telemetry: which deployed Pockets were made while the app still derived keys the v1 way.
import { parseAbi, type Address, type Hex } from 'viem';
import { V4_INSTANCES, type V4Env } from './v4.js';
import type { OwnMap } from './stats.js';

/** First Diana block at or after the moment the v2 browser derivation went live in production
 *  (frontend deployment dpl_ELW885X5Vs2sNUwyzQwp1guDVtwR, ready 2026-11-20 04:24:18 UTC, commit 0643538 contains 43cc149). */
export const V2_RELEASE_BLOCK = 10412597n;
export const V4_FROM: Record<V4Env, { drop: bigint; pool: bigint }> = { prod: { drop: 10388441n, pool: 10388334n }, lab: { drop: 10388447n, pool: 10388349n } };

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
  return {
    env, pockets: l.PocketDeployed.length, pocketsOwn,
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
  for (const env of ['prod', 'lab'] as V4Env[]) {
    const i = V4_INSTANCES[env]; const f = V4_FROM[env];
    const names: [Address, EvName, bigint][] = [
      [i.factory, 'PocketDeployed', f.drop], [i.drop, 'LinkCreated', f.drop], [i.drop, 'LinkBound', f.drop], [i.drop, 'LinkConfirmed', f.drop],
      [i.drop, 'LinkClaimed', f.drop], [i.drop, 'LinkCancelled', f.drop], [i.pool, 'PoolCreated', f.pool], [i.pool, 'PoolClaimed', f.pool],
    ];
    const res = await Promise.all(names.map(([a, n, from]) => r.events(a, n, from, head)));
    const l = Object.fromEntries(names.map(([, n], k) => [n, res[k]])) as Record<EvName, EvLog[]>;
    out[env] = { ...buildV4Env(env, l, own), keyEras: await keyEras(l.PocketDeployed, own, r.balance) };
  }
  return { headBlock: head.toString(), ...out, note: 'Same method as /radar: v4 factory, drop and pool logs since deployment; own = listed in config/own-accounts.json. Counts are addresses, not people.' };
}

export function makeV4Reader(pub: any, chunk = 9000n): V4Reader {
  return {
    head: () => pub.getBlockNumber(),
    balance: (a) => pub.getBalance({ address: a }),
    async events(address, name, from, to) {
      const event = V4_EVENTS.find((e) => e.name === name)!;
      const out: EvLog[] = [];
      for (let f = from; f <= to; f += chunk) {
        const t = f + chunk - 1n > to ? to : f + chunk - 1n;
        const r = await pub.getLogs({ address, event, fromBlock: f, toBlock: t });
        for (const x of r) out.push({ args: x.args ?? {}, blockNumber: x.blockNumber, transactionHash: x.transactionHash });
      }
      return out;
    },
  };
}

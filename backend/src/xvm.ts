// Index of hybrid relays. A MsgCrossVMCall runs in the EVM but leaves no EVM log and no EVM tx (measured on Diana,
// 22 Nov 2026), so every reader that counts drops, pools, claims and Pockets from logs would miss them. This module finds
// every successful cross-VM call into a PocketRouter on the native lane (tx search on the crossvm_request event), decodes the
// router calldata and its return value, and rebuilds the same events the contracts would have logged. Fields that are not
// in the calldata (a claim's recipient and amount, a cancel's refund) are read from contract state.
import { decodeFunctionData, parseAbi, type Address, type Hex } from 'viem';
import { routerAbi } from './abi4.js';
import { crossVmResponses, hybridVerified, type Fetch, type TxResponse } from './cosmos.js';
import { decodeRouteReturn } from './route.js';
import { V4_INSTANCES, type V4Env } from './v4.js';
import type { EvLog } from './statsv4.js';

export const VAULT_CALLS = parseAbi([
  'function createDrop(address drop, bytes32 linkKeyHash, uint8 mode, uint64 expiry, uint96 drip, uint96 relayerFee, uint256 value, uint256 deadline, bytes sig) returns (uint256)',
  'function confirmDrop(address drop, uint256 linkId, bytes32 expectedRecipientKeyHash, uint256 deadline, bytes sig)',
  'function cancelDrop(address drop, uint256 linkId, uint256 deadline, bytes sig)',
  'function createPool(address pool, bytes32 linkKeyHash, uint32 slots, uint96 perSlot, uint64 expiry, uint256 deadline, bytes sig) returns (uint256)',
]);
export const DROP_CALLS = parseAbi([
  'function bind(uint256 linkId, address recipient, bytes32 recipientKeyHash, address payTo, bytes linkPk, bytes linkSig)',
  'function claim(uint256 linkId, bytes recipientSig)',
]);
export const POOL_CALLS = parseAbi(['function claim(uint256 poolId, address recipient, address payTo, bytes linkPk, bytes linkSig, bytes recipientSig)']);

export interface HybridRelay {
  hash: string; height: bigint; time: string; sender: string; memo: string; hybridVerified: boolean;
  action: 'relay' | 'deployAndRelay'; target: Address; owner?: Address; userSalt?: Hex; inner: Hex; result: Record<string, string>;
}
export interface XvmEvent extends EvLog { eventName: string; lane: 'hybrid' }
export interface LinkState { recipient: Address; payTo: Address; amount: bigint }
export interface XvmDeps { rest: string; fetch?: Fetch; readLink: (env: V4Env, id: bigint) => Promise<LinkState | null> }

/** Decode one tx found by the router search. null when it is not a successful cross-VM call into `router`. */
export function decodeHybridRelay(tx: TxResponse, router: string): HybridRelay | null {
  if (tx.code !== 0) return null;
  const m = (tx.tx?.body?.messages ?? []).find((x) => x['@type'] === '/qorechain.crossvm.v1.MsgCrossVMCall' && String(x.target_contract ?? '').toLowerCase() === router.toLowerCase());
  if (!m) return null;
  const payload = `0x${Buffer.from(String(m.payload ?? ''), 'base64').toString('hex')}` as Hex;
  let call: { functionName: string; args: readonly unknown[] };
  try { call = decodeFunctionData({ abi: routerAbi, data: payload }) as never; } catch { return null; }
  const ret = crossVmResponses(tx.data)[0]?.data;
  const base = { hash: tx.txhash, height: BigInt(tx.height), time: tx.timestamp ?? '', sender: String(m.sender ?? ''), memo: tx.tx?.body?.memo ?? '', hybridVerified: hybridVerified(tx) };
  if (call.functionName === 'relay') {
    const [target, inner] = call.args as [Address, Hex];
    return { ...base, action: 'relay', target, inner, result: decodeRouteReturn('relay', inner, ret) };
  }
  if (call.functionName === 'deployAndRelay') {
    const [owner, , , , userSalt, inner] = call.args as [Address, Address[], number, bigint, Hex, Hex];
    const result = decodeRouteReturn('deployAndRelay', inner, ret);
    if (!result.pocket) return null; // the Pocket address comes from the return value
    return { ...base, action: 'deployAndRelay', target: result.pocket as Address, owner, userSalt, inner, result };
  }
  return null;
}

/**
 * Rebuild the v4 events of hybrid relays. `deployedByLog` = Pockets already seen in PocketDeployed logs, so a Pocket deployed
 * by an EVM tx is never counted twice; otherwise the first deployAndRelay of a Pocket is its deployment.
 */
export async function eventsOf(env: V4Env, relays: HybridRelay[], deployedByLog: Set<string>, readLink: XvmDeps['readLink']): Promise<XvmEvent[]> {
  const i = V4_INSTANCES[env];
  const out: XvmEvent[] = [];
  const seen = new Set(deployedByLog);
  const boundTo = new Map<string, Address>();
  const ev = (r: HybridRelay, eventName: string, args: Record<string, unknown>) => out.push({ eventName, args, blockNumber: r.height, transactionHash: r.hash as Hex, lane: 'hybrid' });
  for (const r of [...relays].sort((a, b) => (a.height < b.height ? -1 : a.height > b.height ? 1 : 0))) {
    const pocketKey = r.target.toLowerCase();
    if (r.action === 'deployAndRelay' && !seen.has(pocketKey)) { seen.add(pocketKey); ev(r, 'PocketDeployed', { pocket: r.target, owner: r.owner, salt: r.userSalt }); }
    if (r.inner === '0x') continue;
    if (pocketKey === i.drop.toLowerCase()) {
      let c; try { c = decodeFunctionData({ abi: DROP_CALLS, data: r.inner }); } catch { continue; }
      if (c.functionName === 'bind') {
        const [linkId, recipient, recipientKeyHash, payTo] = c.args;
        boundTo.set(linkId.toString(), recipient);
        ev(r, 'LinkBound', { linkId, recipient, payTo, recipientKeyHash, relayer: r.sender });
      } else {
        const [linkId] = c.args;
        const s = await readLink(env, linkId).catch(() => null);
        ev(r, 'LinkClaimed', { linkId, recipient: s?.recipient ?? boundTo.get(linkId.toString()), payTo: s?.payTo, amount: s?.amount, relayer: r.sender });
      }
      continue;
    }
    if (pocketKey === i.pool.toLowerCase()) {
      let c; try { c = decodeFunctionData({ abi: POOL_CALLS, data: r.inner }); } catch { continue; }
      const [poolId, recipient, payTo] = c.args;
      ev(r, 'PoolClaimed', { poolId, recipient, payTo, relayer: r.sender });
      continue;
    }
    // otherwise the target is a Pocket (the router only forwards to Pockets, the drop and the pool)
    let c; try { c = decodeFunctionData({ abi: VAULT_CALLS, data: r.inner }); } catch { continue; } // spends, guardians, limits: no stats event
    if (c.functionName === 'createDrop' && r.result.linkId) {
      const [, linkKeyHash, mode, expiry, drip, relayerFee, value] = c.args;
      ev(r, 'LinkCreated', { linkId: BigInt(r.result.linkId), sender: r.target, mode, amount: value - BigInt(drip) - BigInt(relayerFee), drip: BigInt(drip), relayerFee: BigInt(relayerFee), expiry, linkKeyHash });
    } else if (c.functionName === 'createPool' && r.result.poolId) {
      const [, linkKeyHash, slots, perSlot, expiry] = c.args;
      ev(r, 'PoolCreated', { poolId: BigInt(r.result.poolId), host: r.target, slots, perSlot: BigInt(perSlot), expiry, linkKeyHash });
    } else if (c.functionName === 'confirmDrop') {
      const [, linkId, recipientKeyHash] = c.args;
      ev(r, 'LinkConfirmed', { linkId, recipient: boundTo.get(linkId.toString()), recipientKeyHash });
    } else if (c.functionName === 'cancelDrop') {
      const [, linkId] = c.args;
      const s = await readLink(env, linkId).catch(() => null);
      ev(r, 'LinkCancelled', { linkId, sender: r.target, refunded: s?.amount });
    }
  }
  return out;
}

/** Every successful cross-VM call into `router`, oldest first (tx search on the crossvm_request event, paged). */
export async function searchRouterTxs(rest: string, router: string, f: Fetch = fetch, pageSize = 100, maxPages = 20): Promise<TxResponse[]> {
  const q = encodeURIComponent(`crossvm_request.target_contract='${router.toLowerCase()}'`);
  const out: TxResponse[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const r = await f(`${rest}/cosmos/tx/v1beta1/txs?query=${q}&order_by=ORDER_BY_ASC&page=${page}&limit=${pageSize}`, { signal: AbortSignal.timeout(20_000) });
    if (!r.ok) throw new Error(`tx search HTTP ${r.status}`);
    const j = (await r.json()) as { tx_responses?: TxResponse[]; total?: string; pagination?: { total?: string } };
    const got = j.tx_responses ?? [];
    out.push(...got);
    const total = Number(j.total ?? j.pagination?.total ?? 0);
    if (got.length < pageSize || out.length >= total) break;
  }
  return out;
}

const cache = new Map<V4Env, { at: number; relays: HybridRelay[] }>();
/** Hybrid relays of one instance, cached for `ttlMs` per function instance. */
export async function hybridRelays(env: V4Env, rest: string, f: Fetch = fetch, ttlMs = 15_000): Promise<HybridRelay[]> {
  const c = cache.get(env);
  if (c && Date.now() - c.at < ttlMs) return c.relays;
  const router = V4_INSTANCES[env].router;
  const relays = (await searchRouterTxs(rest.replace(/\/$/, ''), router, f)).map((t) => decodeHybridRelay(t, router)).filter((x): x is HybridRelay => !!x);
  cache.set(env, { at: Date.now(), relays });
  return relays;
}
export const clearXvmCache = () => cache.clear();

/** JSON-safe copy (bigints as decimal strings). */
export const jsonSafe = <T>(x: T): unknown => JSON.parse(JSON.stringify(x, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));

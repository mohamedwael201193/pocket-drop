// The sender's drops and pools, rebuilt from chain events (sender / host is an indexed topic), so any device holding the key sees them.
// A link's seed is re-derived from the root and the vault nonce it was created at (see actions.linkSeed); the nonce is cached locally
// and, when missing, found by trying recent nonces against the on-chain link key hash.
import { getAbiItem, keccak256, type Hex } from 'viem';
import { dropAbi, poolAbi } from './abi4';
import { pub } from './chain';
import { linkSeed } from './actions';
import { INST, type Env } from './v4';
import { bytesToHex } from './protocol';
import { fetchXvm, type XvmEvent } from './api';

const CHUNK = 9000n; // the RPC allows at most 10,000 blocks per getLogs
const evDrop = getAbiItem({ abi: dropAbi, name: 'LinkCreated' });
const evPool = getAbiItem({ abi: poolAbi, name: 'PoolCreated' });

export interface Created { kind: 'drop' | 'pool'; id: bigint; txHash: Hex; linkKeyHash: Hex; amountWei: bigint; mode?: 'Confirmed' | 'Open'; slots?: number; perSlot?: bigint }
const cache = new Map<string, { upTo: bigint; items: Map<string, Created> }>();

async function scan(env: Env, kind: 'drop' | 'pool', who: Hex, c: { upTo: bigint; items: Map<string, Created> }, head: bigint) {
  const address = kind === 'drop' ? INST[env].drop : INST[env].pool;
  for (let from = c.upTo + 1n; from <= head; from += CHUNK) {
    const to = from + CHUNK - 1n > head ? head : from + CHUNK - 1n;
    const logs = kind === 'drop'
      ? await pub.getLogs({ address, event: evDrop, args: { sender: who }, fromBlock: from, toBlock: to })
      : await pub.getLogs({ address, event: evPool, args: { host: who }, fromBlock: from, toBlock: to });
    for (const l of logs) {
      const a = l.args as Record<string, unknown>;
      const id = (kind === 'drop' ? a.linkId : a.poolId) as bigint;
      c.items.set(`${kind}:${id}`, kind === 'drop'
        ? { kind, id, txHash: l.transactionHash as Hex, linkKeyHash: a.linkKeyHash as Hex, amountWei: a.amount as bigint, mode: Number(a.mode) === 0 ? 'Confirmed' : 'Open' }
        : { kind, id, txHash: l.transactionHash as Hex, linkKeyHash: a.linkKeyHash as Hex, amountWei: BigInt(a.slots as number) * (a.perSlot as bigint), slots: Number(a.slots), perSlot: a.perSlot as bigint });
    }
  }
}

export async function scanCreated(env: Env, pocket: Hex): Promise<Created[]> {
  const key = `${env}:${pocket.toLowerCase()}`;
  const head = await pub.getBlockNumber();
  const drops = cache.get(`d:${key}`) ?? { upTo: INST[env].dropFromBlock - 1n, items: new Map<string, Created>() };
  const pools = cache.get(`p:${key}`) ?? { upTo: INST[env].poolFromBlock - 1n, items: new Map<string, Created>() };
  await scan(env, 'drop', pocket, drops, head); drops.upTo = head;
  await scan(env, 'pool', pocket, pools, head); pools.upTo = head;
  cache.set(`d:${key}`, drops); cache.set(`p:${key}`, pools);
  const hybrid = hybridCreated(await fetchXvm(env).catch(() => [] as XvmEvent[]), pocket);
  const all = new Map<string, Created>([...drops.items, ...pools.items]);
  for (const c of hybrid) if (!all.has(`${c.kind}:${c.id}`)) all.set(`${c.kind}:${c.id}`, c);
  return [...all.values()].sort((x, y) => (x.id === y.id ? 0 : x.id < y.id ? 1 : -1));
}

/** Drops and pools this Pocket created through hybrid relays (no EVM log), from the API's native-lane index. */
export function hybridCreated(events: XvmEvent[], pocket: Hex): Created[] {
  const me = pocket.toLowerCase();
  const out: Created[] = [];
  for (const e of events) {
    const a = e.args;
    if (e.eventName === 'LinkCreated' && String(a.sender).toLowerCase() === me) {
      out.push({ kind: 'drop', id: BigInt(String(a.linkId)), txHash: e.transactionHash as Hex, linkKeyHash: a.linkKeyHash as Hex, amountWei: BigInt(String(a.amount)), mode: Number(a.mode) === 0 ? 'Confirmed' : 'Open' });
    } else if (e.eventName === 'PoolCreated' && String(a.host).toLowerCase() === me) {
      const slots = Number(a.slots), perSlot = BigInt(String(a.perSlot));
      out.push({ kind: 'pool', id: BigInt(String(a.poolId)), txHash: e.transactionHash as Hex, linkKeyHash: a.linkKeyHash as Hex, amountWei: BigInt(slots) * perSlot, slots, perSlot });
    }
  }
  return out;
}

const nonceKey = (env: Env, kind: string, id: bigint) => `pd.l4n.${env}.${kind}.${id}`;
export const rememberNonce = (env: Env, kind: 'drop' | 'pool', id: bigint, nonce: bigint) => { try { localStorage.setItem(nonceKey(env, kind, id), nonce.toString()); } catch { /* ignore */ } };

/** Seed of one of my links: cached nonce first, else try nonces 0..maxNonce until the derived link key matches the on-chain hash. */
export async function findSeed(root: string, env: Env, c: Created, maxNonce: number): Promise<Uint8Array | null> {
  const { mldsa } = await import('@qorechain/pqc');
  const match = async (n: bigint) => {
    const seed = await linkSeed(root, n);
    return keccak256(bytesToHex(mldsa.keygen(seed).publicKey)) === c.linkKeyHash ? seed : null;
  };
  let cached: string | null = null;
  try { cached = localStorage.getItem(nonceKey(env, c.kind, c.id)); } catch { /* ignore */ }
  if (cached) { const s = await match(BigInt(cached)); if (s) return s; }
  for (let n = 0; n <= maxNonce; n++) {
    const s = await match(BigInt(n));
    if (s) { rememberNonce(env, c.kind, c.id, BigInt(n)); return s; }
  }
  return null;
}

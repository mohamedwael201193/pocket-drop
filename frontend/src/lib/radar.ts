// Live v4 statistics straight from chain logs (no backend): Pockets deployed, drops and pools, own vs external accounts,
// and a live pqcKeyStatus sample of recent senders on Diana.
import { getAbiItem, type Hex } from 'viem';
import { dropAbi, factoryAbi, poolAbi } from './abi4';
import { pub } from './chain';
import { keyStatus } from './claim4';
import { INST, type Env } from './v4';
import own from '../data/own.json';

const OWN = new Set(Object.values((own as { accounts: Record<string, string> }).accounts).map((a) => a.toLowerCase()));
export const isOwnAddress = (a: string) => OWN.has(a.toLowerCase());
const CHUNK = 9000n;

async function logs(address: Hex, event: ReturnType<typeof getAbiItem>, from: bigint, head: bigint) {
  const out: { args: Record<string, unknown>; transactionHash: Hex; blockNumber: bigint }[] = [];
  for (let f = from; f <= head; f += CHUNK) {
    const t = f + CHUNK - 1n > head ? head : f + CHUNK - 1n;
    const r = (await pub.getLogs({ address, event: event as never, fromBlock: f, toBlock: t })) as unknown as { transactionHash: Hex; blockNumber: bigint; args?: Record<string, unknown> }[];
    for (const l of r) out.push({ args: l.args ?? {}, transactionHash: l.transactionHash, blockNumber: l.blockNumber });
  }
  return out;
}

export interface Split { own: number; external: number }
export interface EnvStats {
  env: Env;
  pockets: number; pocketsOwn: Split;
  drops: { created: number; bound: number; confirmed: number; claimed: number; cancelled: number };
  dropSenders: Split; dropRecipients: Split;
  pools: { created: number; slotsClaimed: number }; poolHosts: Split; poolClaimers: Split;
  recent: { kind: string; id: string; tx: Hex; block: bigint }[];
}

const bump = (s: Split, a: string) => { if (isOwnAddress(a)) s.own++; else s.external++; };

export async function envStats(env: Env): Promise<EnvStats> {
  const i = INST[env];
  const head = await pub.getBlockNumber();
  const ev = (abi: readonly unknown[], name: string) => getAbiItem({ abi: abi as never, name } as never);
  const [deployed, created, bound, confirmed, claimed, cancelled, poolsMade, poolClaims] = await Promise.all([
    logs(i.factory, ev(factoryAbi, 'PocketDeployed'), i.dropFromBlock, head),
    logs(i.drop, ev(dropAbi, 'LinkCreated'), i.dropFromBlock, head),
    logs(i.drop, ev(dropAbi, 'LinkBound'), i.dropFromBlock, head),
    logs(i.drop, ev(dropAbi, 'LinkConfirmed'), i.dropFromBlock, head),
    logs(i.drop, ev(dropAbi, 'LinkClaimed'), i.dropFromBlock, head),
    logs(i.drop, ev(dropAbi, 'LinkCancelled'), i.dropFromBlock, head),
    logs(i.pool, ev(poolAbi, 'PoolCreated'), i.poolFromBlock, head),
    logs(i.pool, ev(poolAbi, 'PoolClaimed'), i.poolFromBlock, head),
  ]);
  const ownerOf = new Map<string, string>(deployed.map((d) => [String(d.args.pocket).toLowerCase(), String(d.args.owner)]));
  const pocketsOwn: Split = { own: 0, external: 0 };
  for (const d of deployed) bump(pocketsOwn, String(d.args.owner));
  const viaPocket = (p: unknown) => ownerOf.get(String(p).toLowerCase()) ?? String(p);
  const dropSenders: Split = { own: 0, external: 0 }; for (const c of created) bump(dropSenders, viaPocket(c.args.sender));
  const dropRecipients: Split = { own: 0, external: 0 }; for (const b of bound) bump(dropRecipients, String(b.args.recipient));
  const poolHosts: Split = { own: 0, external: 0 }; for (const p of poolsMade) bump(poolHosts, viaPocket(p.args.host));
  const poolClaimers: Split = { own: 0, external: 0 }; for (const c of poolClaims) bump(poolClaimers, String(c.args.recipient));
  const recent = [
    ...deployed.map((x) => ({ kind: 'Pocket deployed', id: String(x.args.pocket).slice(0, 10) + '…', tx: x.transactionHash, block: x.blockNumber })),
    ...created.map((x) => ({ kind: 'Drop created', id: `#${x.args.linkId}`, tx: x.transactionHash, block: x.blockNumber })),
    ...claimed.map((x) => ({ kind: 'Drop claimed', id: `#${x.args.linkId}`, tx: x.transactionHash, block: x.blockNumber })),
    ...poolsMade.map((x) => ({ kind: 'Pool created', id: `#${x.args.poolId}`, tx: x.transactionHash, block: x.blockNumber })),
    ...poolClaims.map((x) => ({ kind: 'Pool slot claimed', id: `#${x.args.poolId}`, tx: x.transactionHash, block: x.blockNumber })),
  ].sort((a, b) => (a.block === b.block ? 0 : a.block < b.block ? 1 : -1)).slice(0, 8);
  return {
    env, pockets: deployed.length, pocketsOwn,
    drops: { created: created.length, bound: bound.length, confirmed: confirmed.length, claimed: claimed.length, cancelled: cancelled.length },
    dropSenders, dropRecipients, pools: { created: poolsMade.length, slotsClaimed: poolClaims.length }, poolHosts, poolClaimers, recent,
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

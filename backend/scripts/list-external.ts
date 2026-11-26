// Lists every address that /api/stats would count as external (not in config/own-accounts.json), per contract
// version and role, with the tx that put it there. Read-only: chain logs and the native lane only, no keys.
// Run: npx vite-node scripts/list-external.ts
import { createPublicClient, http, type Address } from 'viem';
import { getConfig } from '../src/config.js';
import { loadOwnAccounts, collectLogs, buildStats, readV3Link } from '../src/stats.js';
import { searchRouterTxs } from '../src/xvm.js';
import { v3HybridLogs } from '../src/xvmV3.js';
import { makeV4Reader, mergeHybrid, V4_FROM } from '../src/statsv4.js';
import { hybridEventsFor } from '../src/xvmLive.js';
import { V4_INSTANCES, type V4Env } from '../src/v4.js';

const V3 = '0x29F53b4B8031E7bA1785dC8C7a1C0Be413a4bd97' as Address;
const cfg = getConfig();
const own = loadOwnAccounts();
const pub = createPublicClient({ transport: http(cfg.evmRpc) }) as any;
const r = makeV4Reader(pub, 9000n, (env) => hybridEventsFor(env, cfg, pub));
const head = await r.head();
const out: { version: string; role: string; address: string; tx: string; block: string }[] = [];
for (const env of ['prod', 'lab', 'prodV51', 'labV51', 'prodV5', 'labV5', 'prodV4', 'labV4'] as V4Env[]) {
  const i = V4_INSTANCES[env]; const f = V4_FROM[env];
  const ev = async (a: Address, n: string, from: bigint) => r.events(a, n as never, from, head);
  const l: any = {
    PocketDeployed: await ev(i.factory, 'PocketDeployed', f.drop), LinkCreated: await ev(i.drop, 'LinkCreated', f.drop),
    LinkBound: await ev(i.drop, 'LinkBound', f.drop), LinkConfirmed: await ev(i.drop, 'LinkConfirmed', f.drop),
    LinkClaimed: await ev(i.drop, 'LinkClaimed', f.drop), LinkCancelled: await ev(i.drop, 'LinkCancelled', f.drop),
    PoolCreated: await ev(i.pool, 'PoolCreated', f.pool), PoolClaimed: await ev(i.pool, 'PoolClaimed', f.pool),
  };
  const m: any = mergeHybrid(l, (await r.hybrid!(env).catch(() => [])) as never);
  const ownerOf = new Map(m.PocketDeployed.map((d: any) => [String(d.args.pocket).toLowerCase(), String(d.args.owner)]));
  const via = (p: unknown) => (ownerOf.get(String(p).toLowerCase()) as string) ?? String(p);
  const roles: [string, string, (e: any) => string][] = [
    ['pocketOwner', 'PocketDeployed', (e) => String(e.args.owner)], ['dropSender', 'LinkCreated', (e) => via(e.args.sender)],
    ['dropRecipient', 'LinkBound', (e) => String(e.args.recipient)], ['poolHost', 'PoolCreated', (e) => via(e.args.host)],
    ['poolClaimer', 'PoolClaimed', (e) => String(e.args.recipient)],
  ];
  for (const [role, n, get] of roles) for (const e of m[n]) {
    const a = get(e);
    if (!own.has(a.toLowerCase())) out.push({ version: env, role, address: a, tx: String(e.transactionHash), block: String(e.blockNumber) });
  }
}
const from = cfg.deployBlock ?? head - cfg.statsLookback; // same window as the deployed /api/stats
const { logs } = await collectLogs(pub, V3, from, head);
const v3hy = await v3HybridLogs(await searchRouterTxs(cfg.rest.replace(/\/$/, ''), V3), V3, readV3Link(pub, V3));
for (const l of [...logs, ...v3hy]) for (const e of buildStats([l], own).recent) for (const a of e.addresses) if (!a.own) out.push({ version: 'v3', role: a.role, address: a.address, tx: e.txHash, block: e.blockNumber });
console.log(JSON.stringify({ head: head.toString(), ownListed: own.size, external: out }, null, 2));

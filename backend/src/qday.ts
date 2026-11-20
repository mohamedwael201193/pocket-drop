// Q-Day drill ("Steal this Pocket"): live state of the TEAM-RUN bait Pockets, a breach alarm, and three honest logs:
//   1. on-chain attempts by anyone (found with CometBFT tx_search on the router / drop / bait addresses, decoded here),
//   2. attempts our relayer refused (kept in this server instance's memory since its last start),
//   3. the hourly team attacker bot (GitHub Actions runs of qday-bot.yml + its on-chain attempts, input marker QDAYBOT1).
// Classical bait keys are served ONLY when QDAY_PUBLISH_KEYS=true and QDAY_BAIT_KEYS holds them (a server secret).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeEventLog, decodeFunctionData, encodeFunctionData, decodeFunctionResult, keccak256, parseAbi, type Address, type Hex, type Log } from 'viem';
import { routerAbi } from './abi4.js';
import { EXPLORER_TX, type Config } from './config.js';
import { log } from './log.js';
import type { Limiter, Rule } from './ratelimit.js';
import type { Relayer } from './relayer.js';
import { reply, type HttpResult } from './handlers.js';
import { privateKeyToAccount } from 'viem/accounts';

export interface Bait {
  id: string; description: string; keyAccount: Address; keyAccountCosmos: string; pocket: Address; deployed: boolean;
  config: { owner: Address; guardians: Address[]; threshold: number; dailyLimitWei: string; userSalt: Hex };
  ownerKeyHash: Hex; planned: unknown; expectedMinWei: string;
}
export interface QdayConfig { fromBlock: number; router: Address; drop: Address; baits: Bait[]; teamAccounts: Record<string, Address>; planned: { hash: string; step: string }[]; before: Record<string, string>; after: Record<string, string> }

export function loadQdayConfig(file?: string): QdayConfig {
  const c = file ? [file] : [path.join(process.cwd(), 'config', 'qday-baits.json')];
  try { c.push(fileURLToPath(new URL('../config/qday-baits.json', import.meta.url))); } catch { /* no file URL */ }
  for (const f of c) { try { return JSON.parse(fs.readFileSync(f, 'utf8')) as QdayConfig; } catch { /* next */ } }
  throw new Error('config/qday-baits.json missing');
}

/** Bait classical keys, only when publishing is switched on. Every key must match its bait's key account. */
export function publishedKeys(env: Record<string, string | undefined>, baits: Bait[]): Record<string, Hex> | null {
  if (env.QDAY_PUBLISH_KEYS?.trim() !== 'true' || !env.QDAY_BAIT_KEYS) return null;
  let raw: Record<string, string>;
  try { raw = JSON.parse(env.QDAY_BAIT_KEYS); } catch { return null; }
  const out: Record<string, Hex> = {};
  for (const b of baits) {
    const k = raw[b.id]?.trim(); if (!k) continue;
    const key = (k.startsWith('0x') ? k : `0x${k}`) as Hex;
    if (!/^0x[0-9a-fA-F]{64}$/.test(key)) continue;
    if (privateKeyToAccount(key).address.toLowerCase() !== b.keyAccount.toLowerCase()) continue; // never serve a non-bait key
    out[b.id] = key;
  }
  return out;
}

export const MARKERS = { bot: '0x51444159424f5431', try: '0x5144415954525931' } as const; // "QDAYBOT1", "QDAYTRY1"
export const markerOf = (input: string): 'bot' | 'try' | null => {
  const t = input.toLowerCase();
  if (t.endsWith(MARKERS.bot.slice(2))) return 'bot';
  if (t.endsWith(MARKERS.try.slice(2))) return 'try';
  return null;
};

const VAULT_FN = parseAbi([
  'function spend(address,uint256,uint256,bytes)', 'function setGuardians(address[],uint8,uint256,bytes)', 'function setLimit(uint256,uint256,bytes)',
  'function cancelPending(uint256,bytes)', 'function vetoQueued(uint256,uint256,bytes)', 'function executeQueued(uint256)', 'function vetoRecovery(uint256,bytes)',
  'function createDrop(address,bytes32,uint8,uint64,uint96,uint96,uint256,uint256,bytes)', 'function confirmDrop(address,uint256,bytes32,uint256,bytes)',
  'function cancelDrop(address,uint256,uint256,bytes)', 'function createPool(address,bytes32,uint32,uint96,uint64,uint256,bytes)', 'function closePool(address,uint256,uint256,bytes)',
  'function proposeRecovery(address,bytes32,uint256,address[],bytes[])', 'function proposeRecoveryUnanimous(address,bytes32,uint256,address[],bytes[])',
  'function finalizeRecovery()', 'function finalizeRecoveryUnanimous()', 'function guardianFreeze(address[],bytes[],uint256,uint256)',
]);
const DROP_FN = parseAbi(['function claim(uint256,bytes)', 'function cancel(uint256)', 'function bind(uint256,address,bytes32,address,bytes,bytes)', 'function refund(uint256)']);

/** Which bait (if any) a router / drop / direct call touches, and what it tries. */
export function classify(to: string, input: Hex, cfg: QdayConfig): { bait: string; call: string } | null {
  const lc = to.toLowerCase();
  const byPocket = new Map(cfg.baits.map((b) => [b.pocket.toLowerCase(), b.id]));
  const byOwner = new Map(cfg.baits.map((b) => [b.config.owner.toLowerCase(), b.id]));
  const b4 = cfg.baits.find((b) => (b.planned as any)?.drop);
  const inner = (target: string, data: Hex): { bait: string; call: string } | null => {
    const t = target.toLowerCase();
    if (byPocket.has(t)) { let fn = data === '0x' ? 'fund' : 'unknown'; try { fn = decodeFunctionData({ abi: VAULT_FN, data }).functionName; } catch { /* raw */ } return { bait: byPocket.get(t)!, call: fn }; }
    if (t === cfg.drop.toLowerCase() && b4) {
      try { const d = decodeFunctionData({ abi: DROP_FN, data }); if (String(d.args?.[0]) === String((b4.planned as any).drop.linkId)) return { bait: b4.id, call: `drop.${d.functionName}` }; } catch { /* other */ }
    }
    return null;
  };
  if (lc === cfg.router.toLowerCase()) {
    try {
      const d = decodeFunctionData({ abi: routerAbi, data: input });
      if (d.functionName === 'relay') return inner(d.args[0] as string, d.args[1] as Hex);
      if (d.functionName === 'deployAndRelay') { const id = byOwner.get(String(d.args[0]).toLowerCase()); if (id) { const b = cfg.baits.find((x) => x.id === id)!; const r = inner(b.pocket, d.args[5] as Hex); return { bait: id, call: r?.call ?? 'deploy' }; } }
    } catch { return null; }
    return null;
  }
  return inner(lc, input);
}

/* ---------------- in-memory refusal log (column 2) ---------------- */
export interface Refusal { at: string; bait: string; call: string; error: string; via: 'route' | 'qday' }
const refusals: Refusal[] = [];
export const instanceStartedAt = new Date().toISOString();
export function noteRefusal(r: Omit<Refusal, 'at'>) { refusals.unshift({ at: new Date().toISOString(), ...r }); refusals.length = Math.min(refusals.length, 100); log('info', 'qday.refused', r as any); }
export const listRefusals = () => refusals.slice();
/** Called by /api/route on a simulate revert: records it when the target is a bait. */
export function noteRouteRefusal(routerData: Hex, router: string, error: string) {
  try { const cfg = loadQdayConfig(); const c = classify(router, routerData, cfg); if (c) noteRefusal({ bait: c.bait, call: c.call, error, via: 'route' }); } catch { /* never break routing */ }
}

/* ---------------- chain reads ---------------- */
export interface Chain {
  getBalance(a: Address): Promise<bigint>;
  call(to: Address, data: Hex): Promise<Hex>;
  getLogs(address: Address, fromBlock: bigint): Promise<Log[]>;
  getTx(hash: Hex): Promise<{ input: Hex; from: Address; to: Address | null } | null>;
  getCode(a: Address): Promise<Hex>;
  readNonce(pocket: Address): Promise<bigint>;
  windowLive(cosmos: string): Promise<boolean | null>;
  txSearch(query: string, perPage: number): Promise<{ height: string; events: { type: string; attributes: { key: string; value: string }[] }[] }[]>;
  botRuns(): Promise<{ id: number; status: string; conclusion: string | null; createdAt: string; url: string }[]>;
}

const KS = parseAbi(['function pqcKeyStatus(address) view returns (bool,uint8,bytes,bool)']);
const EVENTS = parseAbi([
  'event Spent(address indexed to, uint256 amount)', 'event SpendQueued(uint256 indexed id, address indexed to, uint256 amount, uint64 unlockAt)',
  'event QueuedExecuted(uint256 indexed id, address indexed to, uint256 amount)', 'event QueuedVetoed(uint256 indexed id)',
  'event LimitRaiseQueued(uint256 newLimit, uint64 unlockAt)', 'event LimitSet(uint256 dailyLimit)', 'event GuardiansQueued(address[] guardians, uint8 threshold, uint64 unlockAt)',
  'event GuardiansApplied(address[] guardians, uint8 threshold)', 'event PendingCancelled()', 'event RecoveryProposed(address indexed newOwner, bytes32 newKeyHash, uint64 finalizeAfter, uint256 recoveryNonce)',
  'event UnanimousRecoveryProposed(address indexed newOwner, bytes32 newKeyHash, uint64 finalizeAfter, uint256 recoveryNonce)', 'event RecoveryFinalized(address indexed oldOwner, address indexed newOwner, bytes32 newKeyHash)',
  'event RecoveryVetoed()', 'event GuardianFrozen(uint64 frozenUntil, uint256 freezeNonce, uint8 streak)', 'event DropCreated(address indexed drop, uint256 indexed linkId, uint256 value)',
  'event DropCancelled(address indexed drop, uint256 indexed linkId)', 'event PoolCreated(address indexed pool, uint256 indexed poolId, uint256 value)',
  'event Initialized(address indexed factory, address indexed owner, bytes32 ownerKeyHash, uint256 dailyLimit)', 'event Received(address indexed from, uint256 amount)',
]);
const HARMLESS = new Set(['Initialized', 'Received']);

export interface BaitState {
  id: string; description: string; keyAccount: Address; keyAccountCosmos: string; pocket: Address; deployed: boolean; config: Bait['config'];
  classicalKey: Hex | null; pocketWei: string; keyAccountWei: string; ownerKeyHash: Hex; liveKeyHash: Hex | null; keyUnchanged: boolean;
  windowLive: boolean | null; nonce: string; planned: unknown; events: { name: string; tx: string; planned: boolean }[]; alarm: string[];
}

export async function baitState(b: Bait, ch: Chain, cfg: QdayConfig, keys: Record<string, Hex> | null): Promise<BaitState> {
  const plannedTx = new Set(cfg.planned.map((p) => p.hash.toLowerCase()));
  const [pw, kw, ksRaw, code, wl] = await Promise.all([ch.getBalance(b.pocket), ch.getBalance(b.keyAccount),
    ch.call('0x0000000000000000000000000000000000000a02', encodeFunctionData({ abi: KS, functionName: 'pqcKeyStatus', args: [b.keyAccount] })).catch(() => null),
    ch.getCode(b.pocket).catch(() => '0x' as Hex), ch.windowLive(b.keyAccountCosmos).catch(() => null)]);
  let liveKeyHash: Hex | null = null;
  if (ksRaw) { try { const r = decodeFunctionResult({ abi: KS, functionName: 'pqcKeyStatus', data: ksRaw }); liveKeyHash = r[2] && r[2] !== '0x' ? keccak256(r[2]) : null; } catch { /* unreadable */ } }
  const deployed = code !== '0x';
  const nonce = deployed ? await ch.readNonce(b.pocket).catch(() => 0n) : 0n;
  const events: BaitState['events'] = [];
  if (deployed) {
    for (const l of await ch.getLogs(b.pocket, BigInt(cfg.fromBlock)).catch(() => [] as Log[])) {
      try { const d = decodeEventLog({ abi: EVENTS, data: l.data, topics: l.topics as any }); if (!HARMLESS.has(d.eventName)) events.push({ name: d.eventName, tx: String(l.transactionHash), planned: plannedTx.has(String(l.transactionHash).toLowerCase()) || (d.eventName === 'QueuedExecuted' && b.id === 'B3') }); } catch { /* foreign */ }
    }
  }
  const alarm: string[] = [];
  if (liveKeyHash && liveKeyHash.toLowerCase() !== b.ownerKeyHash.toLowerCase()) alarm.push('registered post-quantum key changed');
  if (wl === true) alarm.push('an EVM window is live on the key account (the classical key could use it)');
  if (pw < BigInt(b.expectedMinWei)) alarm.push('Pocket balance dropped below what the team left in it');
  for (const e of events) if (!e.planned) alarm.push(`unplanned ${e.name} event (${e.tx})`);
  return {
    id: b.id, description: b.description, keyAccount: b.keyAccount, keyAccountCosmos: b.keyAccountCosmos, pocket: b.pocket, deployed, config: b.config,
    classicalKey: keys?.[b.id] ?? null, pocketWei: pw.toString(), keyAccountWei: kw.toString(), ownerKeyHash: b.ownerKeyHash, liveKeyHash,
    keyUnchanged: !!liveKeyHash && liveKeyHash.toLowerCase() === b.ownerKeyHash.toLowerCase(), windowLive: wl, nonce: nonce.toString(), planned: b.planned, events, alarm,
  };
}

export interface Attempt { tx: string; height: number; from: string; bait: string; call: string; failed: boolean; error: string | null; source: 'anyone' | 'try-it' | 'team-bot' | 'team-setup'; explorer: string }

export async function onChainAttempts(ch: Chain, cfg: QdayConfig): Promise<Attempt[]> {
  const team = new Set(Object.values(cfg.teamAccounts).map((a) => a.toLowerCase()));
  const plannedTx = new Set(cfg.planned.map((p) => p.hash.toLowerCase()));
  const targets = [cfg.router, cfg.drop, ...cfg.baits.map((b) => b.pocket)];
  const seen = new Map<string, { height: number; failed: boolean; error: string | null }>();
  for (const t of targets) {
    const rows = await ch.txSearch(`ethereum_tx.recipient='${t}'`, t === cfg.router ? 60 : 30).catch(() => []);
    for (const r of rows) {
      for (const e of r.events) {
        if (e.type !== 'ethereum_tx') continue;
        const a = Object.fromEntries(e.attributes.map((x) => [x.key, x.value]));
        if (!a.ethereumTxHash || !a.recipient) continue;
        if (Number(r.height) < cfg.fromBlock) continue;
        seen.set(a.ethereumTxHash.toLowerCase(), { height: Number(r.height), failed: !!a.ethereumTxFailed, error: a.ethereumTxFailed ?? null });
      }
    }
  }
  const out: Attempt[] = [];
  for (const [hash, s] of [...seen.entries()].sort((a, b) => b[1].height - a[1].height).slice(0, 80)) {
    const tx = await ch.getTx(hash as Hex).catch(() => null);
    if (!tx?.to) continue;
    const c = classify(tx.to, tx.input, cfg);
    if (!c) continue;
    const m = markerOf(tx.input);
    const source: Attempt['source'] = plannedTx.has(hash) || team.has(tx.from.toLowerCase()) ? 'team-setup' : m === 'bot' ? 'team-bot' : m === 'try' ? 'try-it' : 'anyone';
    out.push({ tx: hash, height: s.height, from: tx.from, bait: c.bait, call: c.call, failed: s.failed, error: s.error, source, explorer: EXPLORER_TX + hash.replace(/^0x/, '') });
  }
  return out;
}

let cache: { at: number; body: Record<string, unknown> } | null = null;
export async function getQday(ch: Chain, env: Record<string, string | undefined>, cfg = loadQdayConfig(), now = Date.now()): Promise<Record<string, unknown>> {
  if (cache && now - cache.at < 20_000) return cache.body;
  const keys = publishedKeys(env, cfg.baits);
  const [baits, attempts, runs] = await Promise.all([
    Promise.all(cfg.baits.map((b) => baitState(b, ch, cfg, keys))),
    onChainAttempts(ch, cfg).catch((e) => { log('warn', 'qday.scan_failed', { message: String(e?.message ?? e) }); return null; }),
    ch.botRuns().catch(() => null),
  ]);
  const alarm = baits.flatMap((b) => b.alarm.map((a) => `${b.id}: ${a}`));
  const breach = (attempts ?? []).filter((a) => a.source !== 'team-setup' && !a.failed);
  for (const a of breach) alarm.push(`${a.bait}: a non-team transaction touching the bait SUCCEEDED (${a.tx}); check it`);
  const body = {
    ok: true, label: 'LIVE', network: 'Diana testnet (EVM 9800). QOR here has no value.', keysPublished: !!keys,
    baits, alarm: { raised: alarm.length > 0, reasons: alarm },
    log: {
      onChain: { label: 'On-chain attempts by anyone (CometBFT tx_search on the router, PocketDrop and every bait Pocket, decoded here)', rows: (attempts ?? []).filter((a) => a.source !== 'team-bot'), scanOk: attempts !== null },
      relayerRefused: { label: `Attempts our relayer refused before sending, kept in this server instance's memory since ${instanceStartedAt}`, rows: listRefusals() },
      teamBot: { label: 'Team-run attacker bot (OURS): hourly GitHub Actions run of every path; on-chain rows carry the input marker QDAYBOT1', runs: runs ?? [], rows: (attempts ?? []).filter((a) => a.source === 'team-bot') },
    },
    before: cfg.before, after: cfg.after, generatedAt: new Date(now).toISOString(),
  };
  cache = { at: now, body };
  return body;
}
export const resetQdayCache = () => { cache = null; };

/* ---------------- POST: put one attempt on chain (always a revert, never a success) ---------------- */
export const QDAY_RULES = { ip: { limit: 3, windowSec: 3600 }, global: { limit: 24, windowSec: 86400 } } satisfies Record<string, Rule>;
export interface AttemptDeps { cfg: Config; limiter: Limiter; relayer: Relayer; qcfg?: QdayConfig; env: Record<string, string | undefined>; botToken?: string | null }

export async function handleAttempt(raw: unknown, ip: string, d: AttemptDeps): Promise<HttpResult> {
  const qcfg = d.qcfg ?? loadQdayConfig();
  let body = raw as any;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { return reply(400, { ok: false, error: { name: 'InvalidJson', message: 'Body is not valid JSON.' } }); } }
  const data = body?.data as Hex; const to = String(body?.to ?? '');
  if (typeof data !== 'string' || !/^0x[0-9a-fA-F]+$/.test(data) || data.length > 40_000) return reply(400, { ok: false, error: { name: 'ValidationError', message: 'data must be router calldata (hex).' } });
  if (to.toLowerCase() !== qcfg.router.toLowerCase()) return reply(400, { ok: false, error: { name: 'ValidationError', message: 'Attempts go through the PocketRouter.' } });
  const c = classify(qcfg.router, data, qcfg);
  if (!c) return reply(400, { ok: false, error: { name: 'NotABait', message: 'This call does not touch a Q-Day bait Pocket.' } });
  const isBot = !!d.botToken && body?.botToken === d.botToken;
  if (!isBot) {
    const a = await d.limiter.hit('qday:ip', ip, QDAY_RULES.ip);
    if (!a.ok) return reply(429, { ok: false, error: { name: 'RateLimited', message: `Three on-chain attempts per hour per visitor. Retry in ${a.retryAfterSec}s. The read-only check (eth_call) is free and unlimited.` } });
  }
  const g = await d.limiter.hit('qday:global', 'all', QDAY_RULES.global);
  if (!g.ok) { noteRefusal({ bait: c.bait, call: c.call, error: 'daily on-chain attempt budget used', via: 'qday' }); return reply(429, { ok: false, error: { name: 'DailyBudget', message: 'Today\'s relayer budget for on-chain attempts is used. Try the read-only check, or send it from your own account.' } }); }
  const sim = await d.relayer.simulate(data);
  if (sim.ok) {
    // A call that would SUCCEED against a bait is a real break. We never execute it for the caller; we log it loudly.
    log('error', 'qday.would_succeed', { bait: c.bait, call: c.call });
    noteRefusal({ bait: c.bait, call: c.call, error: 'WOULD SUCCEED (not sent by us; please report it)', via: 'qday' });
    return reply(409, { ok: false, sent: false, wouldSucceed: true, error: { name: 'WouldSucceed', message: 'This call would succeed. Our relayer does not execute it for you; send it from your own account and tell us.' } });
  }
  const marked = (data + (isBot ? MARKERS.bot : MARKERS.try).slice(2)) as Hex;
  const gas = c.call.startsWith('propose') || c.call === 'guardianFreeze' ? 1_100_000n : c.call === 'deploy' ? 900_000n : 450_000n;
  const sent = await d.relayer.send(marked, gas);
  if (!sent.ok) return reply(502, { ok: false, error: { name: 'SendFailed', message: sent.message } });
  log('info', 'qday.attempt_mined', { bait: c.bait, call: c.call, tx: sent.hash, status: sent.status, bot: isBot });
  resetQdayCache();
  return reply(200, { ok: true, bait: c.bait, call: c.call, txHash: sent.hash, status: sent.status, expectedRevert: sim.revert.name, gasUsed: sent.gasUsed.toString(), explorer: EXPLORER_TX + sent.hash.replace(/^0x/, ''), source: isBot ? 'team-bot' : 'try-it' });
}

/* ---------------- live Chain implementation ---------------- */
const NONCE = parseAbi(['function nonce() view returns (uint256)']);
let runsCache: { at: number; v: Awaited<ReturnType<Chain['botRuns']>> } | null = null;
export function makeChain(pub: any, cfg: Config, opts: { comet?: string; repo?: string; fetchFn?: typeof fetch } = {}): Chain {
  const f = opts.fetchFn ?? fetch;
  const comet = opts.comet ?? 'https://rpc-testnet.qore.host';
  const repo = opts.repo ?? 'mohamedwael201193/pocket-drop';
  return {
    getBalance: (a) => pub.getBalance({ address: a }),
    call: async (to, data) => ((await pub.call({ to, data })).data ?? '0x') as Hex,
    getLogs: (address, fromBlock) => pub.getLogs({ address, fromBlock, toBlock: 'latest' }),
    getTx: async (hash) => { const t = await pub.getTransaction({ hash }); return t ? { input: t.input, from: t.from, to: t.to } : null; },
    getCode: async (a) => ((await pub.getCode({ address: a })) ?? '0x') as Hex,
    readNonce: (p) => pub.readContract({ address: p, abi: NONCE, functionName: 'nonce' }),
    windowLive: async (cosmos) => { const r = await f(`${cfg.rest}/qorechain/pqc/v1/evm_window/${cosmos}`); if (!r.ok) return null; const j = await r.json() as any; return !!j.live; },
    txSearch: async (query, perPage) => {
      const r = await f(comet, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tx_search', params: { query, prove: false, page: '1', per_page: String(perPage), order_by: 'desc' } }) });
      const j = await r.json() as any; if (j.error) throw new Error(j.error.message ?? 'tx_search failed');
      return (j.result?.txs ?? []).map((t: any) => ({ height: t.height, events: t.tx_result?.events ?? [] }));
    },
    botRuns: async () => {
      if (runsCache && Date.now() - runsCache.at < 300_000) return runsCache.v;
      const r = await f(`https://api.github.com/repos/${repo}/actions/workflows/qday-bot.yml/runs?per_page=8`, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'pocketdrop-api' } });
      if (!r.ok) return runsCache?.v ?? [];
      const j = await r.json() as any;
      const v = (j.workflow_runs ?? []).map((w: any) => ({ id: w.id, status: w.status, conclusion: w.conclusion, createdAt: w.created_at, url: w.html_url }));
      runsCache = { at: Date.now(), v }; return v;
    },
  };
}

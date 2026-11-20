// Sponsored onboarding: a brand-new browser key account gets exactly the ML-DSA registration fee from a dedicated
// sponsor wallet, so a pool claimer needs zero QOR and a new sender funds only their Pocket. Contracts are unchanged.
//
// A request must prove a reason to be sponsored:
//   pool   - the pool's own link-key signature over (pool, recipient, payTo): the same signature the slot claim uses,
//            so only someone holding the pool link can ask, and only for an open pool with a free slot not yet taken by
//            this account;
//   sender - the requester's Pocket config: the backend predicts the Pocket address on chain and requires it to hold at
//            least `senderMinPocketWei` and to be not yet deployed (a fresh sender).
// The target account must be unregistered, hold (almost) nothing, and never have been sponsored (checked on chain).
// Caps: per IP (minute + day), per pool link (min(slots, poolCap) per UTC day), global per UTC day (counted from the
// sponsor's own on-chain sends, so it holds across serverless instances), a balance floor, and the SPONSOR_ENABLED
// kill switch. Everything is testnet QOR.
import { keccak256, encodeAbiParameters, isAddress, isHex, type Hex } from 'viem';
import { z } from 'zod';
import { EVM_CHAIN_ID, EXPLORER_TX } from './config.js';
import { reply, type HttpResult } from './handlers.js';
import { log } from './log.js';
import type { Limiter, Rule } from './ratelimit.js';
import { V4_INSTANCES, V4_ENVS, type V4Env } from './v4.js';

export interface SponsorRules {
  enabled: boolean;
  configured: boolean;
  /** Exactly what one registerWithPoP costs (fee 60000 uqor at gas 400000; measured: 0.06 QOR registers and leaves 0). */
  amountUqor: bigint;
  /** Fee and gas of the sponsor's own hybrid-signed MsgSend (201,025 gas used; 0.1 uqor/gas accepted on Diana). */
  sendFeeUqor: bigint;
  sendGas: bigint;
  dailyCap: number;
  ipPerDay: number;
  ipPerMinute: number;
  poolCap: number;
  senderMinPocketWei: bigint;
  /** A target holding at least this is not brand new and is refused. */
  dustWei: bigint;
}

type Env = Record<string, string | undefined>;
const int = (v: string | undefined, d: number) => (v && /^\d+$/.test(v.trim()) ? Number(v.trim()) : d);
const big = (v: string | undefined, d: bigint) => (v && /^\d+$/.test(v.trim()) ? BigInt(v.trim()) : d);

export function sponsorRules(env: Env = process.env): SponsorRules {
  return {
    enabled: env.SPONSOR_ENABLED?.trim() === '1',
    configured: !!(env.SPONSOR_SECP_KEY?.trim() && env.SPONSOR_PQC_SECRET?.trim()),
    amountUqor: big(env.SPONSOR_AMOUNT_UQOR, 60_000n),
    sendFeeUqor: big(env.SPONSOR_SEND_FEE_UQOR, 26_000n),
    sendGas: big(env.SPONSOR_SEND_GAS, 260_000n),
    dailyCap: int(env.SPONSOR_DAILY_CAP, 20),
    ipPerDay: int(env.SPONSOR_IP_PER_DAY, 3),
    ipPerMinute: int(env.SPONSOR_IP_PER_MINUTE, 2),
    poolCap: int(env.SPONSOR_POOL_CAP, 10),
    senderMinPocketWei: big(env.SPONSOR_SENDER_MIN_POCKET_WEI, 100_000_000_000_000_000n),
    dustWei: big(env.SPONSOR_DUST_WEI, 1_000_000_000_000_000n),
  };
}

export const UQOR_TO_WEI = 1_000_000_000_000n;

export interface PoolView { host: Hex; perSlot: bigint; slots: number; taken: number; expiry: bigint; closed: boolean; linkKeyHash: Hex }
export interface PocketCfgIn { owner: Hex; guardians: Hex[]; threshold: number; dailyLimit: bigint; userSalt: Hex }
export interface SponsorSend { to: string; memo: string; time: number }

export interface SponsorChain {
  sponsorAddress: string;
  balance(addr: Hex): Promise<bigint>;
  hasCode(addr: Hex): Promise<boolean>;
  keyRegistered(addr: Hex): Promise<boolean>;
  getPool(env: V4Env, id: bigint): Promise<PoolView | null>;
  poolClaimed(env: V4Env, id: bigint, who: Hex): Promise<boolean>;
  /** pqcVerify precompile through eth_call. */
  pqVerify(pk: Hex, sig: Hex, message: Uint8Array): Promise<boolean>;
  predictPocket(env: V4Env, c: PocketCfgIn): Promise<Hex>;
  /** The sponsor's most recent sends, newest first (at least `dailyCap` of them when available). */
  recentSends(): Promise<SponsorSend[]>;
  /** Whether the sponsor ever sent to this account. */
  everSponsored(addr: Hex): Promise<boolean>;
  sponsorBalanceWei(): Promise<bigint>;
  now(): number;
  send(to: Hex, amountUqor: bigint, memo: string): Promise<{ hash: string }>;
}

export interface SponsorDeps { rules: SponsorRules; limiter: Limiter; chain: SponsorChain | null }

const hex = z.string().refine((s) => isHex(s), 'hex expected') as unknown as z.ZodType<Hex>;
const addr = z.string().refine((s) => isAddress(s, { strict: false }), 'address expected') as unknown as z.ZodType<Hex>;
const envS = z.enum(V4_ENVS as [V4Env, ...V4Env[]]).default('prod');
export const sponsorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('pool'), env: envS, poolId: z.coerce.bigint().positive(), recipient: addr, payTo: addr, linkPk: hex, linkSig: hex }),
  z.object({
    kind: z.literal('sender'), env: envS, owner: addr,
    guardians: z.array(addr).max(10).default([]), threshold: z.number().int().min(0).max(10).default(0),
    dailyLimit: z.coerce.bigint().nonnegative(), userSalt: hex,
  }),
]);
export type SponsorRequest = z.infer<typeof sponsorSchema>;

/** The digest the pool's link key signs for a claim, as DropPool.linkDigest. */
export function poolLinkDigest(pool: Hex, id: bigint, recipient: Hex, payTo: Hex): Hex {
  return keccak256(encodeAbiParameters(
    [{ type: 'string' }, { type: 'uint256' }, { type: 'address' }, { type: 'uint256' }, { type: 'address' }, { type: 'address' }],
    ['POCKET_POOL_LINK_V1', BigInt(EVM_CHAIN_ID), pool, id, recipient, payTo],
  ));
}
/** PqcLib.pqMessage: the 66 ASCII bytes "0x" + lowercase hex of the digest. */
export const pqMessage = (digest: Hex) => new TextEncoder().encode(digest.toLowerCase());

export const utcDayStart = (t: number) => { const d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); };

const refuse = (status: number, name: string, message: string, extra: Record<string, unknown> = {}, headers?: Record<string, string>) =>
  reply(status, { ok: false, sponsored: false, fallback: 'faucet', error: { name, message }, ...extra }, headers);

const inFlight = new Set<string>();
let sendQueue: Promise<unknown> = Promise.resolve();

/** GET /api/sponsor: is sponsoring on, how much, and what is left today. */
export async function handleSponsorStatus(d: SponsorDeps): Promise<HttpResult> {
  const r = d.rules;
  const base = { amountWei: (r.amountUqor * UQOR_TO_WEI).toString(), senderMinPocketWei: r.senderMinPocketWei.toString(), dailyCap: r.dailyCap };
  if (!r.enabled || !r.configured || !d.chain) return reply(200, { ok: true, enabled: false, reason: !r.enabled ? 'switched off' : 'not configured', ...base });
  const c = d.chain;
  try {
    const sends = await c.recentSends();
    const today = sends.filter((s) => s.time >= utcDayStart(c.now())).length;
    const funded = (await c.sponsorBalanceWei()) >= (r.amountUqor + r.sendFeeUqor) * UQOR_TO_WEI;
    const reason = !funded ? 'sponsor wallet low' : today >= r.dailyCap ? 'daily cap reached' : undefined;
    return reply(200, { ok: true, enabled: !reason, reason, remainingToday: Math.max(0, r.dailyCap - today), sponsor: c.sponsorAddress, ...base });
  } catch {
    return reply(200, { ok: true, enabled: false, reason: 'chain unavailable', ...base });
  }
}

/** POST /api/sponsor */
export async function handleSponsor(rawBody: unknown, ip: string, d: SponsorDeps): Promise<HttpResult> {
  const r = d.rules;
  if (!r.enabled) return refuse(503, 'SponsorOff', 'Sponsored setup is switched off right now. Use the faucet instead.');
  if (!r.configured || !d.chain) return refuse(503, 'SponsorOff', 'Sponsored setup is not configured on this deployment.');
  const c = d.chain;

  const ipRules: [string, Rule][] = [['min', { limit: r.ipPerMinute, windowSec: 60 }], ['day', { limit: r.ipPerDay, windowSec: 86_400 }]];
  for (const [k, rule] of ipRules) {
    const h = await d.limiter.hit(`sponsor:ip:${k}`, ip, rule);
    if (!h.ok) return refuse(429, 'RateLimited', `Too many sponsor requests from this network. Retry in ${h.retryAfterSec}s, or use the faucet.`, {}, { 'retry-after': String(h.retryAfterSec) });
  }

  let body = rawBody;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { return refuse(400, 'InvalidJson', 'Body is not valid JSON.'); } }
  const parsed = sponsorSchema.safeParse(body);
  if (!parsed.success) return refuse(400, 'ValidationError', 'Invalid request.', { issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) });
  const v = parsed.data;
  const target = (v.kind === 'pool' ? v.recipient : v.owner).toLowerCase() as Hex;

  if (inFlight.has(target)) return refuse(409, 'InProgress', 'A sponsor request for this account is already being processed.');
  inFlight.add(target);
  try {
    // 1. the target is a brand-new account
    if (await c.keyRegistered(target)) return refuse(409, 'AlreadyRegistered', 'This key is already registered; it does not need a sponsor.');
    if ((await c.balance(target)) >= r.dustWei) return refuse(409, 'NotNew', 'This key account already holds QOR; register it with that.');
    if (await c.everSponsored(target)) return refuse(409, 'AlreadySponsored', 'This key account was already sponsored once.');

    // 2. the proof
    let memo: string;
    if (v.kind === 'pool') {
      const pool = await c.getPool(v.env, v.poolId);
      if (!pool) return refuse(404, 'PoolNotFound', 'No such pool.');
      const nowSec = BigInt(Math.floor(c.now() / 1000));
      if (pool.closed || pool.expiry <= nowSec || pool.taken >= pool.slots) return refuse(409, 'PoolNotOpen', 'This pool has no free slot.');
      if (await c.poolClaimed(v.env, v.poolId, target)) return refuse(409, 'AlreadyClaimed', 'This account already took a slot in this pool.');
      if (keccak256(v.linkPk).toLowerCase() !== pool.linkKeyHash.toLowerCase()) return refuse(403, 'BadProof', 'The link key does not belong to this pool.');
      const digest = poolLinkDigest(V4_INSTANCES[v.env].pool as Hex, v.poolId, target, v.payTo);
      if (!(await c.pqVerify(v.linkPk, v.linkSig, pqMessage(digest)))) return refuse(403, 'BadProof', 'The pool link signature is not valid for this account.');
      memo = `pd-sponsor pool:${v.env}:${v.poolId}`;
      const forLink = (await c.recentSends()).filter((s) => s.memo === memo && s.time >= utcDayStart(c.now())).length;
      if (forLink >= Math.min(pool.slots, r.poolCap)) return refuse(429, 'LinkCapReached', 'This pool link used up its sponsored setups for today. Use the faucet.');
    } else {
      const pocket = await c.predictPocket(v.env, { owner: target, guardians: v.guardians, threshold: v.threshold, dailyLimit: v.dailyLimit, userSalt: v.userSalt });
      if (await c.hasCode(pocket)) return refuse(409, 'NotNew', 'This Pocket is already in use; sponsoring is for brand-new senders.');
      const pb = await c.balance(pocket);
      if (pb < r.senderMinPocketWei) return refuse(409, 'PocketNotFunded', 'Fund your Pocket first; the key setup is covered once it holds enough.', { pocket, pocketWei: pb.toString(), needWei: r.senderMinPocketWei.toString() });
      memo = `pd-sponsor sender:${v.env}`;
    }

    // 3. global cap and the sponsor's own balance
    const today = (await c.recentSends()).filter((s) => s.time >= utcDayStart(c.now())).length;
    if (today >= r.dailyCap) return refuse(429, 'DailyCapReached', 'Today\'s sponsored setups are used up. Use the faucet.');
    if ((await c.sponsorBalanceWei()) < (r.amountUqor + r.sendFeeUqor) * UQOR_TO_WEI) return refuse(503, 'SponsorLow', 'The sponsor wallet is empty. Use the faucet.');

    // 4. send, one at a time per instance (the sponsor has one Cosmos sequence)
    const run = sendQueue.then(() => c.send(target, r.amountUqor, memo));
    sendQueue = run.catch(() => undefined);
    const sent = await run;
    log('info', 'sponsor.sent', { kind: v.kind, memo, to: target, hash: sent.hash, amountUqor: r.amountUqor.toString() });
    return reply(200, { ok: true, sponsored: true, kind: v.kind, to: target, amountWei: (r.amountUqor * UQOR_TO_WEI).toString(), txHash: sent.hash, explorer: EXPLORER_TX + sent.hash });
  } catch (e) {
    log('error', 'sponsor.failed', { message: String((e as Error)?.message ?? e).slice(0, 300) });
    return refuse(502, 'SponsorFailed', 'The sponsor could not send right now. Use the faucet, or try again in a minute.');
  } finally {
    inFlight.delete(target);
  }
}

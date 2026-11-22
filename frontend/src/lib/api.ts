import { z } from 'zod';
import type { Hex } from 'viem';
import { API_BASE } from './config';

const hex = z.string().regex(/^0x[0-9a-fA-F]*$/);
const addr = z.string().regex(/^0x[0-9a-fA-F]{40}$/);

export const LinkState = z.enum(['Open', 'Bound', 'Confirmed', 'Claimed', 'Cancelled', 'Refunded']);
export type LinkStateName = z.infer<typeof LinkState>;

export const linkSchema = z.object({
  id: z.string(),
  sender: addr,
  mode: z.enum(['Confirmed', 'Open']),
  state: LinkState,
  amount: z.string(),
  drip: z.string(),
  relayerFee: z.string(),
  expiry: z.string(),
  bindDeadline: z.string(),
  linkKeyHash: hex,
  recipient: addr.nullable().optional(),
  recipientKeyHash: hex.nullable().optional(),
  dripPaid: z.boolean(),
});
export type ApiLink = z.infer<typeof linkSchema>;

const apiError = z.object({ name: z.string(), message: z.string(), selector: z.string().optional(), known: z.boolean().optional() });
export class ApiError extends Error {
  constructor(public name: string, message: string, public status: number) { super(message); }
}

async function getJson<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  const r = await fetch(`${API_BASE}${path}`);
  const j = await r.json().catch(() => null);
  if (!r.ok || !j?.ok) {
    const e = apiError.safeParse(j?.error);
    throw new ApiError(e.success ? e.data.name : 'HttpError', e.success ? e.data.message : `HTTP ${r.status}`, r.status);
  }
  return schema.parse(j);
}

export const healthSchema = z.object({
  ok: z.boolean(),
  network: z.string(),
  headBlock: z.string().nullable(),
  relayer: z.object({ address: z.string(), cosmosAddress: z.string(), balance: z.string().nullable() }).nullable(),
  window: z.object({
    queryable: z.boolean(), live: z.boolean().optional(), remainingTxs: z.string().optional(), remainingBlocks: z.string().optional(),
    expiryHeight: z.string().optional(), allowedTargets: z.array(z.string()).optional(),
  }).passthrough(),
  warning: z.object({ level: z.string(), message: z.string() }).optional(),
  /** how relays reach the chain (absent on older API deployments) */
  relay: z.object({ mode: z.enum(['hybrid', 'evm']), signature: z.string(), fallback: z.string(), classicalPathOpen: z.boolean() }).optional(),
  warnings: z.array(z.object({ kind: z.string(), level: z.string(), message: z.string() })).optional(),
});
export type Health = z.infer<typeof healthSchema>;

const counts = z.object({ created: z.number(), bound: z.number(), confirmed: z.number(), claimed: z.number(), cancelled: z.number(), refunded: z.number(), other: z.number() });
export const statsSchema = z.object({
  network: z.string(),
  contract: z.string(),
  fromBlock: z.string().optional(),
  toBlock: z.string().optional(),
  truncated: z.boolean().optional(),
  counts,
  volume: z.object({ created: z.string(), claimed: z.string(), unit: z.string() }),
  addresses: z.object({
    own: z.number(), external: z.number(),
    byRole: z.record(z.object({ own: z.number(), external: z.number() })).optional(),
  }),
  recent: z.array(z.object({ name: z.string(), kind: z.string(), linkId: z.string().nullable(), txHash: z.string(), blockNumber: z.string().optional(), amount: z.string().optional() })),
  /** v4 instances, counted by the API the same way /radar counts them (absent on older deployments) */
  v4: z.record(z.unknown()).optional(),
});
export type Stats = z.infer<typeof statsSchema>;

/** /api/health answers 503 with a full body when the relayer window is closed; that body is exactly what we want to show. */
export async function fetchHealth() {
  const r = await fetch(`${API_BASE}/api/health`);
  const j = await r.json().catch(() => null);
  const p = healthSchema.safeParse(j);
  if (!p.success) throw new ApiError('HttpError', `HTTP ${r.status}`, r.status);
  return p.data;
}
export const fetchStats = () => getJson('/api/stats', statsSchema);
export const fetchLink = (id: string | bigint) => getJson(`/api/link/${id}`, z.object({ ok: z.literal(true), link: linkSchema })).then((r) => r.link);

const txOk = z.object({ ok: z.literal(true), txHash: z.string(), blockNumber: z.union([z.string(), z.number()]).optional(), gasUsed: z.union([z.string(), z.number()]).optional(), explorer: z.string().optional() }).passthrough();

async function post<T>(path: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
  const r = await fetch(`${API_BASE}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j?.ok) {
    const e = apiError.safeParse(j?.error);
    throw new ApiError(e.success ? e.data.name : 'HttpError', e.success ? e.data.message : `HTTP ${r.status}`, r.status);
  }
  return schema.parse(j);
}
/** `lane`: 'hybrid' = MsgCrossVMCall signed by the relayer with secp256k1 + ML-DSA-87 (txHash is a native-lane hash, no 0x);
 *  'evm' = an EVM tx inside the relayer's window (txHash 0x…). `result` carries ids from the router's return value (hybrid only). */
export interface RouteResult {
  txHash: Hex; status: string; explorer?: string; gasUsed?: string; env: string; action: string;
  lane?: 'hybrid' | 'evm'; hybridVerified?: boolean; result?: { linkId?: string; poolId?: string; queuedId?: string; pocket?: string };
}
const routeOk = z.object({
  ok: z.literal(true), txHash: z.string(), status: z.string(), explorer: z.string().optional(), gasUsed: z.string().optional(), env: z.string(), action: z.string(),
  lane: z.enum(['hybrid', 'evm']).optional(), hybridVerified: z.boolean().optional(),
  result: z.object({ linkId: z.string().optional(), poolId: z.string().optional(), queuedId: z.string().optional(), pocket: z.string().optional() }).passthrough().optional(),
}).passthrough();
/** v4: relay a user-signed intent through PocketRouter. 422 means the simulation reverted (nothing was sent). */
export const postRoute = (p: { env: 'prod' | 'lab'; target?: string; data: string; pocket?: { owner: string; guardians: string[]; threshold: number; dailyLimit: string; userSalt: string } }): Promise<RouteResult> =>
  post('/api/route', p, routeOk).then((r) => ({ ...r, txHash: r.txHash as Hex }));
export const postBind = (p: { linkId: string; recipient: string; recipientKeyHash: string; linkPk: string; linkSig: string }) => post('/api/bind', p, txOk);
export const postClaim = (p: { linkId: string; recipientSig: string }) => post('/api/claim', p, txOk);

export const RELAYER_PAUSED = "The relayer's EVM window has expired, so it cannot submit transactions for you right now. Your funds are safe and still in escrow: nothing was sent and nothing was lost. Retry in a few minutes, after the relayer window is renewed.";

/** Plain-language text for the contract/relayer errors a person can actually hit. */
export function explainError(e: unknown): string {
  if (e instanceof ApiError) {
    const map: Record<string, string> = {
      RateLimited: 'Too many tries in a short time. Wait a minute and try again.',
      RelayerWindowUnavailable: RELAYER_PAUSED,
      InvalidState: 'This link is not in a state that allows that step (already used, cancelled or expired).',
      Expired: 'This link has expired.',
      BadLinkSignature: 'The link key does not match this link. Ask the sender for a fresh link.',
      BadRecipientSignature: 'This browser does not hold the key bound to this link.',
      PossessionNotProven: 'The account key registration is not finished yet.',
      NotRegistered: 'The account key is not registered yet.',
      LinkNotFound: 'No such link.',
      BadSignature: 'The signature was refused: this key does not own that Pocket, or the signed action is out of date. Reload and try again.',
      OverDailyLimit: 'That is above the Pocket daily limit. Use a smaller amount, or raise the limit (it takes effect after the timelock).',
      Frozen: 'This Pocket is frozen by its guardians. Spending, drops and limit raises are paused until the freeze ends.',
      TooEarly: 'The timelock has not ended yet.',
      NotEnoughSigners: 'Not enough guardian signatures yet.',
      NotGuardian: 'One of the signers is not a guardian of this Pocket.',
      DuplicateSigner: 'The same guardian signed twice.',
      AlreadyFrozen: 'This Pocket is already frozen.',
      FreezeCapped: 'The same guardians already froze this Pocket twice in a row.',
      NoRecoveryPending: 'There is no recovery pending.',
      RecoveryPending: 'A recovery is pending, so this is paused.',
      NotQueued: 'That queued spend is not pending any more.',
      BadNonce: 'The signed freeze is stale. Sign it again.',
      AlreadyClaimed: 'This account already took a slot in this pool.',
      PoolFull: 'Every slot of this pool is taken.',
      PoolExpired: 'This pool has expired.',
      RecipientChanged: 'The recipient changed after you looked. Refresh and compare the 4 words again.',
      NotAllowed: 'That address cannot be reached through the router.',
    };
    if (e.status === 503 && !map[e.name]) return RELAYER_PAUSED;
    return map[e.name] ?? `${e.name}: ${e.message}`;
  }
  return e instanceof Error ? e.message : String(e);
}

/** One event rebuilt from a hybrid relay (a MsgCrossVMCall leaves no EVM log). Numbers arrive as decimal strings. */
export interface XvmEvent { eventName: string; args: Record<string, unknown>; blockNumber: string; transactionHash: string; lane: 'hybrid' }
const xvmSchema = z.object({
  ok: z.literal(true), env: z.string(), count: z.number(),
  events: z.array(z.object({ eventName: z.string(), args: z.record(z.unknown()), blockNumber: z.string(), transactionHash: z.string(), lane: z.literal('hybrid') })),
}).passthrough();
/** GET /api/xvm: hybrid relays into the PocketRouter of `env`, decoded into the events they stand for. */
export const fetchXvm = (env: 'prod' | 'lab') => getJson(`/api/xvm?env=${env}`, xvmSchema).then((r) => r.events as XvmEvent[]);

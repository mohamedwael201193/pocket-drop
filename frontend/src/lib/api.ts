import { z } from 'zod';
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
  window: z.object({ queryable: z.boolean(), live: z.boolean().optional(), remainingTxs: z.string().optional(), remainingBlocks: z.string().optional() }).passthrough(),
}).passthrough();
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
  recent: z.array(z.object({ name: z.string(), kind: z.string(), linkId: z.string().nullable(), txHash: z.string(), blockNumber: z.string().optional() })),
});
export type Stats = z.infer<typeof statsSchema>;

export const fetchHealth = () => getJson('/api/health', healthSchema);
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
export const postBind = (p: { linkId: string; recipient: string; recipientKeyHash: string; linkPk: string; linkSig: string }) => post('/api/bind', p, txOk);
export const postClaim = (p: { linkId: string; recipientSig: string }) => post('/api/claim', p, txOk);

/** Plain-language text for the contract/relayer errors a person can actually hit. */
export function explainError(e: unknown): string {
  if (e instanceof ApiError) {
    const map: Record<string, string> = {
      RateLimited: 'Too many tries in a short time. Wait a minute and try again.',
      RelayerWindowUnavailable: 'The relayer is paused for maintenance. Nothing was sent; try again in a few minutes.',
      InvalidState: 'This link is not in a state that allows that step (already used, cancelled or expired).',
      Expired: 'This link has expired.',
      BadLinkSignature: 'The link key does not match this link. Ask the sender for a fresh link.',
      BadRecipientSignature: 'This browser does not hold the key bound to this link.',
      PossessionNotProven: 'The account key registration is not finished yet.',
      NotRegistered: 'The account key is not registered yet.',
      LinkNotFound: 'No such link.',
    };
    return map[e.name] ?? `${e.name}: ${e.message}`;
  }
  return e instanceof Error ? e.message : String(e);
}

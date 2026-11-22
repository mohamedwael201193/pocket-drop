import { encodeFunctionData, type Address, type Hex, type PublicClient } from 'viem';
import { pocketDropAbi } from './abi.js';
import { EXPLORER_TX, NETWORK, type Config } from './config.js';
import { decodeRevert, extractRevertData } from './errors.js';
import { log } from './log.js';
import { RULES, type Limiter, type Rule } from './ratelimit.js';
import type { Relayer } from './relayer.js';
import { relayMemo } from './hybridRelayer.js';
import { sendFields } from './route.js';
import { bindSchema, claimSchema, formatIssues, linkIdSchema } from './validation.js';

export interface HttpResult { status: number; body: Record<string, unknown>; headers?: Record<string, string> }

export const reply = (status: number, body: Record<string, unknown>, headers?: Record<string, string>): HttpResult => ({
  status, body: { network: NETWORK, ...body }, headers,
});

export interface Deps {
  cfg: Config;
  limiter: Limiter;
  getRelayer: () => Relayer;
  pub: Pick<PublicClient, 'readContract'>;
}

async function limit(l: Limiter, bucket: string, key: string, rule: Rule): Promise<HttpResult | null> {
  const r = await l.hit(bucket, key, rule);
  if (r.ok) return null;
  return reply(429, { ok: false, error: { name: 'RateLimited', message: `Too many requests for ${bucket}. Retry in ${r.retryAfterSec}s.` } }, { 'retry-after': String(r.retryAfterSec) });
}

const notConfigured = (what: string) => reply(503, { ok: false, error: { name: 'NotConfigured', message: `${what} is not configured on this deployment yet.` } });

type Action = 'bind' | 'claim';

/** Shared pipeline: rate limit -> validate -> encode -> pre-simulate -> send -> receipt. */
async function submit(action: Action, rawBody: unknown, ip: string, d: Deps): Promise<HttpResult> {
  const ipHit = await limit(d.limiter, `${action}:ip`, ip, action === 'bind' ? RULES.bindIp : RULES.claimIp);
  if (ipHit) return ipHit;

  let body = rawBody;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { return reply(400, { ok: false, error: { name: 'InvalidJson', message: 'Body is not valid JSON.' } }); } }
  const parsed = (action === 'bind' ? bindSchema : claimSchema).safeParse(body);
  if (!parsed.success) return reply(400, { ok: false, error: { name: 'ValidationError', message: 'Invalid request.', issues: formatIssues(parsed.error) } });
  const v = parsed.data as any;

  const linkHit = await limit(d.limiter, `${action}:link`, v.linkId.toString(), action === 'bind' ? RULES.bindLink : RULES.claimLink);
  if (linkHit) return linkHit;

  if (!d.cfg.contract) return notConfigured('POCKETDROP_ADDRESS');
  if (!d.cfg.relayerKey) return notConfigured('RELAYER_SECP_KEY');

  const data: Hex = action === 'bind'
    ? encodeFunctionData({ abi: pocketDropAbi, functionName: 'bind', args: [v.linkId, v.recipient, v.recipientKeyHash, v.linkPk, v.linkSig] })
    : encodeFunctionData({ abi: pocketDropAbi, functionName: 'claim', args: [v.linkId, v.recipientSig] });
  const relayer = d.getRelayer();

  const sim = await relayer.simulate(data);
  if (!sim.ok) {
    log('warn', `${action}.simulate_revert`, { linkId: v.linkId.toString(), error: sim.revert.name });
    return reply(422, { ok: false, sent: false, error: { name: sim.revert.name, message: sim.revert.message, selector: sim.revert.selector, known: sim.revert.known }, hint: 'Simulated with eth_call before sending; nothing was submitted.' });
  }

  const gas = action === 'bind' ? d.cfg.gasBind : d.cfg.gasClaim;
  const sent = await relayer.send(data, gas, relayMemo(['v3', action, v.linkId.toString()]));
  if (!sent.ok) {
    log('error', `${action}.send_failed`, { linkId: v.linkId.toString(), reason: sent.reason, message: sent.message });
    if (sent.reason === 'window') {
      return reply(503, { ok: false, error: { name: 'RelayerWindowUnavailable', message: 'The relayer EVM authorisation window is closed or exhausted. The operator must renew it (scripts/renew-window.mjs). Nothing was submitted.' } }, { 'retry-after': '60' });
    }
    return reply(502, { ok: false, error: { name: 'SendFailed', message: sent.message }, ...(sent.hash ? { txHash: sent.hash, explorer: EXPLORER_TX + sent.hash } : {}) });
  }
  log(sent.status === 'success' ? 'info' : 'error', `${action}.done`, { linkId: v.linkId.toString(), lane: sent.lane, txHash: sent.hash, status: sent.status, gasUsed: sent.gasUsed.toString(), fallback: sent.fallbackReason });
  const out = { action, linkId: v.linkId.toString(), ...sendFields(sent, gas) };
  return sent.status === 'success'
    ? reply(200, { ok: true, ...out })
    : reply(502, { ok: false, ...out, error: { name: 'Reverted', message: 'Transaction was mined but reverted.' } });
}

export const handleBind = (body: unknown, ip: string, d: Deps) => submit('bind', body, ip, d);
export const handleClaim = (body: unknown, ip: string, d: Deps) => submit('claim', body, ip, d);

export const MODES = ['Confirmed', 'Open'] as const;
export const STATES = ['None', 'Open', 'Bound', 'Confirmed', 'Claimed', 'Cancelled', 'Refunded'] as const;

const ZERO = '0x0000000000000000000000000000000000000000';

export async function handleLink(rawId: unknown, ip: string, d: Deps): Promise<HttpResult> {
  const hit = await limit(d.limiter, 'read:ip', ip, RULES.readIp);
  if (hit) return hit;
  const id = linkIdSchema.safeParse(rawId);
  if (!id.success) return reply(400, { ok: false, error: { name: 'ValidationError', message: 'linkId must be a positive decimal integer.' } });
  if (!d.cfg.contract) return notConfigured('POCKETDROP_ADDRESS');
  try {
    const l = (await d.pub.readContract({ address: d.cfg.contract as Address, abi: pocketDropAbi, functionName: 'getLink', args: [id.data] })) as Record<string, any>;
    if (!l || l.sender === ZERO || Number(l.state) === 0) return reply(404, { ok: false, error: { name: 'LinkNotFound', message: 'No such link.' } });
    const str = (x: unknown) => (typeof x === 'bigint' ? x.toString() : x);
    const mode = Number(l.mode), state = Number(l.state);
    return reply(200, {
      ok: true,
      link: {
        id: id.data.toString(), sender: l.sender, mode: MODES[mode] ?? `unknown(${mode})`, state: STATES[state] ?? `unknown(${state})`,
        amount: str(l.amount), drip: str(l.drip), relayerFee: str(l.relayerFee), expiry: str(l.expiry), bindDeadline: str(l.bindDeadline),
        linkKeyHash: l.linkKeyHash, recipient: l.recipient === ZERO ? null : l.recipient,
        recipientKeyHash: /^0x0+$/.test(String(l.recipientKeyHash)) ? null : l.recipientKeyHash, dripPaid: Boolean(l.dripPaid),
      },
    });
  } catch (e) {
    const rv = decodeRevert(extractRevertData(e), 'read failed');
    if (rv.name === 'LinkNotFound') return reply(404, { ok: false, error: { name: 'LinkNotFound', message: rv.message } });
    log('error', 'link.read_failed', { linkId: id.data.toString(), error: rv.name });
    return reply(502, { ok: false, error: { name: rv.name, message: rv.message } });
  }
}

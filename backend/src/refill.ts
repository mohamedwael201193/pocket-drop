// Relayer auto-refill (Diana testnet only). A dedicated refill wallet tops up the relayer with a hybrid-signed
// (secp256k1 + ML-DSA-87) MsgSend when the relayer is below the low-balance line. Hard caps: one send at most
// REFILL_MAX_PER_SEND, at most REFILL_DAILY_CAP in any rolling 24 hours, and the refill wallet keeps a fee reserve.
// The 24-hour sum is read from the chain (the refill wallet's own sends with memo "pd refill"), so the cap holds across
// runs without any stored state. /api/health shows the last refill and the 24-hour total from the same read.
// The refill wallet's keys live only in GitHub Actions secrets (REFILL_SECP_KEY, REFILL_PQC_SECRET) and in the
// operator's local .secrets file. This module never sees them; it plans and reads.

export const UQOR_PER_QOR = 1_000_000n;
export const REFILL_MEMO_PREFIX = 'pd refill';
/** Public address of the refill wallet (a fresh TEAM-RUN account; its keys are not in this repo). */
export const REFILL_FUNDER_DEFAULT = 'qor17ur48yaln4f2pemfzzh9j028uame2kgvhqfg2r';
/** REFILL_FUNDER_ADDRESS overrides it; "none" turns the health block off. */
export const refillFunder = (env: Record<string, string | undefined>): string | null => { const v = env.REFILL_FUNDER_ADDRESS?.trim(); if (v === 'none') return null; return v && /^qor1[0-9a-z]{38}$/.test(v) ? v : REFILL_FUNDER_DEFAULT; };

export interface RefillRules {
  /** below this the relayer is "low" (same line as /api/health lowBalance) */
  thresholdUqor: bigint;
  /** a refill brings the relayer up to this */
  targetUqor: bigint;
  maxPerSendUqor: bigint;
  dailyCapUqor: bigint;
  /** the refill wallet never spends below this (fees for the next sends) */
  funderReserveUqor: bigint;
}

export const DEFAULT_RULES: RefillRules = {
  thresholdUqor: 3n * UQOR_PER_QOR,
  targetUqor: 4n * UQOR_PER_QOR,
  maxPerSendUqor: 1_500_000n,
  dailyCapUqor: 3n * UQOR_PER_QOR,
  funderReserveUqor: 300_000n,
};

export type RefillPlan =
  | { action: 'send'; amountUqor: bigint; reason: string }
  | { action: 'skip'; reason: 'healthy' | 'daily-cap' | 'funder-empty' | 'too-small'; detail: string };

/** Pure decision: how much to send now, or why not. Amounts in uqor. */
export function planRefill(a: { relayerUqor: bigint; funderUqor: bigint; sentLast24hUqor: bigint; force?: bigint | null }, r: RefillRules = DEFAULT_RULES): RefillPlan {
  const capLeft = r.dailyCapUqor > a.sentLast24hUqor ? r.dailyCapUqor - a.sentLast24hUqor : 0n;
  const funderFree = a.funderUqor > r.funderReserveUqor ? a.funderUqor - r.funderReserveUqor : 0n;
  let want: bigint;
  if (a.force && a.force > 0n) want = a.force;
  else {
    if (a.relayerUqor >= r.thresholdUqor) return { action: 'skip', reason: 'healthy', detail: `relayer ${fmt(a.relayerUqor)} QOR >= line ${fmt(r.thresholdUqor)} QOR` };
    want = r.targetUqor - a.relayerUqor;
  }
  if (capLeft === 0n) return { action: 'skip', reason: 'daily-cap', detail: `already sent ${fmt(a.sentLast24hUqor)} QOR in the last 24 h (cap ${fmt(r.dailyCapUqor)})` };
  if (funderFree === 0n) return { action: 'skip', reason: 'funder-empty', detail: `refill wallet holds ${fmt(a.funderUqor)} QOR, reserve ${fmt(r.funderReserveUqor)}` };
  const amount = min(want, r.maxPerSendUqor, capLeft, funderFree);
  if (amount < 10_000n) return { action: 'skip', reason: 'too-small', detail: `computed ${fmt(amount)} QOR` };
  return { action: 'send', amountUqor: amount, reason: a.force ? `forced ${fmt(a.force)} QOR (capped)` : `relayer ${fmt(a.relayerUqor)} QOR < line ${fmt(r.thresholdUqor)} QOR` };
}

const min = (...xs: bigint[]) => xs.reduce((m, x) => (x < m ? x : m));
export const fmt = (u: bigint) => {
  const s = u < 0n ? '-' : ''; const v = u < 0n ? -u : u;
  const frac = (v % UQOR_PER_QOR).toString().padStart(6, '0').replace(/0+$/, '');
  return `${s}${v / UQOR_PER_QOR}${frac ? '.' + frac : ''}`;
};

export interface RefillTx { txhash: string; height: number; time: string; amountUqor: bigint; to: string; code: number }
interface RestTx { txhash: string; height: string; code: number; timestamp: string; tx?: { body?: { memo?: string; messages?: Record<string, any>[] } } }

/** The refill wallet's sends to the relayer with the refill memo, newest first (failed ones included, code != 0). */
export function parseRefills(txs: RestTx[], relayerQor: string): RefillTx[] {
  const out: RefillTx[] = [];
  for (const t of txs) {
    const memo = t.tx?.body?.memo ?? '';
    if (!memo.startsWith(REFILL_MEMO_PREFIX)) continue;
    let amt = 0n;
    for (const m of t.tx?.body?.messages ?? []) {
      if (m['@type'] !== '/cosmos.bank.v1beta1.MsgSend' || m.to_address !== relayerQor) continue;
      for (const c of m.amount ?? []) if (c.denom === 'uqor') amt += BigInt(c.amount);
    }
    if (amt === 0n) continue;
    out.push({ txhash: t.txhash.toUpperCase(), height: Number(t.height), time: t.timestamp, amountUqor: amt, to: relayerQor, code: t.code });
  }
  return out.sort((x, y) => y.height - x.height);
}

export function sumLast24h(rows: RefillTx[], now: number): bigint {
  return rows.filter((r) => r.code === 0 && now - Date.parse(r.time) < 86_400_000).reduce((s, r) => s + r.amountUqor, 0n);
}

export async function fetchRefills(rest: string, funderQor: string, relayerQor: string, f: typeof fetch = fetch): Promise<RefillTx[]> {
  const q = encodeURIComponent(`message.sender='${funderQor}'`);
  const r = await f(`${rest.replace(/\/$/, '')}/cosmos/tx/v1beta1/txs?query=${q}&order_by=ORDER_BY_DESC&limit=50`, { headers: { 'user-agent': 'pocketdrop-api' }, signal: AbortSignal.timeout(12_000) });
  if (!r.ok) throw new Error(`tx search HTTP ${r.status}`);
  return parseRefills((((await r.json()) as { tx_responses?: RestTx[] }).tx_responses ?? []), relayerQor);
}

/** What /api/health shows about the refill job. */
export async function refillStatus(rest: string, funderQor: string | null, relayerQor: string, now = Date.now(), f: typeof fetch = fetch, r: RefillRules = DEFAULT_RULES) {
  if (!funderQor) return { configured: false as const };
  try {
    const rows = await fetchRefills(rest, funderQor, relayerQor, f);
    const last = rows.find((x) => x.code === 0) ?? null;
    const bal = await f(`${rest.replace(/\/$/, '')}/cosmos/bank/v1beta1/balances/${funderQor}`, { signal: AbortSignal.timeout(8_000) }).then((x) => x.json() as Promise<{ balances?: { denom: string; amount: string }[] }>).catch(() => null);
    const funderUqor = bal ? BigInt(bal.balances?.find((b) => b.denom === 'uqor')?.amount ?? '0') : null;
    return {
      configured: true as const, funder: funderQor, job: '.github/workflows/refill-relayer.yml',
      rules: { lineQor: fmt(r.thresholdUqor), targetQor: fmt(r.targetUqor), maxPerSendQor: fmt(r.maxPerSendUqor), dailyCapQor: fmt(r.dailyCapUqor) },
      funderBalance: funderUqor === null ? null : fmt(funderUqor),
      lastRefill: last ? { tx: last.txhash, height: last.height, time: last.time, amount: fmt(last.amountUqor) } : null,
      sentLast24h: fmt(sumLast24h(rows, now)),
    };
  } catch (e) {
    return { configured: true as const, funder: funderQor, error: e instanceof Error ? e.message : String(e) };
  }
}

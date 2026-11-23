/**
 * Pure helpers behind the Overview dashboard. Every value they return is derived from a LIVE read
 * (the chain, the relayer API); nothing here invents a number.
 */
import type { Health } from './api';
import type { KeyStatus } from './claim4';

export type CheckState = 'ok' | 'no' | 'unknown' | 'nokey';
export interface SafetyCheck { id: 'registered' | 'possession' | 'hybrid'; label: string; state: CheckState; detail: string }

/** The three quantum-safety checks shown on the Overview gauge. Without a key in this browser, the two key checks are 'nokey'. */
export function safetyChecks(hasKey: boolean, status: KeyStatus | undefined, health: Health | undefined): SafetyCheck[] {
  const key = (ok: boolean | undefined, yes: string, no: string): Pick<SafetyCheck, 'state' | 'detail'> =>
    !hasKey ? { state: 'nokey', detail: 'Not yet: no key in this browser' } : ok === undefined ? { state: 'unknown', detail: 'Reading the chain…' } : ok ? { state: 'ok', detail: yes } : { state: 'no', detail: no };
  const relay = health?.relay;
  const hybrid: Pick<SafetyCheck, 'state' | 'detail'> = !health ? { state: 'unknown', detail: 'Reading the relayer…' }
    : relay?.mode === 'hybrid' && !relay.classicalPathOpen ? { state: 'ok', detail: 'secp256k1 + ML-DSA-87, ECDSA-only path closed' }
    : relay?.mode === 'hybrid' ? { state: 'ok', detail: 'secp256k1 + ML-DSA-87' } : { state: 'no', detail: 'Relayer on the ECDSA window lane' };
  return [
    { id: 'registered', label: 'Key registered', ...key(status ? status.registered && status.algoId === 1 : undefined, 'ML-DSA-87 key in pqcKeyStatus', 'Not registered yet') },
    { id: 'possession', label: 'Possession proven', ...key(status?.possessionProven, 'Proof of possession on chain', 'Not proven yet') },
    { id: 'hybrid', label: 'Hybrid relay', ...hybrid },
  ];
}

/** Honest ratio over all three checks: a key check this browser cannot run yet ('nokey') counts as not passed.
 *  `ready` is false while any check is still being read, so the gauge never shows a provisional number. */
export function safetyScore(checks: SafetyCheck[]): { pct: number; passed: number; total: number; ready: boolean } {
  const passed = checks.filter((c) => c.state === 'ok').length;
  const total = checks.length;
  return { pct: total ? Math.round((passed / total) * 100) : 0, passed, total, ready: !checks.some((c) => c.state === 'unknown') };
}

/** Cumulative event count over a block range, in `bins` equal buckets: the sparkline under the Proof card. */
export function cumulativeSeries(blocks: readonly (number | bigint)[], bins = 24): number[] {
  const b = blocks.map(Number).filter(Number.isFinite).sort((x, y) => x - y);
  if (b.length === 0) return [];
  const lo = b[0], hi = b[b.length - 1];
  const span = Math.max(1, hi - lo);
  const out = new Array<number>(bins).fill(0);
  for (const x of b) out[Math.min(bins - 1, Math.floor(((x - lo) / span) * bins))]++;
  for (let i = 1; i < bins; i++) out[i] += out[i - 1];
  return out;
}

/** SVG path for a sparkline of `values` in a w x h box (line and closed area). */
export function sparkPath(values: number[], w = 200, h = 56, pad = 3): { line: string; area: string } {
  if (values.length < 2) return { line: '', area: '' };
  const max = Math.max(...values), min = Math.min(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [pad + (i / (values.length - 1)) * (w - pad * 2), h - pad - ((v - min) / span) * (h - pad * 2)] as const);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  return { line, area: `${line} L${pts[pts.length - 1][0].toFixed(1)} ${h} L${pts[0][0].toFixed(1)} ${h} Z` };
}

/** "3 min ago" style age from a unix time in seconds. */
export function ago(unix: number | undefined, now = Date.now() / 1000): string {
  if (!unix) return '';
  const s = Math.max(0, Math.round(now - unix));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

export const shortAddr = (a: string) => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

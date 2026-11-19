// Structured JSON logs. Anything that looks like a secret (long hex, key-ish field names) is redacted.
const SECRET_KEYS = /key|secret|seed|mnemonic|token|authorization|sig|pk|password/i;
const LONG_HEX = /0x[0-9a-fA-F]{130,}/g;

export function redact(v: unknown, depth = 0): unknown {
  if (v == null || depth > 4) return v;
  if (typeof v === 'string') return v.replace(LONG_HEX, (m) => `0x<${(m.length - 2) / 2}B>`);
  if (typeof v === 'bigint') return v.toString();
  if (Array.isArray(v)) return v.slice(0, 20).map((x) => redact(x, depth + 1));
  if (typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      out[k] = SECRET_KEYS.test(k) && !/^(linkId|hash|txHash)$/i.test(k) ? '[redacted]' : redact(x, depth + 1);
    }
    return out;
  }
  return v;
}

export type Sink = (line: string) => void;
let sink: Sink = (l) => process.stdout.write(l + '\n');
export function setSink(s: Sink) { sink = s; }

export function log(level: 'info' | 'warn' | 'error', event: string, fields: Record<string, unknown> = {}) {
  sink(JSON.stringify({ ts: new Date().toISOString(), level, event, ...(redact(fields) as object) }));
}

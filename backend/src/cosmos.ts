// Cosmos-lane helpers for the hybrid relay: account sequence, broadcast, inclusion wait, gas dry run, and a minimal
// protobuf reader for the tx result (`tx_response.data`, a TxMsgData) so a MsgCrossVMCall's return value can be read
// without an EVM log (a cross-VM call leaves none). No dependency: the reader only walks the fields it needs.
import { bytesToHex, type Hex } from 'viem';

export type Fetch = typeof fetch;

/** Read a protobuf varint at `i`; returns [value, next index]. */
function varint(b: Uint8Array, i: number): [bigint, number] {
  let v = 0n, s = 0n;
  for (;;) {
    if (i >= b.length) throw new Error('protobuf: truncated varint');
    const x = b[i++];
    v |= BigInt(x & 0x7f) << s;
    if (!(x & 0x80)) return [v, i];
    s += 7n;
    if (s > 63n) throw new Error('protobuf: varint too long');
  }
}

/** Top-level fields of one protobuf message: field number -> list of raw values (bytes for length-delimited, bigint for varint). */
export function pbFields(b: Uint8Array): Map<number, (Uint8Array | bigint)[]> {
  const out = new Map<number, (Uint8Array | bigint)[]>();
  let i = 0;
  while (i < b.length) {
    const [key, j] = varint(b, i); i = j;
    const field = Number(key >> 3n), wire = Number(key & 7n);
    let val: Uint8Array | bigint;
    if (wire === 0) { [val, i] = varint(b, i); }
    else if (wire === 2) { const [len, k] = varint(b, i); i = k; const end = i + Number(len); if (end > b.length) throw new Error('protobuf: truncated bytes'); val = b.slice(i, end); i = end; }
    else if (wire === 1) { val = b.slice(i, i + 8); i += 8; }
    else if (wire === 5) { val = b.slice(i, i + 4); i += 4; }
    else throw new Error(`protobuf: unsupported wire type ${wire}`);
    const list = out.get(field) ?? []; list.push(val); out.set(field, list);
  }
  return out;
}

const text = (u: Uint8Array | bigint | undefined) => (u instanceof Uint8Array ? new TextDecoder().decode(u) : '');
export const CROSSVM_RESPONSE_URL = '/qorechain.crossvm.v1.MsgCrossVMCallResponse';
export const CROSSVM_CALL_URL = '/qorechain.crossvm.v1.MsgCrossVMCall';

export interface CrossVmResponse { messageId: string; executed: boolean; data: Hex; gasUsed: string }

/** Decode the MsgCrossVMCallResponse entries of a tx result (`tx_response.data`, hex). Other message responses are skipped. */
export function crossVmResponses(dataHex: string | null | undefined): CrossVmResponse[] {
  if (!dataHex) return [];
  const raw = Uint8Array.from(Buffer.from(dataHex.replace(/^0x/, ''), 'hex'));
  const out: CrossVmResponse[] = [];
  for (const any of pbFields(raw).get(2) ?? []) { // TxMsgData.msg_responses (Any)
    if (!(any instanceof Uint8Array)) continue;
    const a = pbFields(any);
    if (text(a.get(1)?.[0]) !== CROSSVM_RESPONSE_URL) continue;
    const v = a.get(2)?.[0];
    const r = v instanceof Uint8Array ? pbFields(v) : new Map();
    const data = r.get(3)?.[0];
    out.push({
      messageId: text(r.get(1)?.[0]),
      executed: (r.get(2)?.[0] ?? 0n) === 1n,
      data: data instanceof Uint8Array ? bytesToHex(data) : '0x',
      gasUsed: (() => { const g = r.get(4)?.[0]; return typeof g === 'bigint' ? g.toString() : text(g) || '0'; })(),
    });
  }
  return out;
}

export interface TxEvent { type: string; attributes: { key: string; value: string }[] }
export interface TxResponse { txhash: string; height: string; code: number; gas_used?: string; gas_wanted?: string; raw_log?: string; data?: string; timestamp?: string; events?: TxEvent[]; tx?: { body?: { memo?: string; messages?: Record<string, unknown>[] } } }

/** True when the chain recorded a verified hybrid (secp256k1 + ML-DSA-87) signature for this tx. */
export function hybridVerified(tx: Pick<TxResponse, 'events'>): boolean {
  return (tx.events ?? []).some((e) => e.type === 'pqc_hybrid_verify' && e.attributes.some((a) => a.key === 'status' && a.value === 'verified'));
}

export async function accountSeq(rest: string, addr: string, f: Fetch = fetch): Promise<{ accountNumber: bigint; sequence: bigint }> {
  const r = await f(`${rest}/cosmos/auth/v1beta1/accounts/${addr}`, { signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`account read HTTP ${r.status}`);
  const j = (await r.json()) as { account?: { base_account?: { account_number?: string; sequence?: string }; account_number?: string; sequence?: string } };
  const a = j.account?.base_account ?? j.account ?? {};
  return { accountNumber: BigInt(a.account_number ?? 0), sequence: BigInt(a.sequence ?? 0) };
}

/** Dry-run a signed tx; returns gas used, or null when the node refuses the simulation. */
export async function simulateGas(rest: string, txBytesB64: string, f: Fetch = fetch): Promise<bigint | null> {
  try {
    const r = await f(`${rest}/cosmos/tx/v1beta1/simulate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tx_bytes: txBytesB64 }), signal: AbortSignal.timeout(20_000) });
    if (!r.ok) return null;
    const j = (await r.json()) as { gas_info?: { gas_used?: string } };
    return j.gas_info?.gas_used && /^\d+$/.test(j.gas_info.gas_used) ? BigInt(j.gas_info.gas_used) : null;
  } catch { return null; }
}

export interface Broadcast { txhash: string | null; code: number; log: string; httpStatus: number }
export async function broadcastSync(rest: string, txBytesB64: string, f: Fetch = fetch): Promise<Broadcast> {
  const r = await f(`${rest}/cosmos/tx/v1beta1/txs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tx_bytes: txBytesB64, mode: 'BROADCAST_MODE_SYNC' }), signal: AbortSignal.timeout(20_000) });
  const j = (await r.json().catch(() => ({}))) as { tx_response?: { code?: number; txhash?: string; raw_log?: string } };
  return { txhash: j.tx_response?.txhash ?? null, code: j.tx_response?.code ?? (r.ok ? 0 : -1), log: j.tx_response?.raw_log ?? '', httpStatus: r.status };
}

/** Poll until the tx is in a block (or `tries` polls pass). */
export async function waitTx(rest: string, hash: string, f: Fetch = fetch, tries = 30, everyMs = 1500): Promise<TxResponse | null> {
  for (let i = 0; i < tries; i++) {
    await new Promise((r) => setTimeout(r, everyMs));
    const r = await f(`${rest}/cosmos/tx/v1beta1/txs/${hash}`, { signal: AbortSignal.timeout(10_000) }).catch(() => null);
    if (r?.ok) { const j = (await r.json()) as { tx_response?: TxResponse }; if (j.tx_response) return j.tx_response; }
  }
  return null;
}

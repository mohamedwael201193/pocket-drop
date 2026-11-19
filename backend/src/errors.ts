import { decodeErrorResult, type Hex } from 'viem';
import { pocketDropAbi } from './abi.js';

export interface DecodedRevert {
  name: string;
  message: string;
  args?: readonly unknown[];
  selector: Hex | null;
  raw: Hex | null;
  known: boolean;
}

/** Human-readable text for the contract's custom errors. Unlisted names fall back to a generic sentence. */
const HUMAN: Record<string, string> = {
  BadLinkSignature: 'The link signature does not verify for this recipient (wrong link key or tampered request).',
  BadRecipientSignature: 'The recipient signature does not verify against the key registered for the recipient.',
  PossessionNotProven: 'The recipient account has a PQ key but has not proven possession of it.',
  NotRegistered: 'The recipient account has no registered post-quantum key yet.',
  UnsupportedAlgo: 'The recipient key is not ML-DSA-87.',
  KeyStatusUnavailable: 'The chain key-status precompile could not be read; nothing was paid.',
  LinkKeyMismatch: 'The supplied link public key does not match the link.',
  RecipientKeyMismatch: 'The recipient registered key does not match the key bound to this link.',
  RecipientChanged: 'The recipient changed after confirmation.',
  BadRecipient: 'This recipient address is not allowed.',
  InvalidState: 'The link is not in a state that allows this action.',
  WrongMode: 'This action does not apply to this link mode.',
  NotSender: 'Only the link sender can do this.',
  Expired: 'The link has expired.',
  NotExpired: 'The link has not expired yet.',
  BindDeadlinePassed: 'The bind deadline has passed.',
  LinkNotFound: 'No such link.',
  AmountOutOfRange: 'The amount is outside the allowed range.',
  DripTooHigh: 'The drip exceeds the per-link maximum.',
  DailyDripCapExceeded: 'The sender daily drip cap is exceeded.',
  InvalidExpiry: 'The expiry is out of range.',
  InvalidMode: 'Unknown link mode.',
  InvalidConfig: 'Invalid contract configuration.',
  ZeroLinkKey: 'The link key hash is zero.',
  ZeroRecipientKey: 'The recipient key hash is zero.',
  NothingToWithdraw: 'Nothing to withdraw.',
  WithdrawFailed: 'The withdrawal transfer failed.',
  Reentrancy: 'Reentrant call blocked.',
};

const STATE_NAMES = ['None', 'Open', 'Bound', 'Confirmed', 'Claimed', 'Cancelled', 'Refunded'];

const PANIC_CODES: Record<number, string> = {
  0x01: 'assertion failed', 0x11: 'arithmetic overflow/underflow', 0x12: 'division by zero', 0x21: 'invalid enum value',
  0x22: 'bad storage encoding', 0x31: 'pop on empty array', 0x32: 'array index out of bounds', 0x41: 'out of memory', 0x51: 'bad function pointer',
};

const HEX_RE = /^0x[0-9a-fA-F]*$/;

/** Find revert data in a viem error (walks `cause`, looks at `data` as string or `{ data }`). */
export function extractRevertData(err: unknown): Hex | null {
  const seen = new Set<unknown>();
  let cur: any = err;
  while (cur && typeof cur === 'object' && !seen.has(cur)) {
    seen.add(cur);
    const d = cur.data;
    if (typeof d === 'string' && HEX_RE.test(d) && d.length >= 10) return d as Hex;
    if (d && typeof d === 'object' && typeof d.data === 'string' && HEX_RE.test(d.data) && d.data.length >= 10) return d.data as Hex;
    cur = cur.cause;
  }
  const msg = String((err as any)?.details ?? (err as any)?.message ?? '');
  const m = msg.match(/0x[0-9a-fA-F]{8,}/);
  return m && (m[0].length - 2) % 2 === 0 ? (m[0] as Hex) : null;
}

export function decodeRevert(data: Hex | null | undefined, fallbackMessage = 'execution reverted'): DecodedRevert {
  if (!data || data === '0x' || data.length < 10) {
    return { name: 'Revert', message: fallbackMessage, selector: null, raw: data ?? null, known: false };
  }
  const selector = data.slice(0, 10).toLowerCase() as Hex;
  if (selector === '0x08c379a0') {
    try {
      const r = decodeErrorResult({ abi: [{ type: 'error', name: 'Error', inputs: [{ name: 'message', type: 'string' }] }], data });
      return { name: 'Error', message: String(r.args?.[0] ?? ''), args: r.args, selector, raw: data, known: true };
    } catch { /* fall through */ }
  }
  if (selector === '0x4e487b71') {
    try {
      const r = decodeErrorResult({ abi: [{ type: 'error', name: 'Panic', inputs: [{ name: 'code', type: 'uint256' }] }], data });
      const code = Number(r.args?.[0] ?? 0);
      return { name: 'Panic', message: `panic 0x${code.toString(16)}: ${PANIC_CODES[code] ?? 'unknown'}`, args: r.args, selector, raw: data, known: true };
    } catch { /* fall through */ }
  }
  try {
    const r = decodeErrorResult({ abi: pocketDropAbi, data });
    const st = r.errorName === 'InvalidState' && r.args?.length ? ` (current state: ${STATE_NAMES[Number(r.args[0])] ?? r.args[0]})` : '';
    return { name: r.errorName, message: (HUMAN[r.errorName] ?? `Contract error ${r.errorName}.`) + st, args: r.args as readonly unknown[] | undefined, selector, raw: data, known: true };
  } catch {
    return { name: 'UnknownError', message: `Unrecognised revert (selector ${selector}).`, selector, raw: data, known: false };
  }
}

/** True when the chain refused the tx because the relayer EVM authorisation window is closed, exhausted or scoped away. */
export function isWindowError(err: unknown): boolean {
  const s = `${(err as any)?.details ?? ''} ${(err as any)?.shortMessage ?? ''} ${(err as any)?.message ?? ''}`;
  return /authori[sz]ation window/i.test(s);
}

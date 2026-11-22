// Checks on the "send to" address of a Pocket spend, before the owner signs: a wrong checksum, the Pocket itself, a
// Pocket Drop contract, any other contract, and an address that looks like one the owner already uses (same first and
// last 4 hex characters, different in between: the address-poisoning pattern).
import { getAddress, isAddress, type Hex } from 'viem';

export interface RecipientCheck {
  /** Stops the spend. */
  block: string | null;
  /** Must be acknowledged before the spend can be signed. */
  confirm: string | null;
  info: string[];
}

export const lookalike = (a: string, b: string): boolean => {
  const x = a.toLowerCase(); const y = b.toLowerCase();
  return x !== y && x.slice(2, 6) === y.slice(2, 6) && x.slice(-4) === y.slice(-4);
};

export interface RecipientContext {
  pocket: Hex | null;
  keyAccount: Hex | null;
  /** Addresses this owner already used or trusts: guardians, earlier spend recipients. */
  known: Hex[];
  /** Pocket Drop contracts by lower-case address. */
  protocol: Record<string, string>;
  /** On-chain facts about `to` (null while loading). */
  code: { isContract: boolean; isPocket: boolean } | null;
}

export function checkRecipient(to: string, c: RecipientContext): RecipientCheck {
  const out: RecipientCheck = { block: null, confirm: null, info: [] };
  const t = to.trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(t)) return { ...out, block: 'Enter the 0x address to send to (0x and 40 hex characters).' };
  if (!isAddress(t)) return { ...out, block: 'The capital letters in this address do not match its checksum. One character is probably wrong: copy it again from the source.' };
  const low = t.toLowerCase();
  if (c.pocket && low === c.pocket.toLowerCase()) return { ...out, block: 'This is your Pocket itself. Sending to it would move nothing.' };
  if (c.protocol[low]) return { ...out, block: `This is the ${c.protocol[low]} contract. Sending QOR to it does not create a drop and cannot be taken back; use Send for links.` };
  if (c.keyAccount && low === c.keyAccount.toLowerCase()) out.info.push('This is your own key account (it pays your registration and gas).');
  const twin = c.known.find((k) => lookalike(k, t));
  if (twin) out.confirm = `This address starts and ends like ${getAddress(twin)}, which you already use, but the middle is different. Scammers make lookalike addresses for this. Compare every character.`;
  if (c.code?.isPocket) out.info.push('This is another Pocket (a quantum-safe vault). It can receive QOR.');
  else if (c.code?.isContract && !out.confirm) out.confirm = 'This address is a contract, not a person\'s account. QOR sent to a contract may be stuck there for good. Send only if you know what it does.';
  const known = c.known.find((k) => k.toLowerCase() === low);
  if (known) out.info.push('You have used this address before.');
  return out;
}

const KEY = 'pd.recentRecipients';
export function recentRecipients(): Hex[] {
  try { const v = JSON.parse(localStorage.getItem(KEY) ?? '[]'); return Array.isArray(v) ? v.filter((x): x is Hex => typeof x === 'string' && /^0x[0-9a-fA-F]{40}$/.test(x)) : []; } catch { return []; }
}
export function rememberRecipient(a: Hex) {
  try { localStorage.setItem(KEY, JSON.stringify([a, ...recentRecipients().filter((x) => x.toLowerCase() !== a.toLowerCase())].slice(0, 20))); } catch { /* private mode */ }
}

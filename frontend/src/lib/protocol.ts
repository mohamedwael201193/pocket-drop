// Pure protocol helpers (no network, no heavy deps): digests the contract expects, fingerprints, link URLs.
import { encodeAbiParameters, keccak256, type Hex } from 'viem';
import { english } from 'viem/accounts';
import { CHAIN_ID } from './config';

export const BIND_DOMAIN = 'POCKETDROP_BIND_V1';
export const CLAIM_DOMAIN = 'POCKETDROP_CLAIM_V1';

/** Exact bytes the link key signs for `bind` (equals contract.bindDigest). */
export function bindMessage(contract: Hex, linkId: bigint, recipient: Hex, recipientKeyHash: Hex, chainId: number = CHAIN_ID): Hex {
  return encodeAbiParameters(
    [{ type: 'string' }, { type: 'uint256' }, { type: 'address' }, { type: 'uint256' }, { type: 'address' }, { type: 'bytes32' }],
    [BIND_DOMAIN, BigInt(chainId), contract, linkId, recipient, recipientKeyHash],
  );
}

/** Exact bytes the recipient key signs for `claim` (equals contract.claimDigest). */
export function claimMessage(contract: Hex, linkId: bigint, recipient: Hex, chainId: number = CHAIN_ID): Hex {
  return encodeAbiParameters(
    [{ type: 'string' }, { type: 'uint256' }, { type: 'address' }, { type: 'uint256' }, { type: 'address' }],
    [CLAIM_DOMAIN, BigInt(chainId), contract, linkId, recipient],
  );
}

export const hexToBytes = (h: string): Uint8Array => {
  const c = h.replace(/^0x/, '');
  if (c.length % 2 || /[^0-9a-f]/i.test(c)) throw new Error('bad hex');
  return Uint8Array.from(c.match(/../g) ?? [], (x) => parseInt(x, 16));
};
export const bytesToHex = (u: Uint8Array): Hex => ('0x' + Array.from(u, (b) => b.toString(16).padStart(2, '0')).join('')) as Hex;
export const keyHashOf = (publicKey: Uint8Array): Hex => keccak256(bytesToHex(publicKey));

/**
 * 4-word fingerprint of a recipientKeyHash: the first 44 bits of the (already keccak) hash as four 11-bit indices
 * into the 2048-word BIP-39 English list. A forged key must collide on all 44 bits to fool the sender.
 */
export function fingerprint(keyHash: string): string[] {
  const bytes = hexToBytes(keyHash);
  if (bytes.length !== 32) throw new Error('key hash must be 32 bytes');
  let acc = 0n;
  for (let i = 0; i < 6; i++) acc = (acc << 8n) | BigInt(bytes[i]);
  acc >>= 4n; // 48 -> 44 bits
  const words: string[] = [];
  for (let i = 3; i >= 0; i--) words.push(english[Number((acc >> BigInt(i * 11)) & 0x7ffn)]);
  return words;
}
export const fingerprintText = (keyHash: string) => fingerprint(keyHash).join(' ');

/* ---------- link URLs: the seed lives ONLY in the #fragment, which browsers never send to servers ---------- */

export function buildClaimUrl(origin: string, linkId: bigint | string, seed: Uint8Array): string {
  return `${origin}/c/${linkId}#k=${bytesToHex(seed).slice(2)}`;
}

export function parseClaimFragment(hash: string): Uint8Array | null {
  const m = /^#?k=([0-9a-fA-F]{64})$/.exec(hash);
  return m ? hexToBytes(m[1]) : null;
}

export function shareMessage(amountQor: string): string {
  return `I sent you ${amountQor} testnet QOR on QoreChain. No wallet needed, just open this link:`;
}
export function whatsappUrl(message: string, link: string): string {
  return `https://wa.me/?text=${encodeURIComponent(`${message} ${link}`)}`;
}

export const shortHash = (h: string, n = 8) => (h.length > 2 * n + 2 ? `${h.slice(0, n + 2)}…${h.slice(-n)}` : h);

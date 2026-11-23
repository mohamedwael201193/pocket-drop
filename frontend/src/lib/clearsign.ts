// Clear signing: the plain-language reading of an owner intent, built from the SAME fields that make the digest.
// The bytes a key signs are "qorechain-msg-v1|qorechain-diana|0x<digest>" (PqcLib.pqMessage), i.e. a hash. This module
// turns the intent fields back into lines a person can check (what, to whom, how much, which contract, which chain,
// which nonce, until when) and recomputes the digest from exactly those fields, so the text shown and the hash signed
// cannot drift apart: `describeIntent(...).digest` is what gets signed.
import { decodeAbiParameters, formatEther, type Hex } from 'viem';
import { ACT, CHAIN_ID, intentDigest, pqMessageText } from './intents';

export interface ClearLine { k: string; v: string }
export interface ClearIntent { title: string; lines: ClearLine[]; digest: Hex; signedText: string }

const NAMES: Record<string, string> = Object.fromEntries(Object.entries(ACT).map(([k, v]) => [v.toLowerCase(), k]));
const qor = (wei: bigint) => `${formatEther(wei)} QOR (${wei} wei)`;
const when = (s: bigint) => (s > 0n && s < 10n ** 11n ? `${new Date(Number(s) * 1000).toISOString().replace('.000Z', 'Z')} (unix ${s})` : `unix ${s}`);
const dec = (types: string[], data: Hex) => decodeAbiParameters(types.map((type) => ({ type })) as never, data) as readonly unknown[];

/** Decode one owner intent into readable lines. Throws on an unknown action or params that do not decode. */
export function describeIntent(a: { action: Hex; vault: Hex; nonce: bigint; deadline: bigint; params: Hex; chainId?: bigint }): ClearIntent {
  const name = NAMES[a.action.toLowerCase()];
  if (!name) throw new Error('Unknown intent action');
  const chainId = a.chainId ?? CHAIN_ID;
  const lines: ClearLine[] = [];
  let title: string;
  switch (name) {
    case 'SPEND': { const [to, amt] = dec(['address', 'uint256'], a.params) as [Hex, bigint]; title = 'Send QOR from your Pocket'; lines.push({ k: 'Recipient', v: to }, { k: 'Amount', v: qor(amt) }); break; }
    case 'VETO_QUEUED': { const [id] = dec(['uint256'], a.params) as [bigint]; title = 'Stop a queued spend'; lines.push({ k: 'Queued spend id', v: String(id) }); break; }
    case 'SET_LIMIT': { const [v] = dec(['uint256'], a.params) as [bigint]; title = 'Change the daily limit'; lines.push({ k: 'New daily limit', v: qor(v) }, { k: 'Rule', v: 'a raise waits for the timelock; a lower limit applies now' }); break; }
    case 'SET_GUARDIANS': { const [g, t] = dec(['address[]', 'uint8'], a.params) as [Hex[], number]; title = 'Change guardians'; lines.push({ k: 'Guardians', v: g.length ? g.join(', ') : 'none' }, { k: 'Needed to recover', v: `${t} of ${g.length}` }); break; }
    case 'CANCEL_PENDING': title = 'Cancel pending limit and guardian changes'; break;
    case 'VETO_RECOVERY': title = 'Stop a pending guardian recovery'; break;
    case 'CREATE_DROP': {
      const [drop, lk, mode, expiry, drip, fee, value] = dec(['address', 'bytes32', 'uint8', 'uint64', 'uint96', 'uint96', 'uint256'], a.params) as [Hex, Hex, number, bigint, bigint, bigint, bigint];
      title = 'Create a payment link';
      lines.push({ k: 'Drop contract', v: drop }, { k: 'Mode', v: mode === 0 ? 'Confirmed (you approve the recipient key)' : 'Open (first valid claimer)' },
        { k: 'Link amount', v: qor(value - drip - fee) }, { k: 'Starter gas for recipient', v: qor(drip) }, { k: 'Delivery fee', v: qor(fee) },
        { k: 'Total leaving the Pocket', v: qor(value) }, { k: 'Link expires', v: when(expiry) }, { k: 'Link key hash', v: lk });
      break;
    }
    case 'CONFIRM_DROP': { const [drop, id, kh] = dec(['address', 'uint256', 'bytes32'], a.params) as [Hex, bigint, Hex]; title = 'Confirm who receives a link'; lines.push({ k: 'Drop contract', v: drop }, { k: 'Link id', v: String(id) }, { k: 'Recipient key hash', v: kh }); break; }
    case 'CANCEL_DROP': { const [drop, id] = dec(['address', 'uint256'], a.params) as [Hex, bigint]; title = 'Cancel a link and take the money back'; lines.push({ k: 'Drop contract', v: drop }, { k: 'Link id', v: String(id) }); break; }
    case 'CREATE_POOL': {
      const [pool, lk, slots, per, expiry] = dec(['address', 'bytes32', 'uint32', 'uint96', 'uint64'], a.params) as [Hex, Hex, number, bigint, bigint];
      title = 'Create a shared pool link';
      lines.push({ k: 'Pool contract', v: pool }, { k: 'Slots', v: String(slots) }, { k: 'Per claimer', v: qor(per) }, { k: 'Total leaving the Pocket', v: qor(per * BigInt(slots)) }, { k: 'Pool expires', v: when(expiry) }, { k: 'Link key hash', v: lk });
      break;
    }
    case 'CLOSE_POOL': { const [pool, id] = dec(['address', 'uint256'], a.params) as [Hex, bigint]; title = 'Close a pool and take back unclaimed slots'; lines.push({ k: 'Pool contract', v: pool }, { k: 'Pool id', v: String(id) }); break; }
    default: throw new Error(`${name} is not an owner intent`);
  }
  lines.push(
    { k: 'Pocket (contract)', v: a.vault },
    { k: 'Chain', v: chainId === 9800n ? 'QoreChain Diana testnet (EVM chain id 9800)' : `chain id ${chainId}` },
    { k: 'Intent number (nonce)', v: String(a.nonce) },
    { k: 'Valid until', v: when(a.deadline) },
  );
  const digest = intentDigest({ ...a, chainId });
  return { title, lines, digest, signedText: pqMessageText(digest) };
}

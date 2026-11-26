// Size check of every ML-DSA-87 signature and public key inside a relay request, before anything is simulated or sent.
// The contracts hand these bytes to the pqcVerify precompile, which rejects wrong sizes; checking here as well gives a
// clear 400 instead of a generic revert, keeps malformed blobs off the relayer's simulation budget, and puts the
// FIPS 204 sizes (public key 2592 bytes, signature 4627 bytes) into production code, not only into tests.
// The ABI below lists every state-changing PocketVault / PocketDrop / DropPool function that carries a signature or a
// key; backend/test/pqPreflight.test.ts checks it against contracts-v4/abi/*.json.
import { decodeFunctionData, parseAbi, type Hex } from 'viem';
import { ML_DSA_87_PK_BYTES, ML_DSA_87_SIG_BYTES } from './keystatus.js';

export const PQ_ARG_ABI = parseAbi([
  // PocketVault owner intents (last argument = the owner's ML-DSA-87 signature)
  'function spend(address to, uint256 amount, uint256 deadline, bytes sig)',
  'function vetoQueued(uint256 id, uint256 deadline, bytes sig)',
  'function setLimit(uint256 newLimit, uint256 deadline, bytes sig)',
  'function setGuardians(address[] guardians_, uint8 threshold_, uint256 deadline, bytes sig)',
  'function cancelPending(uint256 deadline, bytes sig)',
  'function vetoRecovery(uint256 deadline, bytes sig)',
  'function createDrop(address drop, bytes32 linkKeyHash, uint8 mode, uint64 expiry, uint96 drip, uint96 relayerFee, uint256 value, uint256 deadline, bytes sig)',
  'function confirmDrop(address drop, uint256 linkId, bytes32 expectedRecipientKeyHash, uint256 deadline, bytes sig)',
  'function cancelDrop(address drop, uint256 linkId, uint256 deadline, bytes sig)',
  'function createPool(address pool, bytes32 linkKeyHash, uint32 slots, uint96 perSlot, uint64 expiry, uint256 deadline, bytes sig)',
  'function closePool(address pool, uint256 poolId, uint256 deadline, bytes sig)',
  // PocketVault guardian intents
  'function guardianFreeze(address[] signers, bytes[] sigs, uint256 nonce_, uint256 deadline)',
  'function proposeRecovery(address newOwner, bytes32 newKeyHash, uint256 deadline, address[] signers, bytes[] sigs)',
  'function proposeRecoveryUnanimous(address newOwner, bytes32 newKeyHash, uint256 deadline, address[] signers, bytes[] sigs)',
  // PocketDrop
  'function bind(uint256 linkId, address recipient, bytes32 recipientKeyHash, address payTo, bytes linkPk, bytes linkSig)',
  // v5.1: the link key also signs feeTo, the address paid the relayer fee
  'function bind(uint256 linkId, address recipient, bytes32 recipientKeyHash, address payTo, address feeTo, bytes linkPk, bytes linkSig)',
  'function claim(uint256 linkId, bytes recipientSig)',
  // DropPool
  'function claim(uint256 poolId, address recipient, address payTo, bytes linkPk, bytes linkSig, bytes recipientSig)',
]);

export type PreflightIssue = { fn: string; arg: string; index?: number; bytes: number; expected: number };
export type Preflight = { known: false } | { known: true; fn: string; issues: PreflightIssue[] };

const byteLen = (h: Hex) => (h.length - 2) / 2;
const isSigArg = (name: string) => /sigs?$/i.test(name);
const isPkArg = (name: string) => /pk$/i.test(name);

/** Decode `data` (the call the router forwards) and report any signature or key of the wrong size. */
export function pqPreflight(data: Hex): Preflight {
  let d: { functionName: string; args?: readonly unknown[] };
  try { d = decodeFunctionData({ abi: PQ_ARG_ABI, data }) as never; } catch { return { known: false }; }
  const item = PQ_ARG_ABI.find((x) => x.name === d.functionName && x.inputs.length === (d.args?.length ?? 0))!;
  const issues: PreflightIssue[] = [];
  item.inputs.forEach((inp, i) => {
    const name = inp.name ?? '';
    const v = d.args![i];
    const expected = isSigArg(name) ? ML_DSA_87_SIG_BYTES : isPkArg(name) ? ML_DSA_87_PK_BYTES : 0;
    if (!expected) return;
    if (inp.type === 'bytes') { const n = byteLen(v as Hex); if (n !== expected) issues.push({ fn: d.functionName, arg: name, bytes: n, expected }); }
    else if (inp.type === 'bytes[]') (v as Hex[]).forEach((s, k) => { const n = byteLen(s); if (n !== expected) issues.push({ fn: d.functionName, arg: name, index: k, bytes: n, expected }); });
  });
  return { known: true, fn: d.functionName, issues };
}

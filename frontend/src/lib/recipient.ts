// Recipient side, all in the browser tab. Mirrors the proven phone spike (spike/page/src/main.ts): keygen, PoP registration
// through the key-less proxy, hybrid scoped EVM window, ML-DSA signing. Lazy-loaded: it pulls the heavy QoreChain SDK.
import { unifiedAccountFromSeed, getNetwork, EthNativeSigner, buildRegisterPqcKeyMsg, signProofOfPossession, openEvmWindowMsg } from '@qorechain/sdk';
import { evmWindowCost, evmWindowStatus } from '@qorechain/evm';
import { mldsa } from '@qorechain/pqc';
import { StargateClient } from '@cosmjs/stargate';
import { decodeFunctionResult, encodeFunctionData, parseAbi, type Hex } from 'viem';
import { COSMOS_REST, COSMOS_RPC, POCKETDROP_ADDRESS, COSMOS_CHAIN_ID } from './config';
import { pub } from './chain';
import { bindMessage, bytesToHex, claimMessage, hexToBytes, keyHashOf } from './protocol';
import { keyMaterial, parseRoot } from './keyderive';

const net = getNetwork('testnet');
if (net.chainId !== COSMOS_CHAIN_ID) throw new Error('testnet only');
const KEYS = '0x0000000000000000000000000000000000000a02' as const;
const KS = parseAbi(['function pqcKeyStatus(address) view returns (bool, uint8, bytes, bool)']);

export type RecipientAccount = Awaited<ReturnType<typeof unifiedAccountFromSeed>>;

async function sha256(b: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', b as unknown as BufferSource));
}

/** LEGACY (v1) derivation, kept for roots created before 20 Nov 2026: secp key = root, ML-DSA secret = sha256(root | "|mldsa87").
 *  The ML-DSA secret is computable from the classical key, so never use this for a new account. */
export async function deriveRecipient(root: Uint8Array): Promise<RecipientAccount> {
  const tag = new TextEncoder().encode('|mldsa87');
  const pqcSecret = await sha256(new Uint8Array([...root, ...tag]));
  return unifiedAccountFromSeed(root, { pqcSecret });
}

/** Account for a stored root string: v2 ("pd2:…", independent one-way keys) or a legacy 64-hex root. */
export async function deriveFromRoot(root: string): Promise<RecipientAccount> {
  const p = parseRoot(root);
  if (!p) throw new Error('Not a valid browser key.');
  const { secp, pqcSecret } = keyMaterial(p);
  return unifiedAccountFromSeed(secp, { pqcSecret });
}

async function seqOf(addr: string) {
  const r = await fetch(`${COSMOS_REST}/cosmos/auth/v1beta1/accounts/${addr}`);
  if (r.status === 404) return { accountNumber: 0n, sequence: 0n };
  if (!r.ok) throw new Error(`REST account lookup failed (HTTP ${r.status})`);
  const j = await r.json();
  const a = j.account?.base_account ?? j.account ?? {};
  return { accountNumber: BigInt(a.account_number ?? 0), sequence: BigInt(a.sequence ?? 0) };
}

async function cosmosTx(acct: RecipientAccount, mode: 'classical' | 'hybrid', messages: unknown[], fee: string, gas: string): Promise<string> {
  const s = await seqOf(acct.cosmos);
  const signer = new EthNativeSigner(acct, { signMode: mode, rest: COSMOS_REST });
  const params: Record<string, unknown> = { chainId: net.chainId, accountNumber: s.accountNumber, sequence: s.sequence, fee: { amount: [{ denom: 'uqor', amount: fee }], gas }, messages };
  if (mode === 'hybrid') params.signBytesVersion = await signer.resolveSignBytesVersion(net.chainId);
  const signed = signer.sign(params as never);
  const client = await StargateClient.connect(COSMOS_RPC);
  try {
    const res = await client.broadcastTx(signed.txRawBytes, 60_000, 1000);
    if (res.code !== 0) throw new Error(`tx ${res.transactionHash} failed (code ${res.code}): ${res.rawLog}`);
    return res.transactionHash;
  } finally { client.disconnect(); }
}

export async function keyStatus(evm: Hex) {
  const data = encodeFunctionData({ abi: KS, functionName: 'pqcKeyStatus', args: [evm] });
  const r = await pub.call({ to: KEYS, data });
  const [registered, algoId, , possessionProven] = decodeFunctionResult({ abi: KS, functionName: 'pqcKeyStatus', data: r.data ?? '0x' });
  return { registered, algoId, possessionProven };
}

/** Register the ML-DSA-87 key with proof of possession (classical-signed; the fee comes from the drip). */
export async function registerKey(acct: RecipientAccount): Promise<string> {
  const pop = signProofOfPossession({ chainId: net.chainId, account: acct.cosmos, keypair: acct.pqc });
  const msg = buildRegisterPqcKeyMsg(acct.cosmos, { pqcKeypair: acct.pqc, ecdsaPubkey: hexToBytes(acct.publicKey), proofOfPossession: pop });
  const hash = await cosmosTx(acct, 'classical', [msg], '60000', '400000');
  const st = await keyStatus(acct.evm as Hex);
  if (!(st.registered && st.possessionProven)) throw new Error('Key registered but possession is not proven yet.');
  return hash;
}

export async function windowState(acct: RecipientAccount) {
  try { const w = await evmWindowStatus({ rest: COSMOS_REST, address: acct.cosmos }); return { live: !!w.live, remainingTxs: w.remainingTxs, remainingValue: w.remainingValue }; }
  catch { return { live: false, remainingTxs: 0n, remainingValue: 0n }; }
}
export async function windowLive(acct: RecipientAccount): Promise<boolean> { return (await windowState(acct)).live; }

// The normal flows open no EVM window (20 Nov 2026): every action goes through the relayer, and while a window is live the
// classical key alone can send EVM txs inside its scope. The one exception is "Relay it yourself" (selfRelay.ts), which the
// user starts: a window scoped to the one PocketRouter, about 9 minutes, 3 txs. Inside it the classical key can only call
// the router, and the router only forwards calls whose authority is an ML-DSA-87 signature, so funds still move only on a
// PQ signature.

/** Window status with its scope (allowed targets), for the self-relay reuse check. */
export async function windowScope(acct: RecipientAccount) {
  try { const w = await evmWindowStatus({ rest: COSMOS_REST, address: acct.cosmos }); return { live: !!w.live, remainingTxs: w.remainingTxs, allowedTargets: w.allowedTargets }; }
  catch { return null; }
}

/** Hybrid-signed MsgOpenEVMWindow scoped to `router` only (self-relay). Returns the native tx hash. */
export async function openRouterWindow(acct: RecipientAccount, router: Hex, o: { blocks: number; maxTxs: number; txGasCap: bigint }): Promise<string> {
  const gp = ((await pub.getGasPrice()) * 13n) / 10n;
  const maxValue = evmWindowCost({ gas: o.txGasCap, maxFeePerGas: gp }) * BigInt(o.maxTxs) + 100_000n;
  return cosmosTx(acct, 'hybrid', [openEvmWindowMsg({ sender: acct.cosmos, blocks: o.blocks, maxTxs: o.maxTxs, maxValue, allowedTargets: [router] })], '100000', '800000');
}

/** Link-key signature authorising exactly this (link, recipient, recipient key) binding. */
export function signBind(seed: Uint8Array, linkId: bigint, recipient: Hex, recipientKeyHash: Hex) {
  const lk = mldsa.keygen(seed);
  const sig = mldsa.sign(lk.secretKey, hexToBytes(bindMessage(POCKETDROP_ADDRESS, linkId, recipient, recipientKeyHash)));
  return { linkPk: bytesToHex(lk.publicKey), linkKeyHash: keyHashOf(lk.publicKey), linkSig: bytesToHex(sig) };
}
export function signClaim(acct: RecipientAccount, linkId: bigint): Hex {
  return bytesToHex(mldsa.sign(acct.pqc.secretKey, hexToBytes(claimMessage(POCKETDROP_ADDRESS, linkId, acct.evm as Hex))));
}
export const recipientKeyHash = (acct: RecipientAccount): Hex => keyHashOf(acct.pqc.publicKey);

// Recipient side, all in the browser tab. Mirrors the proven phone spike (spike/page/src/main.ts): keygen, PoP registration
// through the key-less proxy, hybrid scoped EVM window, ML-DSA signing. Lazy-loaded: it pulls the heavy QoreChain SDK.
import { unifiedAccountFromSeed, getNetwork, EthNativeSigner, openEvmWindowMsg, buildRegisterPqcKeyMsg, signProofOfPossession } from '@qorechain/sdk';
import { evmWindowCost, evmWindowStatus } from '@qorechain/evm';
import { mldsa } from '@qorechain/pqc';
import { StargateClient } from '@cosmjs/stargate';
import { decodeFunctionResult, encodeFunctionData, parseAbi, type Hex } from 'viem';
import { COSMOS_REST, COSMOS_RPC, POCKETDROP_ADDRESS, COSMOS_CHAIN_ID } from './config';
import { pub } from './chain';
import { bindMessage, bytesToHex, claimMessage, hexToBytes, keyHashOf } from './protocol';

const net = getNetwork('testnet');
if (net.chainId !== COSMOS_CHAIN_ID) throw new Error('testnet only');
const KEYS = '0x0000000000000000000000000000000000000a02' as const;
const KS = parseAbi(['function pqcKeyStatus(address) view returns (bool, uint8, bytes, bool)']);

export type RecipientAccount = Awaited<ReturnType<typeof unifiedAccountFromSeed>>;

async function sha256(b: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', b as unknown as BufferSource));
}

/** One random 32-byte root per link per browser: secp seed = root, ML-DSA secret = sha256(root | "|mldsa87"). */
export async function deriveRecipient(root: Uint8Array): Promise<RecipientAccount> {
  const tag = new TextEncoder().encode('|mldsa87');
  const pqcSecret = await sha256(new Uint8Array([...root, ...tag]));
  return unifiedAccountFromSeed(root, { pqcSecret });
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

/** Hybrid-signed EVM window scoped to the PocketDrop contract only. `valueUqor` is the value (plus per-tx fees) it may move. */
export async function openScopedWindow(acct: RecipientAccount, o: { maxTxs?: number; blocks?: number; valueUqor?: bigint } = {}): Promise<string> {
  const maxTxs = o.maxTxs ?? 6;
  const gp = ((await pub.getGasPrice()) * 13n) / 10n;
  const perTx = evmWindowCost({ gas: 1_000_000n, maxFeePerGas: gp });
  const maxValue = o.valueUqor !== undefined ? perTx * BigInt(maxTxs) + o.valueUqor : (perTx * 6n) / 2n + 100_000n;
  return cosmosTx(acct, 'hybrid', [openEvmWindowMsg({ sender: acct.cosmos, blocks: o.blocks ?? 6000, maxTxs, maxValue, allowedTargets: [POCKETDROP_ADDRESS] })], '100000', '800000');
}

/** Sender activation: QoreChain requires a registered ML-DSA key AND an open window for every EVM tx. */
export async function activateSender(seed: Uint8Array, balanceWei: bigint, onStep: (s: string) => void): Promise<{ register?: string; window: string }> {
  const acct = await deriveRecipient(seed);
  const out: { register?: string; window: string } = { window: '' };
  const st = await keyStatus(acct.evm as Hex);
  if (!(st.registered && st.possessionProven)) { onStep('Registering your quantum-safe key'); out.register = await registerKey(acct); }
  onStep('Opening your authorisation window');
  // Activation itself costs about 0.16 QOR in fees; everything else in the account may be moved through the window.
  const reserve = 170_000_000_000_000_000n;
  const spendable = balanceWei > reserve ? balanceWei - reserve : 0n;
  out.window = await openScopedWindow(acct, { maxTxs: 30, blocks: 17000, valueUqor: spendable / 10n ** 12n });
  return out;
}
export async function senderWindow(seed: Uint8Array) { return windowState(await deriveRecipient(seed)); }

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

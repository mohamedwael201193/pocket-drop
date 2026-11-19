// Sender side: a browser-created QoreChain account (secp256k1 only; no PQ key is needed to send EVM txs).
import { createWalletClient, encodeFunctionData, http, parseEventLogs, keccak256, type Hex, type Log } from 'viem';
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { dianaChain, EVM_RPC, POCKETDROP_ADDRESS } from './config';
import { pocketDropAbi } from './abi';
import { pub, chainNow, cosmosAddressOf } from './chain';
import { bytesToHex } from './protocol';

const KEY = 'pd.sender.v1';
const LINKS = 'pd.links.v1';

export interface SenderAccount { address: Hex; cosmos: string; account: PrivateKeyAccount }
export interface StoredLink { id: string; seed: string; mode: 'Confirmed' | 'Open'; amountWei: string; createdAt: number; txHash: string }

const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
  del: (k: string) => { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

const toSender = (pk: Hex): SenderAccount => {
  const account = privateKeyToAccount(pk);
  return { address: account.address, cosmos: cosmosAddressOf(account.address), account };
};

export function loadSender(): SenderAccount | null {
  const pk = store.get(KEY);
  return pk && /^0x[0-9a-f]{64}$/i.test(pk) ? toSender(pk as Hex) : null;
}
export function createSender(): SenderAccount { const pk = generatePrivateKey(); store.set(KEY, pk); return toSender(pk); }
export function importSender(pk: string): SenderAccount {
  const k = (pk.trim().startsWith('0x') ? pk.trim() : `0x${pk.trim()}`);
  if (!/^0x[0-9a-f]{64}$/i.test(k)) throw new Error('A backup key is 64 hex characters.');
  store.set(KEY, k);
  return toSender(k as Hex);
}
export const exportSenderKey = (): string | null => store.get(KEY);
export function forgetSender() { store.del(KEY); }

export function loadLinks(): StoredLink[] {
  try { return JSON.parse(store.get(LINKS) || '[]'); } catch { return []; }
}
export function saveLink(l: StoredLink) { store.set(LINKS, JSON.stringify([l, ...loadLinks().filter((x) => x.id !== l.id)])); }

async function send(s: SenderAccount, data: Hex, value: bigint): Promise<{ hash: Hex; blockNumber: bigint; logs: readonly Log[] }> {
  const gasPrice = ((await pub.getGasPrice()) * 13n) / 10n;
  const est = await pub.estimateGas({ account: s.account, to: POCKETDROP_ADDRESS, data, value });
  const gas = (est * 13n) / 10n;
  const bal = await pub.getBalance({ address: s.address });
  if (bal < value + gas * gasPrice) throw new Error('Not enough QOR in the sender account for this amount plus the network fee.');
  const wallet = createWalletClient({ account: s.account, chain: dianaChain, transport: http(EVM_RPC) });
  const hash = await wallet.sendTransaction({ to: POCKETDROP_ADDRESS, data, value, gas, gasPrice, type: 'legacy' });
  const rc = await pub.waitForTransactionReceipt({ hash, timeout: 90_000 });
  if (rc.status !== 'success') throw new Error(`Transaction reverted on-chain (${hash}).`);
  return { hash, blockNumber: rc.blockNumber, logs: rc.logs };
}

export interface CreateParams { mode: 'Confirmed' | 'Open'; amount: bigint; drip: bigint; relayerFee: bigint; ttlSeconds: number }

/** create(): a fresh ML-DSA link key from a random 32-byte seed. Only keccak(pk) goes on-chain; the seed goes in the link #fragment. */
export async function createLink(s: SenderAccount, p: CreateParams): Promise<StoredLink & { seedBytes: Uint8Array }> {
  const { mldsa } = await import('@qorechain/pqc');
  const seedBytes = crypto.getRandomValues(new Uint8Array(32));
  const lk = mldsa.keygen(seedBytes);
  const linkKeyHash = keccak256(bytesToHex(lk.publicKey));
  const expiry = BigInt((await chainNow()) + p.ttlSeconds);
  const data = encodeFunctionData({ abi: pocketDropAbi, functionName: 'create', args: [linkKeyHash, p.mode === 'Confirmed' ? 0 : 1, expiry, p.drip, p.relayerFee] });
  const r = await send(s, data, p.amount + p.drip + p.relayerFee);
  const ev = parseEventLogs({ abi: pocketDropAbi, logs: r.logs as Log[], eventName: 'LinkCreated' })[0] as unknown as { args: { linkId: bigint } } | undefined;
  if (!ev) throw new Error('The link was created but its LinkCreated event was not found.');
  const stored: StoredLink = { id: ev.args.linkId.toString(), seed: bytesToHex(seedBytes).slice(2), mode: p.mode, amountWei: p.amount.toString(), createdAt: Date.now(), txHash: r.hash };
  saveLink(stored);
  return { ...stored, seedBytes };
}

export const confirmRecipient = (s: SenderAccount, linkId: string, expectedKeyHash: Hex) =>
  send(s, encodeFunctionData({ abi: pocketDropAbi, functionName: 'confirmRecipient', args: [BigInt(linkId), expectedKeyHash] }), 0n);
export const cancelLink = (s: SenderAccount, linkId: string) =>
  send(s, encodeFunctionData({ abi: pocketDropAbi, functionName: 'cancel', args: [BigInt(linkId)] }), 0n);
export const refundLink = (s: SenderAccount, linkId: string) =>
  send(s, encodeFunctionData({ abi: pocketDropAbi, functionName: 'refund', args: [BigInt(linkId)] }), 0n);

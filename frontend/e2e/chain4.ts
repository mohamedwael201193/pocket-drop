// Operator side of the v4 deployed E2E (Diana TESTNET only): fund test accounts from the deployer, pre-register guardian keys,
// verify hashes on the chain. Secrets are read in-process from D:/route/QORE/.secrets and are never printed or written to the repo.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createPublicClient, decodeFunctionResult, encodeFunctionData, formatEther, http, parseAbi, defineChain, type Hex } from 'viem';
import { dropAbi, poolAbi, vaultAbi } from '../src/lib/abi4';

process.env.SPEND_FILE ??= '../evidence/v4/spend.json';
process.env.SPEND_CAP_QOR ??= '8';
type Chain = {
  fundFromDeployer: (to: string, qor: number | string, note?: string) => Promise<string>;
  recordRecovered: (qor: number | string, note: string, hash: string) => number;
  spent: () => { totalQor: number; entries: unknown[] };
  loadDeployer: () => Promise<{ evm: string }>;
  unifiedAccountFromSeed: (seed: Uint8Array, o: { pqcSecret: Uint8Array }) => Promise<{ evm: string; cosmos: string; privateKey: Hex; publicKey: string; pqc: unknown }>;
};
let mod: Promise<Chain> | null = null;
const chainMod = () => (mod ??= import(/* @vite-ignore */ pathToFileURL(path.resolve('scripts/chain.mjs')).href) as Promise<Chain>);

export const REST = 'https://api-testnet.qore.host';
export const chain = defineChain({ id: 9800, name: 'diana', nativeCurrency: { name: 'QOR', symbol: 'QOR', decimals: 18 }, rpcUrls: { default: { http: ['https://evm-testnet.qore.host'] } } });
export const pub = createPublicClient({ chain, transport: http() });
const v4 = JSON.parse(fs.readFileSync(path.resolve('src/data/v4.json'), 'utf8')) as { instances: Record<'prod' | 'lab', Record<string, { address: string }>> };
export const INST = v4.instances;

export const fund = async (to: string, qor: number, note: string) => (await chainMod()).fundFromDeployer(to, qor, note);
export const deployerAddress = async () => (await (await chainMod()).loadDeployer()).evm as Hex;
export const recovered = async (qor: string, note: string, hash: string) => (await chainMod()).recordRecovered(qor, note, hash);
export const spentQor = async () => (await chainMod()).spent().totalQor;

/** A hash is OK when it is a mined, successful EVM tx (0x…) or a Cosmos tx with code 0 (bare hex). */
export async function txOk(hash: string): Promise<boolean> {
  if (/^0x[0-9a-fA-F]{64}$/.test(hash)) return (await pub.getTransactionReceipt({ hash: hash as Hex })).status === 'success';
  for (let i = 0; i < 10; i++) {
    const r = await fetch(`${REST}/cosmos/tx/v1beta1/txs/${hash}`);
    if (r.ok) return (await r.json()).tx_response?.code === 0;
    await new Promise((x) => setTimeout(x, 2000));
  }
  return false;
}

const KS = parseAbi(['function pqcKeyStatus(address) view returns (bool, uint8, bytes, bool)']);
export async function keyProven(addr: Hex): Promise<boolean> {
  const r = await pub.call({ to: '0x0000000000000000000000000000000000000a02', data: encodeFunctionData({ abi: KS, functionName: 'pqcKeyStatus', args: [addr] }) });
  return decodeFunctionResult({ abi: KS, functionName: 'pqcKeyStatus', data: r.data ?? '0x' })[3];
}

export const dropLink = (env: 'prod' | 'lab', id: bigint) => pub.readContract({ address: INST[env].drop.address as Hex, abi: dropAbi, functionName: 'getLink', args: [id] }) as Promise<{ state: number; payTo: Hex; recipient: Hex; sender: Hex; amount: bigint; relayerFee: bigint; dripPaid: boolean }>;
export const poolOf = (env: 'prod' | 'lab', id: bigint) => pub.readContract({ address: INST[env].pool.address as Hex, abi: poolAbi, functionName: 'getPool', args: [id] }) as Promise<{ taken: number; slots: number; perSlot: bigint }>;
export const vaultRead = <T>(vault: Hex, fn: string) => pub.readContract({ address: vault, abi: vaultAbi, functionName: fn } as never) as Promise<T>;
export const balanceOf = (a: string) => pub.getBalance({ address: a as Hex });
export const qor = (wei: bigint) => formatEther(wei);

/* ---- guardian identities: app-compatible roots (secp seed = root, ML-DSA secret = sha256(root | "|mldsa87")), registered once, reused ---- */
const G_FILE = process.env.E2E_GUARDIANS_FILE ?? 'D:/route/QORE/.secrets/pd-e2e-guardians.json';
export interface Guardian { root: string; evm: Hex }

async function register(acct: Awaited<ReturnType<Chain['unifiedAccountFromSeed']>>): Promise<void> {
  const sdk = await import('@qorechain/sdk');
  const { StargateClient } = await import('@cosmjs/stargate');
  const net = sdk.getNetwork('testnet');
  const pop = sdk.signProofOfPossession({ chainId: net.chainId, account: acct.cosmos, keypair: acct.pqc as never });
  const msg = sdk.buildRegisterPqcKeyMsg(acct.cosmos, { pqcKeypair: acct.pqc as never, ecdsaPubkey: Uint8Array.from(Buffer.from(acct.publicKey.slice(2), 'hex')), proofOfPossession: pop });
  const r = await fetch(`${REST}/cosmos/auth/v1beta1/accounts/${acct.cosmos}`).then((x) => x.json());
  const a = r.account?.base_account ?? r.account ?? {};
  const signer = new sdk.EthNativeSigner(acct as never, { signMode: 'classical', rest: REST });
  const c = await StargateClient.connect(net.endpoints.rpc);
  try {
    const res = await signer.signAndBroadcast(c, { chainId: net.chainId, accountNumber: BigInt(a.account_number ?? 0), sequence: BigInt(a.sequence ?? 0), fee: { amount: [{ denom: 'uqor', amount: '60000' }], gas: '400000' }, messages: [msg] } as never);
    if (res.code !== 0) throw new Error(`guardian registration failed (code ${res.code})`);
  } finally { c.disconnect(); }
}

export async function guardians(n = 3): Promise<Guardian[]> {
  let list: Guardian[] = [];
  try { list = JSON.parse(fs.readFileSync(G_FILE, 'utf8')); } catch { /* first run */ }
  const m = await chainMod();
  while (list.length < n) { list.push({ root: crypto.randomBytes(32).toString('hex'), evm: '0x' as Hex }); }
  for (const g of list) {
    const root = Buffer.from(g.root, 'hex');
    const pqcSecret = crypto.createHash('sha256').update(Buffer.concat([root, Buffer.from('|mldsa87')])).digest();
    const acct = await m.unifiedAccountFromSeed(Uint8Array.from(root), { pqcSecret: Uint8Array.from(pqcSecret) });
    g.evm = acct.evm as Hex;
    fs.mkdirSync(path.dirname(G_FILE), { recursive: true });
    fs.writeFileSync(G_FILE, JSON.stringify(list, null, 1));
    if (await keyProven(g.evm)) continue;
    if ((await balanceOf(g.evm)) < 80_000_000_000_000_000n) await fund(g.evm, 0.075, `guardian ${g.evm.slice(0, 8)} registration fee`);
    await register(acct);
    for (let i = 0; i < 10 && !(await keyProven(g.evm)); i++) await new Promise((x) => setTimeout(x, 2000));
    if (!(await keyProven(g.evm))) throw new Error('guardian key not proven after registration');
  }
  return list.slice(0, n);
}

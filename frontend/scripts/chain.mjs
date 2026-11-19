// Test-operator helpers (Diana TESTNET only). Reads the deployer secret in-process from D:/route/QORE/.secrets and never prints it.
import fs from 'node:fs';
import { createPublicClient, createWalletClient, http, defineChain, formatEther, parseEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { unifiedAccountFromSeed, getNetwork, EthNativeSigner, openEvmWindowMsg } from '@qorechain/sdk';
import { evmWindowCost, evmWindowStatus } from '@qorechain/evm';
import { StargateClient } from '@cosmjs/stargate';

export const net = getNetwork('testnet');
if (net.chainId !== 'qorechain-diana') throw new Error('testnet only');
export const SECRET_FILE = process.env.DEPLOYER_SECRET_FILE || 'D:/route/QORE/.secrets/pocketdrop-deployer.json';
export const chain = defineChain({ id: 9800, name: 'diana', nativeCurrency: { name: 'QOR', symbol: 'QOR', decimals: 18 }, rpcUrls: { default: { http: [net.endpoints.evmRpc] } } });
export const pub = createPublicClient({ chain, transport: http() });
export const SPEND_FILE = new URL('../evidence/spend.json', import.meta.url);
export const SPEND_CAP_QOR = 15;

export async function loadDeployer() {
  const j = JSON.parse(fs.readFileSync(SECRET_FILE, 'utf8')).deployer;
  const acc = await unifiedAccountFromSeed(Uint8Array.from(Buffer.from(j.secp256k1PrivateKey.slice(2), 'hex')), { pqcSecret: Uint8Array.from(Buffer.from(j.pqcSecret, 'hex')) });
  return acc;
}
export const gasPrice = async () => ((await pub.getGasPrice()) * 13n) / 10n;

export function spent() {
  try { return JSON.parse(fs.readFileSync(SPEND_FILE, 'utf8')); } catch { return { totalQor: 0, entries: [] }; }
}
export function recordSpend(qor, note, hash) {
  const s = spent();
  s.totalQor = Number((s.totalQor + Number(qor)).toFixed(6));
  s.entries.push({ qor: Number(qor), note, hash, at: new Date().toISOString() });
  fs.writeFileSync(SPEND_FILE, JSON.stringify(s, null, 1));
  return s.totalQor;
}

async function ensureWindow(acc) {
  const w = await evmWindowStatus({ rest: net.endpoints.rest, address: acc.cosmos });
  if (w.live && w.remainingTxs > 10n) return;
  const gp = await gasPrice();
  const maxValue = evmWindowCost({ gas: 1_500_000n, maxFeePerGas: gp }) * 80n + 8_000_000n;
  const r = await fetch(`${net.endpoints.rest}/cosmos/auth/v1beta1/accounts/${acc.cosmos}`).then((x) => x.json());
  const a = r.account?.base_account ?? r.account;
  const signer = new EthNativeSigner(acc, { signMode: 'hybrid', rest: net.endpoints.rest });
  const c = await StargateClient.connect(net.endpoints.rpc);
  try {
    const res = await signer.signAndBroadcast(c, { chainId: net.chainId, accountNumber: BigInt(a.account_number), sequence: BigInt(a.sequence), fee: { amount: [{ denom: 'uqor', amount: '100000' }], gas: '800000' }, messages: [openEvmWindowMsg({ sender: acc.cosmos, blocks: 17000, maxTxs: 80, maxValue })] });
    if (res.code !== 0) throw new Error('open window failed ' + res.code);
  } finally { c.disconnect(); }
}

/** Send `qor` from the deployer to `to` (EVM address). Enforces the 15 QOR total spend cap. Returns the tx hash. */
export async function fundFromDeployer(to, qor, note = 'fund') {
  if (spent().totalQor + Number(qor) > SPEND_CAP_QOR) throw new Error(`spend cap ${SPEND_CAP_QOR} QOR would be exceeded`);
  const acc = await loadDeployer();
  await ensureWindow(acc);
  const wallet = createWalletClient({ account: privateKeyToAccount(acc.privateKey), chain, transport: http() });
  const hash = await wallet.sendTransaction({ to, value: parseEther(String(qor)), gas: 40000n, type: 'legacy', gasPrice: await gasPrice() });
  const rc = await pub.waitForTransactionReceipt({ hash, timeout: 90_000 });
  if (rc.status !== 'success') throw new Error('fund tx reverted ' + hash);
  recordSpend(qor, note, hash);
  return hash;
}
export { formatEther, parseEther, unifiedAccountFromSeed };

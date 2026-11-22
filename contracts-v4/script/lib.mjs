// Shared helpers for deploy + live suite. QoreChain Diana TESTNET ONLY. Secrets are read from D:/route/QORE/.env and
// D:/route/QORE/.secrets/ and are never printed, logged or written anywhere else.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { StargateClient } from '@cosmjs/stargate';
import {
  EthNativeSigner, getNetwork, buildRegisterPqcKeyMsg, signProofOfPossession, openEvmWindowMsg,
  unifiedAccountFromSeed, deriveUnifiedAccount, bank,
} from '@qorechain/sdk';
import { evmWindowCost, evmWindowStatus } from '@qorechain/evm';
import {
  createPublicClient, createWalletClient, http, defineChain, parseEventLogs, decodeFunctionResult, encodeFunctionData,
  parseAbi, formatEther, keccak256, toHex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..'); // pocketdrop/contracts
export const SECRET_FILE = 'D:/route/QORE/.secrets/pocketdrop-deployer.json';
export const ENV_FILE = process.env.QORE_ENV_FILE || 'D:/route/QORE/.env';
export const DEPLOYMENTS = path.join(ROOT, 'deployments', 'diana.json');
export const EXPL = 'https://explore.qore.network/tx/';

export const net = getNetwork('testnet');
if (net.chainId !== 'qorechain-diana') throw new Error('testnet only');
export const REST = net.endpoints.rest;
export const chain = defineChain({
  id: 9800, name: 'diana', nativeCurrency: { name: 'QOR', symbol: 'QOR', decimals: 18 },
  rpcUrls: { default: { http: [net.endpoints.evmRpc] } },
});
export const pub = createPublicClient({ chain, transport: http() });
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const qor = (wei) => formatEther(wei);
export const PQC_VERIFY = '0x0000000000000000000000000000000000000a01';
export const PQC_KEYS = '0x0000000000000000000000000000000000000a02';
const KS = parseAbi(['function pqcKeyStatus(address) view returns (bool,uint8,bytes,bool)']);

/* ---------------- secrets ---------------- */

export function mnemonic() {
  const t = fs.readFileSync(ENV_FILE, 'utf8');
  const m = t.match(/^\s*seed\s*=\s*["']?([^"'\r\n]+?)["']?\s*$/mi);
  return m[1].trim().split(/\s+/).join(' ');
}
export const loadMain = () => deriveUnifiedAccount(mnemonic(), 0); // eth_secp256k1 m/44'/60'/0'/0/0 + canonical ML-DSA-87

const hex = (u) => Buffer.from(u).toString('hex');
export function readSecrets() {
  return fs.existsSync(SECRET_FILE) ? JSON.parse(fs.readFileSync(SECRET_FILE, 'utf8')) : null;
}
export function writeSecrets(j) {
  fs.mkdirSync(path.dirname(SECRET_FILE), { recursive: true });
  fs.writeFileSync(SECRET_FILE, JSON.stringify(j, null, 1));
}
export async function accountFrom(j) {
  return unifiedAccountFromSeed(Uint8Array.from(Buffer.from(j.secp256k1PrivateKey.slice(2), 'hex')), {
    pqcSecret: Uint8Array.from(Buffer.from(j.pqcSecret, 'hex')),
  });
}
/** Create a fresh account from random seeds (secp + ML-DSA-87); returns {acc, record} where record holds the secrets. */
export async function newAccountRecord(role) {
  const seed = crypto.randomBytes(32);
  const pqcSecret = crypto.randomBytes(32);
  const acc = await unifiedAccountFromSeed(Uint8Array.from(seed), { pqcSecret: Uint8Array.from(pqcSecret) });
  return {
    acc,
    record: {
      role, evm: acc.evm, cosmos: acc.cosmos, secp256k1PrivateKey: '0x' + hex(seed), pqcSecret: hex(pqcSecret),
      createdAt: new Date().toISOString(),
    },
  };
}
export async function loadDeployer() {
  const j = readSecrets();
  if (!j?.deployer) throw new Error('no deployer in secrets file; run: node script/setup-deployer.mjs');
  return accountFrom(j.deployer);
}

/* ---------------- chain reads ---------------- */

export async function seqOf(addr) {
  const r = await fetch(`${REST}/cosmos/auth/v1beta1/accounts/${addr}`);
  if (!r.ok) return { accountNumber: 0n, sequence: 0n, exists: false };
  const j = await r.json();
  const a = j.account?.base_account ?? j.account ?? {};
  return { accountNumber: BigInt(a.account_number ?? 0), sequence: BigInt(a.sequence ?? 0), exists: true };
}
export async function bankUqor(addr) {
  const j = await (await fetch(`${REST}/cosmos/bank/v1beta1/balances/${addr}`)).json();
  return BigInt((j.balances ?? []).find((b) => b.denom === 'uqor')?.amount ?? '0');
}
export async function keyStatus(evmAddr) {
  const r = await pub.call({ to: PQC_KEYS, data: encodeFunctionData({ abi: KS, functionName: 'pqcKeyStatus', args: [evmAddr] }) });
  const [registered, algoId, pk, possessionProven] = decodeFunctionResult({ abi: KS, functionName: 'pqcKeyStatus', data: r.data });
  return { registered, algoId, pubkey: pk, possessionProven };
}
export const gasPrice = async () => ((await pub.getGasPrice()) * 13n) / 10n;

/* ---------------- native-lane txs ---------------- */

export async function cosmosTx(acc, mode, messages, { gas = '800000', fee = '100000' } = {}) {
  const s = await seqOf(acc.cosmos);
  const signer = new EthNativeSigner(acc, { signMode: mode, rest: REST });
  const c = await StargateClient.connect(net.endpoints.rpc);
  try {
    return await signer.signAndBroadcast(c, {
      chainId: net.chainId, accountNumber: s.accountNumber, sequence: s.sequence,
      fee: { amount: [{ denom: 'uqor', amount: fee }], gas }, messages,
    });
  } finally { c.disconnect(); }
}

/** Fund `toCosmos` with `uqor` from `from` (hybrid-signed MsgSend). */
export async function fundFromMain(main, toCosmos, uqor) {
  const msg = bank.send({ fromAddress: main.cosmos, toAddress: toCosmos, amount: [{ denom: 'uqor', amount: String(uqor) }] });
  const r = await cosmosTx(main, 'hybrid', [msg]);
  if (r.code !== 0) throw new Error('fund failed code ' + r.code);
  return r.transactionHash;
}

/** Register the account's ML-DSA-87 key with proof of possession (classical-signed). No-op if already registered. */
export async function registerWithPoP(acc, { gas = '400000', fee = '60000' } = {}) {
  const st = await keyStatus(acc.evm).catch(() => ({ registered: false }));
  if (st.registered) return { skipped: true, possessionProven: st.possessionProven };
  const pop = signProofOfPossession({ chainId: net.chainId, account: acc.cosmos, keypair: acc.pqc });
  const msg = buildRegisterPqcKeyMsg(acc.cosmos, {
    pqcKeypair: acc.pqc, ecdsaPubkey: Uint8Array.from(Buffer.from(acc.publicKey.slice(2), 'hex')), proofOfPossession: pop,
  });
  const r = await cosmosTx(acc, 'classical', [msg], { gas, fee });
  if (r.code !== 0) throw new Error('register failed code ' + r.code);
  return { skipped: false, hash: r.transactionHash };
}

/** Open (hybrid-signed) an unscoped EVM window sized for `maxTxs` txs of up to `gasCap` gas plus `valueUqor` of value. */
export async function openWindow(acc, { maxTxs = 80, blocks = 17000, gasCap = 1_500_000n, valueUqor = 0n } = {}) {
  const gp = await gasPrice();
  const perTx = evmWindowCost({ gas: gasCap, maxFeePerGas: gp });
  const maxValue = perTx * BigInt(maxTxs) + BigInt(valueUqor);
  const r = await cosmosTx(acc, 'hybrid', [openEvmWindowMsg({ sender: acc.cosmos, blocks, maxTxs, maxValue })], { gas: '800000', fee: '100000' });
  if (r.code !== 0) throw new Error('open window failed code ' + r.code);
  return { hash: r.transactionHash, maxValue };
}
export const windowOf = (acc) => evmWindowStatus({ rest: REST, address: acc.cosmos });

/* ---------------- EVM txs ---------------- */

export class Evm {
  constructor(acc) {
    this.acc = acc;
    this.account = privateKeyToAccount(acc.privateKey);
    this.wallet = createWalletClient({ account: this.account, chain, transport: http() });
    this.address = this.account.address;
  }
  /** Send a legacy tx with an explicit gas limit; wait for the receipt. */
  async send({ to, data, value = 0n, gas }) {
    const gp = await gasPrice();
    const hash = await this.wallet.sendTransaction({ to, data, value, gas, type: 'legacy', gasPrice: gp });
    const receipt = await pub.waitForTransactionReceipt({ hash, timeout: 90_000 });
    return { hash, receipt };
  }
  async deploy({ bytecode, args = '0x', gas }) {
    const gp = await gasPrice();
    const hash = await this.wallet.sendTransaction({ data: bytecode + args.replace(/^0x/, ''), gas, type: 'legacy', gasPrice: gp });
    const receipt = await pub.waitForTransactionReceipt({ hash, timeout: 90_000 });
    return { hash, receipt };
  }
}

export const sel = (name) => keccak256(toHex(name)).slice(0, 10);

/** Load a forge-built artifact (same bytecode the tests ran against): artifact('PocketVault') */
export function artifact(name) {
  const p = path.join(ROOT, 'out', `${name}.sol`, `${name}.json`);
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  return { name, abi: j.abi, bytecode: j.bytecode.object, deployedBytecode: j.deployedBytecode.object, immutableReferences: j.deployedBytecode.immutableReferences ?? {} };
}

/* ---------------- deployments record ---------------- */

export function readDeployments() {
  return fs.existsSync(DEPLOYMENTS) ? JSON.parse(fs.readFileSync(DEPLOYMENTS, 'utf8')) : {};
}
export function writeDeployments(j) {
  fs.mkdirSync(path.dirname(DEPLOYMENTS), { recursive: true });
  fs.writeFileSync(DEPLOYMENTS, JSON.stringify(j, (k, v) => (typeof v === 'bigint' ? v.toString() : v), 2));
}
export { parseEventLogs };

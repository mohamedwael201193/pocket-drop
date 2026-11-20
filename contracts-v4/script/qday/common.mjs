// Q-Day drill helpers. Diana TESTNET ONLY (EVM 9800, qorechain-diana). No secret is ever printed or written outside
// QORE_DIR/.secrets. Every function here is usable by a judge from a fresh clone (npm ci in contracts-v4).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { EthNativeSigner, getNetwork, unifiedAccountFromSeed } from '@qorechain/sdk';
import { StargateClient } from '@cosmjs/stargate';
import { createPublicClient, http, defineChain, parseAbi, encodeFunctionData, decodeFunctionResult, keccak256, toHex } from 'viem';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const C4 = path.resolve(HERE, '..', '..');
export const QORE_DIR = process.env.QORE_DIR ?? 'D:/route/QORE';
export const SECRETS_DIR = path.join(QORE_DIR, '.secrets');
export const API = process.env.PD_API_URL ?? 'https://pocketdrop-api.vercel.app';
export const net = getNetwork('testnet');
if (net.chainId !== 'qorechain-diana') throw new Error('testnet only');
export const REST = net.endpoints.rest;
export const COMET = process.env.COMET_RPC ?? net.endpoints.rpc;
export const EVM_RPC = process.env.EVM_RPC ?? 'https://evm-testnet.qore.host';
export const chain = defineChain({ id: 9800, name: 'diana', nativeCurrency: { name: 'QOR', symbol: 'QOR', decimals: 18 }, rpcUrls: { default: { http: [EVM_RPC] } } });
export const pub = createPublicClient({ chain, transport: http() });
export const EXPL = 'https://explore.qore.network/tx/';
export const hexb = (h) => Uint8Array.from(Buffer.from(String(h).replace(/^0x/, ''), 'hex'));
export const rand32 = () => crypto.randomBytes(32).toString('hex');
export const sha256 = (b) => new Uint8Array(crypto.createHash('sha256').update(b).digest());

const deployments = JSON.parse(fs.readFileSync(path.join(C4, 'deployments', 'diana.json'), 'utf8'));
export const PROD = deployments.v4.prod;
export const art = (n) => JSON.parse(fs.readFileSync(path.join(C4, 'out', `${n}.sol`, `${n}.json`), 'utf8')).abi;
export const ABI = { vault: art('PocketVault'), factory: art('PocketFactory'), drop: art('PocketDrop'), router: art('PocketRouter') };
export const LIB_ERRORS = parseAbi(['error KeyUnavailable()', 'error NotRegistered()', 'error UnsupportedAlgo()', 'error PossessionNotProven()', 'error KeyMismatch()']);
export const ALL_ERRORS = [...ABI.vault, ...ABI.router, ...ABI.drop, ...ABI.factory, ...LIB_ERRORS];

/** An account whose ML-DSA-87 secret is independent random entropy (the fixed derivation). */
export const accountOf = (rec) => unifiedAccountFromSeed(hexb(rec.secp), { pqcSecret: hexb(rec.pq) });
/** The attacker's view: the victim's classical secp256k1 key plus the ATTACKER's own ML-DSA key. */
export const attackerView = (classicalKeyHex, attackerPqHex = rand32()) => unifiedAccountFromSeed(hexb(classicalKeyHex), { pqcSecret: hexb(attackerPqHex) });

const KS = parseAbi(['function pqcKeyStatus(address) view returns (bool,uint8,bytes,bool)']);
export async function keyStatus(evm) {
  const r = await pub.call({ to: '0x0000000000000000000000000000000000000a02', data: encodeFunctionData({ abi: KS, functionName: 'pqcKeyStatus', args: [evm] }) });
  const [registered, algoId, pk, possessionProven] = decodeFunctionResult({ abi: KS, functionName: 'pqcKeyStatus', data: r.data });
  return { registered, algoId, pubkey: pk, possessionProven, keyHash: pk && pk !== '0x' ? keccak256(pk) : null };
}
export async function windowStatus(cosmos) {
  const r = await fetch(`${REST}/qorechain/pqc/v1/evm_window/${cosmos}`).catch(() => null);
  if (!r || !r.ok) { const { evmWindowStatus } = await import('@qorechain/evm'); return evmWindowStatus({ rest: REST, address: cosmos }); }
  return r.json();
}
export async function seqOf(addr) {
  const r = await fetch(`${REST}/cosmos/auth/v1beta1/accounts/${addr}`);
  if (!r.ok) return { accountNumber: 0n, sequence: 0n };
  const j = await r.json(); const a = j.account?.base_account ?? j.account ?? {};
  return { accountNumber: BigInt(a.account_number ?? 0), sequence: BigInt(a.sequence ?? 0) };
}

/** Sign a native tx. mode 'check' runs CometBFT check_tx only (read-only, nothing is broadcast); 'broadcast' sends it.
 *  Never throws: returns { hash, code, log, included }. The hash is sha256 of the signed tx bytes. */
export async function nativeTx(acc, signMode, messages, { gas = '400000', fee = '60000', mode = 'check' } = {}) {
  const s = await seqOf(acc.cosmos);
  const signer = new EthNativeSigner(acc, { signMode, rest: REST });
  const params = { chainId: net.chainId, accountNumber: s.accountNumber, sequence: s.sequence, fee: { amount: [{ denom: 'uqor', amount: fee }], gas }, messages };
  if (signMode === 'hybrid') params.signBytesVersion = await signer.resolveSignBytesVersion(net.chainId);
  let signed;
  try { signed = signer.sign(params); } catch (e) { return { hash: null, code: 'sign-error', log: String(e.message).slice(0, 300), included: false }; }
  const hash = Buffer.from(sha256(signed.txRawBytes)).toString('hex').toUpperCase();
  if (mode === 'check') {
    const j = await (await fetch(COMET, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'check_tx', params: { tx: Buffer.from(signed.txRawBytes).toString('base64') } }) })).json();
    const r = j.result ?? {};
    return { hash, code: r.code ?? 'rpc-error', log: String(r.log ?? j.error?.message ?? '').slice(0, 400), included: false, mode: 'check_tx (read-only)' };
  }
  const c = await StargateClient.connect(COMET);
  try { const r = await c.broadcastTx(signed.txRawBytes, 60_000, 1000); return { hash: r.transactionHash, code: r.code, log: (r.rawLog || '').slice(0, 400), included: true, height: r.height }; }
  catch (e) { return { hash, code: e.code ?? 'checktx-reject', log: String(e.log ?? e.message).slice(0, 400), included: false }; }
  finally { c.disconnect(); }
}

export function readJson(f, d) { return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : d; }
export function writeSecret(f, j) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(j, null, 1), { mode: 0o600 }); fs.chmodSync(f, 0o600); }
export const big = (k, v) => (typeof v === 'bigint' ? v.toString() : v);

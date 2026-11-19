// Shared helpers for local operator scripts (testnet only). Never prints secrets.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StargateClient } from '@cosmjs/stargate';
import { EthNativeSigner, getNetwork, unifiedAccountFromSeed } from '@qorechain/sdk';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const SECRET_FILE = process.env.RELAYER_SECRET_FILE ?? path.join(ROOT, '.secrets', 'pocketdrop-relayer.json');
export const DEPLOYMENT_FILE = path.join(ROOT, 'pocketdrop', 'contracts', 'deployments', 'diana.json');
export const EXPL = 'https://explore.qore.network/tx/';
export const net = getNetwork('testnet');
if (net.chainId !== 'qorechain-diana') throw new Error('testnet only');
export const REST = net.endpoints.rest;
export const hex = (u) => Buffer.from(u).toString('hex');
export const unhex = (s) => Uint8Array.from(Buffer.from(s.replace(/^0x/, ''), 'hex'));

export async function loadRelayer() {
  // CI path: RELAYER_SECP_KEY + RELAYER_PQC_SEED come from encrypted GitHub Actions secrets (never logged).
  if (process.env.RELAYER_SECP_KEY && process.env.RELAYER_PQC_SEED) {
    return unifiedAccountFromSeed(unhex(process.env.RELAYER_SECP_KEY.trim()), { pqcSecret: unhex(process.env.RELAYER_PQC_SEED.trim()) });
  }
  const j = JSON.parse(fs.readFileSync(SECRET_FILE, 'utf8'));
  return unifiedAccountFromSeed(unhex(j.secp256k1PrivateKey), { pqcSecret: unhex(j.pqcSecret) });
}
export function contractAddress() {
  if (process.env.POCKETDROP_ADDRESS) return process.env.POCKETDROP_ADDRESS;
  if (fs.existsSync(DEPLOYMENT_FILE)) {
    const d = JSON.parse(fs.readFileSync(DEPLOYMENT_FILE, 'utf8'));
    return d.contracts?.main?.address ?? d.address ?? d.PocketDrop ?? d.pocketDrop ?? d.contract ?? null;
  }
  return null;
}
export async function seqOf(addr) {
  const r = await fetch(`${REST}/cosmos/auth/v1beta1/accounts/${addr}`);
  if (!r.ok) return { accountNumber: 0n, sequence: 0n };
  const j = await r.json();
  const a = j.account?.base_account ?? j.account ?? {};
  return { accountNumber: BigInt(a.account_number ?? 0), sequence: BigInt(a.sequence ?? 0) };
}
export async function bankUqor(addr) {
  const j = await (await fetch(`${REST}/cosmos/bank/v1beta1/balances/${addr}`)).json();
  return BigInt((j.balances ?? []).find((b) => b.denom === 'uqor')?.amount ?? '0');
}
export async function cosmosTx(acc, mode, messages, { gas = '800000', fee = '100000' } = {}) {
  const s = await seqOf(acc.cosmos);
  const signer = new EthNativeSigner(acc, { signMode: mode, rest: REST });
  const c = await StargateClient.connect(net.endpoints.rpc);
  try {
    return await signer.signAndBroadcast(c, { chainId: net.chainId, accountNumber: s.accountNumber, sequence: s.sequence, fee: { amount: [{ denom: 'uqor', amount: fee }], gas }, messages });
  } finally { c.disconnect(); }
}

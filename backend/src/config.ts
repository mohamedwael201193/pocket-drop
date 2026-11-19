import type { Hex } from 'viem';

export const NETWORK = 'diana-testnet' as const;
export const EVM_CHAIN_ID = 9800;
export const COSMOS_CHAIN_ID = 'qorechain-diana';
export const EXPLORER_TX = 'https://explore.qore.network/tx/';
export const PQC_VERIFY_ADDRESS = '0x0000000000000000000000000000000000000A01';
export const PQC_KEYSTATUS_ADDRESS = '0x0000000000000000000000000000000000000A02';

/** ML-DSA-87 public key and signature sizes in bytes. */
export const PK_BYTES = 2592;
export const SIG_BYTES = 4627;

export interface Config {
  evmRpc: string;
  rest: string;
  contract: Hex | null;
  relayerKey: Hex | null;
  /** First block to index for /api/stats (default: lookback from head). */
  deployBlock: bigint | null;
  statsLookback: bigint;
  gasBind: bigint;
  gasClaim: bigint;
  upstashUrl: string | null;
  upstashToken: string | null;
}

type Env = Record<string, string | undefined>;

const hexKey = (v: string | undefined): Hex | null => {
  if (!v) return null;
  const t = v.trim();
  const k = (t.startsWith('0x') ? t : `0x${t}`) as Hex;
  return /^0x[0-9a-fA-F]{64}$/.test(k) ? k : null;
};

const num = (v: string | undefined, d: bigint): bigint => {
  if (!v || !/^\d+$/.test(v.trim())) return d;
  return BigInt(v.trim());
};

export function getConfig(env: Env = process.env): Config {
  const contract = env.POCKETDROP_ADDRESS?.trim();
  return {
    evmRpc: env.EVM_RPC_URL?.trim() || 'https://evm-testnet.qore.host',
    rest: env.REST_URL?.trim() || 'https://api-testnet.qore.host',
    contract: contract && /^0x[0-9a-fA-F]{40}$/.test(contract) ? (contract as Hex) : null,
    relayerKey: hexKey(env.RELAYER_SECP_KEY),
    deployBlock: env.POCKETDROP_DEPLOY_BLOCK && /^\d+$/.test(env.POCKETDROP_DEPLOY_BLOCK.trim()) ? BigInt(env.POCKETDROP_DEPLOY_BLOCK.trim()) : null,
    statsLookback: num(env.STATS_LOOKBACK_BLOCKS, 150_000n),
    gasBind: num(env.GAS_BIND, 900_000n),
    gasClaim: num(env.GAS_CLAIM, 800_000n),
    upstashUrl: env.UPSTASH_REDIS_REST_URL?.trim() || null,
    upstashToken: env.UPSTASH_REDIS_REST_TOKEN?.trim() || null,
  };
}

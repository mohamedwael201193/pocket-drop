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
  /** The relayer's ML-DSA-87 seed (32 bytes hex). With it, relays go out as hybrid-signed MsgCrossVMCall (no EVM window). */
  relayerPqc: Hex | null;
  /** Isolated ML-DSA-87 signer (a separate function that holds only the PQ seed): URL and the shared HMAC key. When set,
   *  relays are signed in two halves (secp256k1 here, ML-DSA-87 there) and this API never needs RELAYER_PQC_SEED. */
  pqSignerUrl: string | null;
  pqSignerHmac: string | null;
  /** 'hybrid' (default when relayerPqc or the isolated signer is set) or 'evm' (ECDSA-only EVM tx inside the relayer's EVM window). */
  relayMode: 'hybrid' | 'evm';
  /** Fall back to the EVM window when a hybrid tx cannot be signed or is refused before it executes (default on; RELAY_FALLBACK=none
   *  turns it off). With the window closed the fallback is refused by the chain, so it can never add a classical-only path. */
  relayFallback: boolean;
  /** First block to index for /api/stats (default: lookback from head). */
  deployBlock: bigint | null;
  statsLookback: bigint;
  gasBind: bigint;
  gasClaim: bigint;
  /** /api/route gas: floor, cap, and the multiplier (percent) applied to eth_estimateGas. */
  gasRouteMin: bigint;
  gasRouteMax: bigint;
  gasRoutePct: bigint;
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

const pqUrl = (v: string | undefined): string | null => (v && /^https:\/\/[^\s]+$/.test(v.trim()) ? v.trim().replace(/\/$/, '') : null);

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
    relayerPqc: hexKey(env.RELAYER_PQC_SEED),
    pqSignerUrl: pqUrl(env.PQ_SIGNER_URL),
    pqSignerHmac: env.PQ_SIGNER_HMAC && env.PQ_SIGNER_HMAC.trim().length >= 32 ? env.PQ_SIGNER_HMAC.trim() : null,
    relayMode: env.RELAY_MODE?.trim().toLowerCase() === 'evm' || !(hexKey(env.RELAYER_PQC_SEED) || (pqUrl(env.PQ_SIGNER_URL) && (env.PQ_SIGNER_HMAC?.trim().length ?? 0) >= 32)) ? 'evm' : 'hybrid',
    relayFallback: env.RELAY_FALLBACK?.trim().toLowerCase() !== 'none',
    deployBlock: env.POCKETDROP_DEPLOY_BLOCK && /^\d+$/.test(env.POCKETDROP_DEPLOY_BLOCK.trim()) ? BigInt(env.POCKETDROP_DEPLOY_BLOCK.trim()) : null,
    statsLookback: num(env.STATS_LOOKBACK_BLOCKS, 150_000n),
    gasBind: num(env.GAS_BIND, 900_000n),
    gasClaim: num(env.GAS_CLAIM, 800_000n),
    gasRouteMin: num(env.GAS_ROUTE_MIN, 350_000n),
    gasRouteMax: num(env.GAS_ROUTE_MAX, 1_800_000n),
    gasRoutePct: num(env.GAS_ROUTE_PCT, 140n),
    upstashUrl: env.UPSTASH_REDIS_REST_URL?.trim() || null,
    upstashToken: env.UPSTASH_REDIS_REST_TOKEN?.trim() || null,
  };
}

import { defineChain } from 'viem';

const env = import.meta.env;
export const API_BASE: string = env.VITE_API_BASE || 'https://pocketdrop-api.vercel.app';
export const EVM_RPC: string = env.VITE_EVM_RPC || 'https://evm-testnet.qore.host';
// CometBFT RPC and Cosmos REST go through the relayer's key-less CORS proxy (these hosts send no CORS headers).
export const COSMOS_RPC = `${API_BASE}/rpc`;
export const COSMOS_REST = `${API_BASE}/rest`;
export const POCKETDROP_ADDRESS = (env.VITE_POCKETDROP_ADDRESS || '0x29f53b4b8031e7ba1785dc8c7a1c0be413a4bd97') as `0x${string}`;
export const LAB_ADDRESS = (env.VITE_LAB_ADDRESS || '0xce1912ed9d310f1973a88e7ff6aa56f6d76c9a67') as `0x${string}`;
export const CHAIN_ID = 9800;
export const COSMOS_CHAIN_ID = 'qorechain-diana';
export const EXPLORER = 'https://explore.qore.network';
export const FAUCET_URL = 'https://dashboard.qorechain.io/faucet';
export const SOURCE_URL = 'https://github.com/mohamedwael201193/pocket-drop';
export const TESTNET_BADGE = 'Testnet — Diana, no monetary value';

/** Explorer links: EVM hashes carry 0x, Cosmos hashes are bare hex. The explorer accepts both forms. */
export const txUrl = (hash: string) => `${EXPLORER}/tx/${hash}`;
export const addrUrl = (addr: string) => `${EXPLORER}/address/${addr}`;

export const dianaChain = defineChain({
  id: CHAIN_ID,
  name: 'QoreChain Diana Testnet',
  nativeCurrency: { name: 'QOR', symbol: 'QOR', decimals: 18 },
  rpcUrls: { default: { http: [EVM_RPC] } },
  blockExplorers: { default: { name: 'Qore Explorer', url: EXPLORER } },
  testnet: true,
});

// Contract limits (immutable constructor args of the deployed instance, read back in deployments/diana.json; RECORDED).
export const LIMITS = {
  minEscrowQor: 0.1,
  maxAmountQor: 50,
  maxDripQor: 0.6,
  maxExpirySeconds: 2_592_000,
  bindTimeoutSeconds: 3600,
} as const;

import { createPublicClient, formatEther, http, parseEther, type Hex } from 'viem';
import { bech32 } from '@scure/base';
import { dianaChain, EVM_RPC } from './config';

export const pub = createPublicClient({ chain: dianaChain, transport: http(EVM_RPC) });

export const fmtQor = (wei: bigint, digits = 4): string => {
  const n = Number(formatEther(wei));
  const s = n.toFixed(digits);
  return s.includes('.') ? s.replace(/\.?0+$/, '') || '0' : s;
};
export const parseQor = (s: string): bigint | null => {
  if (!/^\d{1,3}(\.\d{1,6})?$/.test(s.trim())) return null;
  try { return parseEther(s.trim()); } catch { return null; }
};

/** qor1... address of the same 20 bytes as the 0x address (QoreChain accounts are eth_secp256k1). */
export function cosmosAddressOf(evm: string): string {
  const bytes = Uint8Array.from(evm.replace(/^0x/, '').match(/../g) ?? [], (x) => parseInt(x, 16));
  return bech32.encode('qor', bech32.toWords(bytes));
}

export async function chainNow(): Promise<number> {
  try { return Number((await pub.getBlock()).timestamp); } catch { return Math.floor(Date.now() / 1000); }
}
export const getBalance = (address: Hex) => pub.getBalance({ address });

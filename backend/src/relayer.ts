import {
  createPublicClient, createWalletClient, defineChain, http,
  type Address, type Hex, type PublicClient, type WalletClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { bech32 } from '@scure/base';
import { EVM_CHAIN_ID, type Config } from './config.js';
import { extractRevertData, isWindowError, decodeRevert, type DecodedRevert } from './errors.js';

export type SimResult = { ok: true } | { ok: false; revert: DecodedRevert };
export type SendResult =
  | { ok: true; hash: Hex; status: 'success' | 'reverted'; blockNumber: bigint; gasUsed: bigint }
  | { ok: false; reason: 'window' | 'rpc'; message: string };

export interface Relayer {
  address: Address;
  contract: Address;
  /** eth_call against the contract as the relayer; returns decoded custom error on revert. */
  simulate(data: Hex): Promise<SimResult>;
  /** Send with an explicit gas limit and wait for the receipt. */
  send(data: Hex, gasLimit: bigint): Promise<SendResult>;
}

export const evmToQor = (addr: string): string => bech32.encode('qor', bech32.toWords(Buffer.from(addr.slice(2), 'hex')));

export const dianaChain = (rpc: string) =>
  defineChain({ id: EVM_CHAIN_ID, name: 'QoreChain Diana', nativeCurrency: { name: 'QOR', symbol: 'QOR', decimals: 18 }, rpcUrls: { default: { http: [rpc] } } });

export function makePublicClient(cfg: Pick<Config, 'evmRpc'>): PublicClient {
  return createPublicClient({ chain: dianaChain(cfg.evmRpc), transport: http(cfg.evmRpc, { timeout: 15_000 }) }) as PublicClient;
}

export interface RelayerClients { pub: PublicClient; wallet: WalletClient }

export function createRelayer(cfg: Pick<Config, 'evmRpc' | 'relayerKey' | 'contract'>, clients?: Partial<RelayerClients>): Relayer {
  if (!cfg.relayerKey) throw new Error('RELAYER_SECP_KEY not configured');
  if (!cfg.contract) throw new Error('POCKETDROP_ADDRESS not configured');
  const account = privateKeyToAccount(cfg.relayerKey);
  const chain = dianaChain(cfg.evmRpc);
  const pub = clients?.pub ?? makePublicClient(cfg);
  const wallet = clients?.wallet ?? createWalletClient({ account, chain, transport: http(cfg.evmRpc, { timeout: 15_000 }) });
  const contract = cfg.contract as Address;

  return {
    address: account.address,
    contract,
    async simulate(data) {
      try {
        await pub.call({ account: account.address, to: contract, data });
      } catch (e) {
        const raw = extractRevertData(e);
        const msg = String((e as any)?.shortMessage ?? (e as any)?.message ?? 'execution reverted').split('\n')[0];
        return { ok: false, revert: decodeRevert(raw, msg) };
      }
      return { ok: true };
    },
    async send(data, gasLimit) {
      try {
        const gp = ((await pub.getGasPrice()) * 13n) / 10n;
        const hash = await (wallet as any).sendTransaction({ account, chain, to: contract, data, gas: gasLimit, gasPrice: gp, type: 'legacy' } as any);
        const rc = await pub.waitForTransactionReceipt({ hash, timeout: 45_000 });
        return { ok: true, hash, status: rc.status, blockNumber: rc.blockNumber, gasUsed: rc.gasUsed };
      } catch (e) {
        return { ok: false, reason: isWindowError(e) ? 'window' : 'rpc', message: String((e as any)?.details ?? (e as any)?.shortMessage ?? (e as any)?.message ?? e).slice(0, 400) };
      }
    },
  };
}

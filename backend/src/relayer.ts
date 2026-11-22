import {
  createPublicClient, createWalletClient, defineChain, http,
  type Address, type Hex, type PublicClient, type WalletClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { bech32 } from '@scure/base';
import { EVM_CHAIN_ID, type Config } from './config.js';
import { extractRevertData, isWindowError, decodeRevert, type DecodedRevert } from './errors.js';

export type SimResult = { ok: true } | { ok: false; revert: DecodedRevert };
/** How a relay reached the chain: an ECDSA-only EVM tx inside the relayer's EVM window, or a hybrid-signed MsgCrossVMCall. */
export type Lane = 'evm' | 'hybrid';
export type SendResult =
  | {
      ok: true; hash: string; lane: Lane; status: 'success' | 'reverted'; blockNumber: bigint; gasUsed: bigint;
      /** hybrid only: the callee's ABI-encoded return value (a cross-VM call leaves no EVM log) */
      returnData?: Hex;
      /** hybrid only: the chain emitted pqc_hybrid_verify status=verified for this tx */
      hybridVerified?: boolean;
      feeUqor?: string;
      /** hybrid only: chain log line when the EVM call reverted */
      failure?: string;
      /** set when the hybrid lane could not be used and the EVM window carried the tx */
      fallbackReason?: string;
    }
  | { ok: false; reason: 'window' | 'rpc' | 'hybrid'; message: string; hash?: string };

export interface Relayer {
  /** 'evm' = ECDSA-only EVM tx in the scoped window; 'hybrid' = MsgCrossVMCall signed with secp256k1 + ML-DSA-87. */
  mode: Lane;
  address: Address;
  contract: Address;
  /** eth_call against the contract as the relayer; returns decoded custom error on revert. */
  simulate(data: Hex): Promise<SimResult>;
  /** eth_estimateGas as the relayer; null when the node cannot estimate. */
  estimate?(data: Hex): Promise<bigint | null>;
  /** Send with an explicit (EVM) gas limit and wait for inclusion. `memo` names the tx on the native lane (hybrid only). */
  send(data: Hex, gasLimit: bigint, memo?: string): Promise<SendResult>;
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
    mode: 'evm',
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
    async estimate(data) {
      try { return await pub.estimateGas({ account: account.address, to: contract, data }); } catch { return null; }
    },
    async send(data, gasLimit) {
      try {
        const gp = ((await pub.getGasPrice()) * 13n) / 10n;
        const hash = await (wallet as any).sendTransaction({ account, chain, to: contract, data, gas: gasLimit, gasPrice: gp, type: 'legacy' } as any);
        const rc = await pub.waitForTransactionReceipt({ hash, timeout: 45_000 });
        return { ok: true, hash, lane: 'evm', status: rc.status, blockNumber: rc.blockNumber, gasUsed: rc.gasUsed };
      } catch (e) {
        return { ok: false, reason: isWindowError(e) ? 'window' : 'rpc', message: String((e as any)?.details ?? (e as any)?.shortMessage ?? (e as any)?.message ?? e).slice(0, 400) };
      }
    },
  };
}

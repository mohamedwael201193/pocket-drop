import { formatEther, type PublicClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { NETWORK, EVM_CHAIN_ID, COSMOS_CHAIN_ID, type Config } from './config.js';
import { evmToQor } from './relayer.js';

export interface WindowStatus {
  queryable: boolean; found?: boolean; live?: boolean; remainingBlocks?: string; remainingTxs?: string; remainingValue?: string;
  maxValue?: string; expiryHeight?: string; allowedTargets?: string[]; error?: string;
}

export async function getWindow(cfg: Pick<Config, 'rest'>, qorAddr: string, f: typeof fetch = fetch): Promise<WindowStatus> {
  try {
    const r = await f(`${cfg.rest}/qorechain/pqc/v1/evm_window/${qorAddr}`);
    if (!r.ok) return { queryable: false, error: `rest ${r.status}` };
    const j = (await r.json()) as Record<string, any>;
    return {
      queryable: true, found: !!j.found, live: !!j.live, remainingBlocks: j.remaining_blocks, remainingTxs: j.remaining_txs,
      remainingValue: j.remaining_value, maxValue: j.max_value, expiryHeight: j.expiry_height, allowedTargets: j.allowed_targets ?? [],
    };
  } catch (e) { return { queryable: false, error: e instanceof Error ? e.message : String(e) }; }
}

export async function getHealth(cfg: Config, pub: Pick<PublicClient, 'getBalance' | 'getBlockNumber'>, f: typeof fetch = fetch) {
  const base = { network: NETWORK, evmChainId: EVM_CHAIN_ID, cosmosChainId: COSMOS_CHAIN_ID, contract: cfg.contract, time: new Date().toISOString() };
  if (!cfg.relayerKey) return { ok: false, ...base, relayer: null, error: 'RELAYER_SECP_KEY not configured' };
  const address = privateKeyToAccount(cfg.relayerKey).address;
  const qor = evmToQor(address);
  const [bal, head, win] = await Promise.allSettled([pub.getBalance({ address }), pub.getBlockNumber(), getWindow(cfg, qor, f)]);
  const balance = bal.status === 'fulfilled' ? bal.value : null;
  const window = win.status === 'fulfilled' ? win.value : { queryable: false, error: 'window query failed' };
  return {
    ok: bal.status === 'fulfilled' && head.status === 'fulfilled' && !!cfg.contract && !!(window as WindowStatus).live,
    ...base,
    headBlock: head.status === 'fulfilled' ? head.value.toString() : null,
    relayer: { address, cosmosAddress: qor, balanceWei: balance?.toString() ?? null, balance: balance === null ? null : formatEther(balance), unit: 'QOR' },
    window,
    contractConfigured: !!cfg.contract,
  };
}

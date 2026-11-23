import { formatEther, parseEther, type PublicClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { NETWORK, EVM_CHAIN_ID, COSMOS_CHAIN_ID, type Config } from './config.js';
import { evmToQor } from './relayer.js';
import { pqSignerKind } from './hybridRelayer.js';
import { refillFunder, refillStatus } from './refill.js';

/** Public facts of the isolated ML-DSA-87 signer (GET on it), so /api/health can show which key it holds. */
export async function pqSignerFacts(cfg: Pick<Config, 'pqSignerUrl'>, f: typeof fetch = fetch): Promise<{ reachable: boolean; pqPublicKeyKeccak?: string; relayer?: string; signedThisHour?: number } | null> {
  if (!cfg.pqSignerUrl) return null;
  try {
    const r = await f(cfg.pqSignerUrl, { signal: AbortSignal.timeout(8_000) });
    const j = (await r.json()) as { ok?: boolean; pqPublicKeyKeccak?: string; relayer?: string; signedThisHour?: number };
    return r.ok && j.ok ? { reachable: true, pqPublicKeyKeccak: j.pqPublicKeyKeccak, relayer: j.relayer, signedThisHour: j.signedThisHour } : { reachable: false };
  } catch { return { reachable: false }; }
}

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

export const WINDOW_WARN_BLOCKS = 2000;

/** Operator-facing warning when the relayer window is closed or about to close. null when healthy. */
export function windowWarning(w: WindowStatus): { level: 'expired' | 'low' | 'unknown'; message: string } | null {
  if (!w.queryable) return { level: 'unknown', message: 'The relayer window could not be queried.' };
  if (!w.live) return { level: 'expired', message: 'The relayer window is not live: bind and claim will be refused until it is renewed. Escrowed funds are unaffected.' };
  const left = Number(w.remainingBlocks ?? 0);
  if (left < WINDOW_WARN_BLOCKS) return { level: 'low', message: `Only ${left} blocks remain in the relayer window (warning below ${WINDOW_WARN_BLOCKS}). The scheduled renewal job should have run; check it.` };
  return null;
}

/** Relayer balance below which /api/health raises a low-balance flag (QOR, testnet). Override with RELAYER_LOW_BALANCE_QOR. */
export const LOW_BALANCE_QOR_DEFAULT = '3';

export function lowBalanceThresholdWei(env: Record<string, string | undefined> = process.env): bigint {
  const raw = env.RELAYER_LOW_BALANCE_QOR?.trim();
  try { if (raw && /^\d+(\.\d+)?$/.test(raw)) return parseEther(raw); } catch { /* fall through to default */ }
  return parseEther(LOW_BALANCE_QOR_DEFAULT);
}

/** Operator-facing warning when the relayer balance is unknown or below the threshold. null when healthy. */
export function balanceWarning(balanceWei: bigint | null, thresholdWei: bigint): { level: 'low' | 'unknown'; message: string } | null {
  if (balanceWei === null) return { level: 'unknown', message: 'The relayer balance could not be read.' };
  if (balanceWei < thresholdWei) {
    return { level: 'low', message: `Relayer balance ${formatEther(balanceWei)} QOR is below ${formatEther(thresholdWei)} QOR. Top it up from the main wallet before relays start failing.` };
  }
  return null;
}

export async function getHealth(cfg: Config, pub: Pick<PublicClient, 'getBalance' | 'getBlockNumber'>, f: typeof fetch = fetch, env: Record<string, string | undefined> = process.env) {
  const base = { network: NETWORK, evmChainId: EVM_CHAIN_ID, cosmosChainId: COSMOS_CHAIN_ID, contract: cfg.contract, time: new Date().toISOString() };
  if (!cfg.relayerKey) return { ok: false, ...base, relayer: null, error: 'RELAYER_SECP_KEY not configured' };
  const address = privateKeyToAccount(cfg.relayerKey).address;
  const qor = evmToQor(address);
  const [bal, head, win, pqs, rf] = await Promise.allSettled([pub.getBalance({ address }), pub.getBlockNumber(), getWindow(cfg, qor, f), pqSignerFacts(cfg, f), refillStatus(cfg.rest, refillFunder(env), qor, Date.now(), f)]);
  const balance = bal.status === 'fulfilled' ? bal.value : null;
  const window = win.status === 'fulfilled' ? win.value : { queryable: false, error: 'window query failed' };
  const threshold = lowBalanceThresholdWei(env);
  const balWarn = balanceWarning(balance, threshold);
  const hybrid = cfg.relayMode === 'hybrid';
  // hybrid lane: a closed window is the goal (no ECDSA-only path); an open one is only the fallback, said plainly
  const winWarn = hybrid
    ? ((window as WindowStatus).live ? { level: 'open' as const, message: 'Relays are hybrid-signed, but the relayer EVM window is still open, so an ECDSA-only fallback path exists until it expires.' } : null)
    : windowWarning(window as WindowStatus);
  const warnings = [
    ...(balWarn ? [{ kind: 'relayer-balance', ...balWarn }] : []),
    ...(winWarn ? [{ kind: 'relayer-window', ...winWarn }] : []),
  ];
  return {
    ok: bal.status === 'fulfilled' && head.status === 'fulfilled' && !!cfg.contract && (hybrid || !!(window as WindowStatus).live),
    ...base,
    headBlock: head.status === 'fulfilled' ? head.value.toString() : null,
    relayer: {
      address, cosmosAddress: qor, balanceWei: balance?.toString() ?? null, balance: balance === null ? null : formatEther(balance), unit: 'QOR',
      lowBalance: balWarn?.level === 'low', lowBalanceThreshold: formatEther(threshold),
      /** auto-refill job: rules, the refill wallet, its last refill and the rolling 24 h total (read from the chain) */
      refill: rf.status === 'fulfilled' ? rf.value : { configured: true, error: 'refill read failed' },
    },
    window,
    relay: {
      mode: cfg.relayMode,
      signature: hybrid ? 'secp256k1 + ML-DSA-87 (hybrid MsgCrossVMCall, verified by the chain)' : 'secp256k1 only (EVM tx inside the scoped window)',
      fallback: hybrid && cfg.relayFallback ? 'evm-window' : 'none',
      /** true while the chain would accept an ECDSA-only EVM tx from the relayer (its window is live) */
      classicalPathOpen: !!(window as WindowStatus).live,
      /** where the relayer's ML-DSA-87 key lives: 'isolated' = a separate function with only that key; 'in-process' = this API */
      pqSigner: hybrid ? pqSignerKind(cfg) : null,
      ...(hybrid && cfg.pqSignerUrl ? { pqSignerFacts: pqs.status === 'fulfilled' ? pqs.value : { reachable: false } } : {}),
    },
    warnings,
    contractConfigured: !!cfg.contract,
  };
}

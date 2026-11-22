// The hybrid relay lane: the relayer sends each user-signed intent as a MsgCrossVMCall that it signs with BOTH its
// secp256k1 key and its ML-DSA-87 key. The chain verifies the hybrid signature (event pqc_hybrid_verify) and runs the call
// in the EVM, so the relayer needs no EVM authorisation window: an attacker who derives its secp256k1 key (Q-Day) cannot
// send anything as the relayer. eth_call simulation is unchanged (a read needs no signature).
// Facts measured on Diana (22 Nov 2026, see juror/RIVAL_TEARDOWN): a cross-VM call leaves no EVM log and no EVM tx; the
// callee's return value comes back in tx_response.data; an inner revert is a mined tx with code 14 and a fee.
import { privateKeyToAccount } from 'viem/accounts';
import type { Hex, PublicClient } from 'viem';
import type { Config } from './config.js';
import { accountSeq, broadcastSync, crossVmResponses, hybridVerified, simulateGas, waitTx, type Fetch } from './cosmos.js';
import { createRelayer, evmToQor, type Relayer, type SendResult } from './relayer.js';
import { loadSigner, type SignerMod } from './signerBundle.js';

/** Fee per unit of native gas (uqor); the chain minimum is 0.1. */
export const GAS_PRICE_UQOR = 0.11;
/** Native gas when the dry run is refused: overhead of the hybrid ante (two signatures, a 4.6 kB ML-DSA-87 signature) + EVM gas. */
export const HYBRID_OVERHEAD_GAS = 450_000n;
export const HYBRID_GAS_CAP = 4_000_000n;

/** Native gas for a hybrid relay: the dry run plus 15% and 20k (unused native gas is not refunded, so the margin is kept small), or overhead + 1.5x the EVM limit when the dry run fails; capped. */
export function hybridGas(simulated: bigint | null, evmGasLimit: bigint): bigint {
  const g = simulated !== null ? (simulated * 115n) / 100n + 20_000n : HYBRID_OVERHEAD_GAS + (evmGasLimit * 3n) / 2n;
  return g > HYBRID_GAS_CAP ? HYBRID_GAS_CAP : g;
}
export const feeFor = (gas: bigint): bigint => BigInt(Math.ceil(Number(gas) * GAS_PRICE_UQOR));

/** Memo that names a relay on the native lane, so it can be found and decoded later (a cross-VM call leaves no EVM log). */
export const relayMemo = (parts: (string | number | bigint | undefined)[]): string => ['pd', ...parts.filter((p) => p !== undefined && p !== '')].join(' ').slice(0, 250);

export interface HybridOpts {
  pub: PublicClient;
  fetch?: Fetch;
  signer?: () => Promise<Pick<SignerMod, 'signCrossVm'>>;
  /** EVM-window relayer used only when the hybrid tx could not be signed or was refused before execution. null = no fallback. */
  fallback?: Relayer | null;
  pollMs?: number;
}

type HybridCfg = Pick<Config, 'evmRpc' | 'rest' | 'relayerKey' | 'relayerPqc' | 'contract'>;

export function createHybridRelayer(cfg: HybridCfg, o: HybridOpts): Relayer & { cosmosAddress: string } {
  if (!cfg.relayerKey) throw new Error('RELAYER_SECP_KEY not configured');
  if (!cfg.relayerPqc) throw new Error('RELAYER_PQC_SEED not configured');
  if (!cfg.contract) throw new Error('POCKETDROP_ADDRESS not configured');
  const secp = cfg.relayerKey, pqc = cfg.relayerPqc, contract = cfg.contract;
  const address = privateKeyToAccount(secp).address;
  const cosmosAddress = evmToQor(address);
  const rest = cfg.rest.replace(/\/$/, '');
  const f = o.fetch ?? fetch;
  const signer = o.signer ?? loadSigner;
  // reads (eth_call / eth_estimateGas as the relayer's EVM address) need no signature and no window
  const reader = createRelayer({ evmRpc: cfg.evmRpc, relayerKey: secp, contract }, { pub: o.pub });
  const fallback = o.fallback ?? null;

  async function viaFallback(data: Hex, gasLimit: bigint, why: string): Promise<SendResult> {
    if (!fallback) return { ok: false, reason: 'hybrid', message: why };
    const r = await fallback.send(data, gasLimit);
    return r.ok ? { ...r, fallbackReason: why } : r;
  }

  return {
    mode: 'hybrid',
    address,
    cosmosAddress,
    contract,
    simulate: (data) => reader.simulate(data),
    estimate: (data) => reader.estimate!(data),
    async send(data, gasLimit, memo = relayMemo(['relay'])) {
      let mod: Pick<SignerMod, 'signCrossVm'>;
      try { mod = await signer(); } catch (e) { return viaFallback(data, gasLimit, `hybrid signer unavailable: ${(e as Error).message}`); }
      const sign = (gas: bigint, s: { accountNumber: bigint; sequence: bigint }) => mod.signCrossVm({
        secp, pqc, rest, contract, data, memo, gas: gas.toString(), feeUqor: feeFor(gas).toString(), accountNumber: s.accountNumber, sequence: s.sequence,
      });
      for (let attempt = 0; ; attempt++) {
        let seq: { accountNumber: bigint; sequence: bigint };
        try { seq = await accountSeq(rest, cosmosAddress, f); } catch (e) { return viaFallback(data, gasLimit, `account read failed: ${(e as Error).message}`); }
        let gas: bigint; let txBytes: string;
        try {
          const dry = await sign(hybridGas(null, gasLimit), seq);
          gas = hybridGas(await simulateGas(rest, dry.txBytes, f), gasLimit);
          txBytes = (await sign(gas, seq)).txBytes;
        } catch (e) { return viaFallback(data, gasLimit, `hybrid signing failed: ${(e as Error).message}`); }
        let b;
        try { b = await broadcastSync(rest, txBytes, f); } catch (e) { return viaFallback(data, gasLimit, `broadcast failed: ${(e as Error).message}`); }
        if (b.code === 32 && attempt < 2) continue; // account sequence race with another instance: re-read and re-sign
        if (!b.txhash || b.code !== 0) return viaFallback(data, gasLimit, `refused at broadcast (code ${b.code}, HTTP ${b.httpStatus}): ${b.log.slice(0, 160)}`);
        // accepted into the mempool: from here on never fall back (the call may execute)
        const tx = await waitTx(rest, b.txhash, f, 30, o.pollMs ?? 1500);
        if (!tx) return { ok: false, reason: 'rpc', message: `hybrid tx ${b.txhash} accepted but not found in a block after 45 s`, hash: b.txhash };
        const resp = crossVmResponses(tx.data)[0];
        return {
          ok: true, hash: tx.txhash, lane: 'hybrid', status: tx.code === 0 ? 'success' : 'reverted',
          blockNumber: BigInt(tx.height), gasUsed: BigInt(tx.gas_used ?? '0'), returnData: resp?.data,
          hybridVerified: hybridVerified(tx), feeUqor: feeFor(gas).toString(),
          ...(tx.code === 0 ? {} : { failure: (tx.raw_log ?? '').slice(0, 300) }),
        };
      }
    },
  };
}

/** The relayer for `contract`: hybrid when RELAY_MODE is not "evm" and the ML-DSA seed is configured (EVM window as fallback), else EVM. */
export function relayerFor(cfg: Config, contract: Hex, pub: PublicClient, extra: Partial<HybridOpts> = {}): Relayer {
  const evm = createRelayer({ ...cfg, contract }, { pub });
  if (cfg.relayMode !== 'hybrid' || !cfg.relayerPqc) return evm;
  return createHybridRelayer({ ...cfg, contract }, { pub, fallback: cfg.relayFallback ? evm : null, ...extra });
}

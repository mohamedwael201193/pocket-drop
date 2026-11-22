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
import { createHmac } from 'node:crypto';
import type { PqSignRequest } from './pqSplit.js';

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
  /** Split signing: the isolated ML-DSA-87 signer (default: built from cfg.pqSignerUrl / cfg.pqSignerHmac). */
  pqRemote?: PqRemote | null;
  /** EVM-window relayer used only when the hybrid tx could not be signed or was refused before execution. null = no fallback. */
  fallback?: Relayer | null;
  pollMs?: number;
}

type HybridCfg = Pick<Config, 'evmRpc' | 'rest' | 'relayerKey' | 'relayerPqc' | 'contract'> & Partial<Pick<Config, 'pqSignerUrl' | 'pqSignerHmac'>>;

/** Asks the isolated signer for the ML-DSA-87 half of a relay (it never sees the secp256k1 key). */
export interface PqRemote { sign(req: PqSignRequest): Promise<string> }
export const pqSignMac = (key: string, ts: string, body: string) => createHmac('sha256', key).update(`${ts}.${body}`).digest('hex');
export function pqRemote(url: string, hmac: string, f: Fetch = fetch): PqRemote {
  return {
    async sign(req) {
      const body = JSON.stringify(req), ts = String(Math.floor(Date.now() / 1000));
      const r = await f(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-pd-ts': ts, 'x-pd-mac': pqSignMac(hmac, ts, body) }, body, signal: AbortSignal.timeout(15_000) });
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; signature?: string; error?: string };
      if (!r.ok || !j.ok || !j.signature) throw new Error(`pq signer refused (HTTP ${r.status}): ${j.error ?? 'no signature'}`);
      return j.signature;
    },
  };
}
/** Which signer holds the ML-DSA-87 key for relays. */
export const pqSignerKind = (cfg: Pick<Config, 'pqSignerUrl' | 'pqSignerHmac' | 'relayerPqc'>): 'isolated' | 'in-process' | null =>
  cfg.pqSignerUrl && cfg.pqSignerHmac ? 'isolated' : cfg.relayerPqc ? 'in-process' : null;

export function createHybridRelayer(cfg: HybridCfg, o: HybridOpts): Relayer & { cosmosAddress: string } {
  if (!cfg.relayerKey) throw new Error('RELAYER_SECP_KEY not configured');
  const remote = o.pqRemote ?? (cfg.pqSignerUrl && cfg.pqSignerHmac ? pqRemote(cfg.pqSignerUrl, cfg.pqSignerHmac, o.fetch) : null);
  if (!cfg.relayerPqc && !remote) throw new Error('neither RELAYER_PQC_SEED nor PQ_SIGNER_URL configured');
  if (!cfg.contract) throw new Error('POCKETDROP_ADDRESS not configured');
  const secp = cfg.relayerKey, pqc = cfg.relayerPqc, contract = cfg.contract;
  const address = privateKeyToAccount(secp).address;
  const cosmosAddress = evmToQor(address);
  const rest = cfg.rest.replace(/\/$/, '');
  const f = o.fetch ?? fetch;
  const signer = o.signer ?? (remote ? splitSigner(remote, rest) : loadSigner);
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
        secp, pqc: pqc ?? ('0x' as Hex), rest, contract, data, memo, gas: gas.toString(), feeUqor: feeFor(gas).toString(), accountNumber: s.accountNumber, sequence: s.sequence,
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

/** signCrossVm in two halves: unsigned parts and the secp256k1 signature here, the ML-DSA-87 signature from the isolated signer. */
export function splitSigner(remote: PqRemote, rest: string, load: () => Promise<SignerMod> = loadSigner): () => Promise<Pick<SignerMod, 'signCrossVm'>> {
  return async () => {
    const mod = await load();
    return {
      async signCrossVm(i) {
        const version = await mod.signBytesVersion(rest);
        const parts = mod.crossVmParts({ secp: i.secp, contract: i.contract, data: i.data, memo: i.memo, gas: BigInt(i.gas), feeUqor: i.feeUqor, accountNumber: i.accountNumber, sequence: i.sequence, version });
        const sig = await remote.sign({ b0: parts.b0, authInfo: parts.authInfo, chainId: parts.chainId, version: parts.version });
        return { from: parts.from, txBytes: mod.assembleHybrid(i.secp, parts, sig) };
      },
    };
  };
}

/** The relayer for `contract`: hybrid when RELAY_MODE is not "evm" and an ML-DSA signer is configured (the isolated one, else the
 *  in-process seed; EVM window as fallback), else EVM. */
export function relayerFor(cfg: Config, contract: Hex, pub: PublicClient, extra: Partial<HybridOpts> = {}): Relayer {
  const evm = createRelayer({ ...cfg, contract }, { pub });
  if (cfg.relayMode !== 'hybrid' || !pqSignerKind(cfg)) return evm;
  return createHybridRelayer({ ...cfg, contract }, { pub, fallback: cfg.relayFallback ? evm : null, ...extra });
}

// Live chain access for /api/sponsor: viem reads, Cosmos REST for the sponsor's own send history, and a hybrid-signed
// (secp256k1 + ML-DSA-87) MsgSend from the sponsor wallet. QoreChain rejects classical-only sends from accounts, so the
// sponsor's own key is PoP-registered. Secrets come from SPONSOR_SECP_KEY / SPONSOR_PQC_SECRET and are never logged.
import { decodeFunctionResult, encodeFunctionData, parseAbi, type Hex, type PublicClient } from 'viem';
import { bytesToHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Config } from './config.js';
import { evmToQor } from './relayer.js';
import type { PocketCfgIn, PoolView, SponsorChain, SponsorRules, SponsorSend } from './sponsor.js';
import { V4_INSTANCES, type V4Env } from './v4.js';

const KS = parseAbi(['function pqcKeyStatus(address) view returns (bool, uint8, bytes, bool)']);
const VERIFY = parseAbi(['function pqcVerify(bytes, bytes, bytes) view returns (uint256)']);
const POOL = parseAbi([
  'function getPool(uint256) view returns ((address host, uint96 perSlot, uint32 slots, uint32 taken, uint64 expiry, bool closed, bytes32 linkKeyHash))',
  'function claimed(uint256, address) view returns (bool)',
]);
const FACTORY = parseAbi(['function predict(address, address[], uint8, uint256, bytes32) view returns (address)']);
const KEYS = '0x0000000000000000000000000000000000000a02' as const;
const PQV = '0x0000000000000000000000000000000000000a01' as const;
const ZERO = '0x0000000000000000000000000000000000000000';

interface TxResp { timestamp: string; tx: { body: { memo?: string; messages: { to_address?: string }[] } } }

export function createSponsorChain(cfg: Config, pub: PublicClient, rules: SponsorRules, env: Record<string, string | undefined> = process.env): SponsorChain | null {
  const secp = env.SPONSOR_SECP_KEY?.trim();
  const pqc = env.SPONSOR_PQC_SECRET?.trim();
  if (!secp || !pqc) return null;
  // the signer is pre-bundled (see src/sponsorSigner.ts); load it by file URL so the runtime never require()s ESM
  type SignerMod = typeof import('./sponsorSigner.js');
  let signerP: Promise<SignerMod> | null = null;
  const signerMod = () => (signerP ??= (async () => {
    const cands = [path.join(process.cwd(), 'vendor', 'sponsor-signer.mjs')];
    try { cands.push(fileURLToPath(new URL('../vendor/sponsor-signer.mjs', import.meta.url))); } catch { /* no file URL */ }
    const file = cands.find((c) => existsSync(c));
    if (!file) throw new Error('sponsor signer bundle missing');
    return (await import(pathToFileURL(file).href)) as SignerMod;
  })());
  const sponsorEvm = privateKeyToAccount((secp.startsWith('0x') ? secp : `0x${secp}`) as Hex).address;
  const sponsorQor = evmToQor(sponsorEvm);
  const rest = cfg.rest.replace(/\/$/, '');

  async function waitTx(hash: string): Promise<{ code: number; log: string }> {
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      const r = await fetch(`${rest}/cosmos/tx/v1beta1/txs/${hash}`, { signal: AbortSignal.timeout(10_000) }).catch(() => null);
      if (r?.ok) {
        const j = (await r.json()) as { tx_response?: { code?: number; raw_log?: string } };
        return { code: j.tx_response?.code ?? 0, log: j.tx_response?.raw_log ?? '' };
      }
    }
    throw new Error(`tx ${hash} not found after 45s`);
  }

  async function txSearch(query: string, limit: number): Promise<{ total: number; txs: TxResp[] }> {
    const u = `${rest}/cosmos/tx/v1beta1/txs?query=${encodeURIComponent(query)}&order_by=ORDER_BY_DESC&pagination.limit=${limit}`;
    const r = await fetch(u, { signal: AbortSignal.timeout(15_000) });
    if (!r.ok) throw new Error(`tx search HTTP ${r.status}`);
    const j = (await r.json()) as { total?: string; pagination?: { total?: string }; tx_responses?: TxResp[] };
    return { total: Number(j.total ?? j.pagination?.total ?? j.tx_responses?.length ?? 0), txs: j.tx_responses ?? [] };
  }

  return {
    sponsorAddress: sponsorEvm,
    balance: (a) => pub.getBalance({ address: a }),
    hasCode: async (a) => ((await pub.getCode({ address: a })) ?? '0x') !== '0x',
    keyRegistered: async (a) => {
      const r = await pub.call({ to: KEYS, data: encodeFunctionData({ abi: KS, functionName: 'pqcKeyStatus', args: [a] }) });
      const [registered, , , proven] = decodeFunctionResult({ abi: KS, functionName: 'pqcKeyStatus', data: r.data ?? '0x' });
      return registered && proven;
    },
    getPool: async (e: V4Env, id) => {
      const p = (await pub.readContract({ address: V4_INSTANCES[e].pool as Hex, abi: POOL, functionName: 'getPool', args: [id] })) as unknown as PoolView & { slots: number };
      if (!p || p.host === ZERO) return null;
      return { host: p.host, perSlot: BigInt(p.perSlot), slots: Number(p.slots), taken: Number(p.taken), expiry: BigInt(p.expiry), closed: p.closed, linkKeyHash: p.linkKeyHash };
    },
    poolClaimed: (e, id, who) => pub.readContract({ address: V4_INSTANCES[e].pool as Hex, abi: POOL, functionName: 'claimed', args: [id, who] }) as Promise<boolean>,
    pqVerify: async (pk, sig, message) => {
      try {
        const r = await pub.call({ to: PQV, data: encodeFunctionData({ abi: VERIFY, functionName: 'pqcVerify', args: [pk, sig, bytesToHex(message)] }) });
        return !!r.data && BigInt(r.data) === 1n;
      } catch { return false; }
    },
    predictPocket: (e, c: PocketCfgIn) => pub.readContract({ address: V4_INSTANCES[e].factory as Hex, abi: FACTORY, functionName: 'predict', args: [c.owner, c.guardians, c.threshold, c.dailyLimit, c.userSalt] }) as Promise<Hex>,
    recentSends: async (): Promise<SponsorSend[]> => {
      const { txs } = await txSearch(`message.sender='${sponsorQor}'`, Math.max(50, rules.dailyCap * 2));
      return txs.filter((t) => (t.tx.body.memo ?? '').startsWith('pd-sponsor')).map((t) => ({ to: t.tx.body.messages[0]?.to_address ?? '', memo: t.tx.body.memo ?? '', time: Date.parse(t.timestamp) }));
    },
    // this node's indexer does not support AND across events: list transfers to the account, keep the sponsor's
    everSponsored: async (a) => (await txSearch(`transfer.recipient='${evmToQor(a)}'`, 30)).txs.some((t) =>
      t.tx.body.messages.some((m) => (m as { from_address?: string }).from_address === sponsorQor)),
    sponsorBalanceWei: () => pub.getBalance({ address: sponsorEvm }),
    now: () => Date.now(),
    send: async (to, amountUqor, memo) => {
      const { signSend } = await signerMod();
      const seq = async () => {
        const r = await fetch(`${rest}/cosmos/auth/v1beta1/accounts/${sponsorQor}`, { signal: AbortSignal.timeout(15_000) });
        const j = (await r.json()) as { account?: { base_account?: { account_number?: string; sequence?: string }; account_number?: string; sequence?: string } };
        const a = j.account?.base_account ?? j.account ?? {};
        return { accountNumber: BigInt(a.account_number ?? 0), sequence: BigInt(a.sequence ?? 0) };
      };
      for (let attempt = 0; ; attempt++) {
        const s = await seq();
        const { txBytes } = await signSend({
          secp, pqc, rest, to: evmToQor(to), amountUqor: amountUqor.toString(), memo,
          feeUqor: rules.sendFeeUqor.toString(), gas: rules.sendGas.toString(), accountNumber: s.accountNumber, sequence: s.sequence,
        });
        const b = await fetch(`${rest}/cosmos/tx/v1beta1/txs`, {
          method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(20_000),
          body: JSON.stringify({ tx_bytes: txBytes, mode: 'BROADCAST_MODE_SYNC' }),
        });
        const bj = (await b.json()) as { tx_response?: { code?: number; txhash?: string; raw_log?: string } };
        const tr = bj.tx_response;
        if (!b.ok || !tr?.txhash) throw new Error(`broadcast HTTP ${b.status}`);
        if (tr.code === 32 && attempt < 2) continue; // sequence race with another instance
        if (tr.code) throw new Error(`send refused code ${tr.code}: ${(tr.raw_log ?? '').slice(0, 200)}`);
        const res = await waitTx(tr.txhash);
        if (res.code === 0) return { hash: tr.txhash };
        throw new Error(`send failed code ${res.code}: ${res.log.slice(0, 200)}`);
      }
    },
  };
}

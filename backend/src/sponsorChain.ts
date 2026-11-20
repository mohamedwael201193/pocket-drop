// Live chain access for /api/sponsor: viem reads, Cosmos REST for the sponsor's own send history, and a hybrid-signed
// (secp256k1 + ML-DSA-87) MsgSend from the sponsor wallet. QoreChain rejects classical-only sends from accounts, so the
// sponsor's own key is PoP-registered. Secrets come from SPONSOR_SECP_KEY / SPONSOR_PQC_SECRET and are never logged.
import { decodeFunctionResult, encodeFunctionData, parseAbi, type Hex, type PublicClient } from 'viem';
import { bytesToHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
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

const hexBytes = (h: string) => Uint8Array.from(Buffer.from(h.replace(/^0x/, ''), 'hex'));

interface TxResp { timestamp: string; tx: { body: { memo?: string; messages: { to_address?: string }[] } } }

export function createSponsorChain(cfg: Config, pub: PublicClient, rules: SponsorRules, env: Record<string, string | undefined> = process.env): SponsorChain | null {
  const secp = env.SPONSOR_SECP_KEY?.trim();
  const pqc = env.SPONSOR_PQC_SECRET?.trim();
  if (!secp || !pqc) return null;
  let acctP: Promise<{ evm: Hex; cosmos: string } & Record<string, unknown>> | null = null;
  const account = async () => {
    acctP ??= (async () => {
      const { unifiedAccountFromSeed } = await import('@qorechain/sdk');
      return unifiedAccountFromSeed(hexBytes(secp), { pqcSecret: hexBytes(pqc) }) as never;
    })();
    return acctP;
  };
  const sponsorEvm = privateKeyToAccount((secp.startsWith('0x') ? secp : `0x${secp}`) as Hex).address;
  const sponsorQor = evmToQor(sponsorEvm);
  const rest = cfg.rest.replace(/\/$/, '');

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
      const acct = await account();
      const { EthNativeSigner, bank, getNetwork } = await import('@qorechain/sdk');
      const { StargateClient } = await import('@cosmjs/stargate');
      const net = getNetwork('testnet');
      const seq = async () => {
        const r = await fetch(`${rest}/cosmos/auth/v1beta1/accounts/${acct.cosmos}`, { signal: AbortSignal.timeout(15_000) });
        const j = (await r.json()) as { account?: { base_account?: { account_number?: string; sequence?: string }; account_number?: string; sequence?: string } };
        const a = j.account?.base_account ?? j.account ?? {};
        return { accountNumber: BigInt(a.account_number ?? 0), sequence: BigInt(a.sequence ?? 0) };
      };
      const signer = new EthNativeSigner(acct as never, { signMode: 'hybrid', rest });
      const client = await StargateClient.connect(env.COSMOS_RPC_URL?.trim() || net.endpoints.rpc);
      try {
        for (let attempt = 0; ; attempt++) {
          const s = await seq();
          const res = await signer.signAndBroadcast(client as never, {
            chainId: net.chainId, accountNumber: s.accountNumber, sequence: s.sequence, memo,
            fee: { amount: [{ denom: 'uqor', amount: rules.sendFeeUqor.toString() }], gas: rules.sendGas.toString() },
            messages: [bank.send({ fromAddress: acct.cosmos, toAddress: evmToQor(to), amount: [{ denom: 'uqor', amount: amountUqor.toString() }] })],
          } as never) as { code: number; transactionHash: string; rawLog?: string };
          if (res.code === 0) return { hash: res.transactionHash };
          if (res.code === 32 && attempt < 2) continue; // sequence race with another instance
          throw new Error(`send failed code ${res.code}: ${(res.rawLog ?? '').slice(0, 200)}`);
        }
      } finally { client.disconnect(); }
    },
  };
}

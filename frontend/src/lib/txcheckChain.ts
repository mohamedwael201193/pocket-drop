// Live chain reads for the transaction checker: Cosmos REST (through the key-less CORS proxy), EVM JSON-RPC and the PQC precompile.
import { bytesToHex, encodeFunctionData, parseAbi, type Hex } from 'viem';
import { decodeKeyStatusStrict } from './keystatus';
import { pub } from './chain';
import { COSMOS_REST } from './config';
import { fromCosmosTx, isEvmHash, type CheckDeps, type FetchedTx } from './txcheck';

const KS = parseAbi(['function pqcKeyStatus(address) view returns (bool, uint8, bytes, bool)']);
const PQC = '0x0000000000000000000000000000000000000a02' as Hex;

async function fetchTx(hash: string): Promise<FetchedTx> {
  if (isEvmHash(hash)) {
    const [tx, rc] = await Promise.all([pub.getTransaction({ hash: hash as Hex }), pub.getTransactionReceipt({ hash: hash as Hex })]);
    return { lane: 'evm', hash, height: rc.blockNumber, ok: rc.status === 'success', router: (tx.to ?? '0x') as Hex, payload: tx.input, relayer: tx.from };
  }
  const r = await fetch(`${COSMOS_REST}/cosmos/tx/v1beta1/txs/${hash}`);
  if (r.status === 404 || r.status === 400) throw new Error('The chain has no transaction with this hash.');
  if (!r.ok) throw new Error(`The chain did not answer (HTTP ${r.status}). Try again.`);
  const t = fromCosmosTx(await r.json());
  if (!t) throw new Error('This native transaction is not a cross-VM call to a Pocket Drop router.');
  return t;
}

/** Load @qorechain/qoresign lazily; the checker then runs both official implementations. */
export async function withQoresign(d: CheckDeps): Promise<CheckDeps> {
  const q = await import('@qorechain/qoresign');
  return { ...d, qoresign: { messageBytes: (c, data) => q.messagePqSignBytes(c, data), verify: (pk, m, s) => q.pqVerify(pk, m, s) } };
}

export const liveDeps: CheckDeps = {
  fetchTx,
  read: (address, abi, functionName, args, block) => pub.readContract({ address, abi: abi as never, functionName, args, blockNumber: block } as never),
  hasCode: async (address, block) => ((await pub.getCode({ address, blockNumber: block })) ?? '0x') !== '0x',
  keyOf: async (addr) => {
    const r = await pub.call({ to: PQC, data: encodeFunctionData({ abi: KS, functionName: 'pqcKeyStatus', args: [addr] }) });
    // Hand-validated decode (offset 0x80, 0/1 booleans, exact 2592-byte ML-DSA-87 key, zero padding); anything else = no key.
    const ks = decodeKeyStatusStrict(r.data ?? '0x');
    return ks.ok && ks.registered && ks.pubkey.length > 0 ? bytesToHex(ks.pubkey) : null;
  },
  verify: async (pk, msg, sig) => { const { mldsa } = await import('@qorechain/pqc'); try { return mldsa.verify(pk, msg, sig); } catch { return false; } },
};

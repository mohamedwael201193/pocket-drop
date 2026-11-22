// Live chain reads for the transaction checker: Cosmos REST (through the key-less CORS proxy), EVM JSON-RPC and the PQC precompile.
import { decodeFunctionResult, encodeFunctionData, parseAbi, type Hex } from 'viem';
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

export const liveDeps: CheckDeps = {
  fetchTx,
  read: (address, abi, functionName, args, block) => pub.readContract({ address, abi: abi as never, functionName, args, blockNumber: block } as never),
  hasCode: async (address, block) => ((await pub.getCode({ address, blockNumber: block })) ?? '0x') !== '0x',
  keyOf: async (addr) => {
    const r = await pub.call({ to: PQC, data: encodeFunctionData({ abi: KS, functionName: 'pqcKeyStatus', args: [addr] }) });
    const [registered, , pk] = decodeFunctionResult({ abi: KS, functionName: 'pqcKeyStatus', data: r.data ?? '0x' });
    return registered && pk && pk !== '0x' ? pk : null;
  },
  verify: async (pk, msg, sig) => { const { mldsa } = await import('@qorechain/pqc'); try { return mldsa.verify(pk, msg, sig); } catch { return false; } },
};

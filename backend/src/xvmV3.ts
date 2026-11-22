// v3 PocketDrop calls relayed on the hybrid lane (a MsgCrossVMCall leaves no EVM log, see xvm.ts). /api/stats counts v3
// links from EVM logs, so without this a v3 link bound and claimed through a hybrid relay (link #29, 22 Nov 2026) would read
// as never claimed. This module turns each successful hybrid bind/claim into the log the v3 contract would have emitted,
// filling fields that are not in the calldata (bind deadline, claimed amount) from contract state.
import { bech32 } from '@scure/base';
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, getAddress, type Address, type Hex, type Log } from 'viem';
import { pocketDropAbi } from './abi.js';
import type { TxResponse } from './cosmos.js';

export interface V3LinkState { recipient: Address; amount: bigint; bindDeadline: bigint }

/** qor1… (20-byte account) -> 0x address. */
export function qorToEvm(qor: string): Address {
  const d = bech32.decode(qor as `${string}1${string}`);
  return getAddress(`0x${Buffer.from(bech32.fromWords(d.words)).toString('hex')}`);
}

function evLog(name: 'LinkBound' | 'LinkClaimed', args: Record<string, unknown>, address: Address, tx: TxResponse): Log {
  const ev = (pocketDropAbi as readonly unknown[]).find((x) => (x as { type: string; name?: string }).type === "event" && (x as { name?: string }).name === name) as { inputs: { name: string; type: string; indexed?: boolean }[] };
  const topics = encodeEventTopics({ abi: pocketDropAbi, eventName: name, args } as never) as Hex[];
  const plain = ev.inputs.filter((i) => !i.indexed);
  const data = encodeAbiParameters(plain as never, plain.map((i) => args[i.name]) as never);
  return { address, topics: topics as [Hex, ...Hex[]], data, blockNumber: BigInt(tx.height), transactionHash: tx.txhash as Hex, logIndex: 0, blockHash: null, transactionIndex: null, removed: false } as unknown as Log;
}

/** Logs for every successful hybrid bind/claim into the v3 contract `v3`, oldest first. */
export async function v3HybridLogs(txs: TxResponse[], v3: Address, readLink: (id: bigint) => Promise<V3LinkState | null>): Promise<Log[]> {
  const out: Log[] = [];
  const sorted = [...txs].sort((a, b) => Number(BigInt(a.height) - BigInt(b.height)));
  for (const tx of sorted) {
    if (tx.code !== 0) continue;
    const m = (tx.tx?.body?.messages ?? []).find((x) => x['@type'] === '/qorechain.crossvm.v1.MsgCrossVMCall' && String(x.target_contract ?? '').toLowerCase() === v3.toLowerCase());
    if (!m) continue;
    const payload = `0x${Buffer.from(String(m.payload ?? ''), 'base64').toString('hex')}` as Hex;
    let c: { functionName: string; args: readonly unknown[] };
    try { c = decodeFunctionData({ abi: pocketDropAbi, data: payload }) as never; } catch { continue; }
    let relayer: Address; try { relayer = qorToEvm(String(m.sender ?? '')); } catch { continue; }
    if (c.functionName === 'bind') {
      const [linkId, recipient, recipientKeyHash] = c.args as [bigint, Address, Hex];
      const s = await readLink(linkId).catch(() => null);
      out.push(evLog('LinkBound', { linkId, recipient, recipientKeyHash, bindDeadline: s?.bindDeadline ?? 0n, rebind: false, relayer }, v3, tx));
    } else if (c.functionName === 'claim') {
      const [linkId] = c.args as [bigint];
      const s = await readLink(linkId).catch(() => null);
      if (!s) continue;
      out.push(evLog('LinkClaimed', { linkId, recipient: s.recipient, amount: s.amount, relayer }, v3, tx));
    }
  }
  return out;
}

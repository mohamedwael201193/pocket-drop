// The sender's links, rebuilt from LinkCreated events (sender is an indexed topic), so any device that holds the account sees them.
import { getAbiItem, type Hex } from 'viem';
import { pocketDropAbi } from './abi';
import { pub } from './chain';
import { POCKETDROP_ADDRESS } from './config';
import { REC } from '../data/proofs';

export interface ChainLink { id: string; mode: 'Confirmed' | 'Open'; amountWei: string; txHash: string }
const CHUNK = 9000n; // the RPC allows at most 10,000 blocks per getLogs
const cache = new Map<string, { upTo: bigint; items: Map<string, ChainLink> }>();
const ev = getAbiItem({ abi: pocketDropAbi, name: 'LinkCreated' });

export async function scanSenderLinks(sender: Hex): Promise<ChainLink[]> {
  const key = sender.toLowerCase();
  const c = cache.get(key) ?? { upTo: BigInt(REC.main.blockNumber) - 1n, items: new Map<string, ChainLink>() };
  const head = await pub.getBlockNumber();
  for (let from = c.upTo + 1n; from <= head; from += CHUNK) {
    const to = from + CHUNK - 1n > head ? head : from + CHUNK - 1n;
    const logs = await pub.getLogs({ address: POCKETDROP_ADDRESS, event: ev, args: { sender }, fromBlock: from, toBlock: to });
    for (const l of logs) {
      const a = l.args as { linkId: bigint; mode: number; amount: bigint };
      c.items.set(a.linkId.toString(), { id: a.linkId.toString(), mode: a.mode === 0 ? 'Confirmed' : 'Open', amountWei: a.amount.toString(), txHash: l.transactionHash });
    }
    c.upTo = to;
  }
  cache.set(key, c);
  return [...c.items.values()].sort((x, y) => Number(BigInt(y.id) - BigInt(x.id)));
}

import { describe, expect, it } from 'vitest';
import { decodeEventLog, encodeFunctionData, type Address } from 'viem';
import { pocketDropAbi } from '../src/abi.js';
import { evmToQor } from '../src/relayer.js';
import { buildStats } from '../src/stats.js';
import { qorToEvm, v3HybridLogs } from '../src/xvmV3.js';
import type { TxResponse } from '../src/cosmos.js';

const V3 = '0x29f53b4b8031e7ba1785dc8c7a1c0be413a4bd97' as Address;
const RELAYER = '0x1111111111111111111111111111111111111111' as Address;
const RECIPIENT = '0x2222222222222222222222222222222222222222' as Address;
const KH = `0x${'ab'.repeat(32)}` as const;

const tx = (hash: string, height: number, data: `0x${string}`, code = 0, target: string = V3): TxResponse => ({
  txhash: hash, height: String(height), code,
  tx: { body: { memo: 'pd v3', messages: [{ '@type': '/qorechain.crossvm.v1.MsgCrossVMCall', sender: evmToQor(RELAYER), target_contract: target, payload: Buffer.from(data.slice(2), 'hex').toString('base64') }] } },
});
const bindData = encodeFunctionData({ abi: pocketDropAbi, functionName: 'bind', args: [29n, RECIPIENT, KH, '0x01', '0x02'] });
const claimData = encodeFunctionData({ abi: pocketDropAbi, functionName: 'claim', args: [29n, '0x03'] });
const readLink = async () => ({ recipient: RECIPIENT, amount: 10n ** 17n, bindDeadline: 1_800_000_000n });

describe('v3 hybrid relays', () => {
  it('round-trips qor and 0x addresses', () => expect(qorToEvm(evmToQor(RELAYER))).toBe(RELAYER));

  it('turns a hybrid bind and claim into the logs v3 would have emitted', async () => {
    const logs = await v3HybridLogs([tx('BBBB', 11, claimData), tx('AAAA', 10, bindData)], V3, readLink);
    expect(logs.map((l) => l.transactionHash)).toEqual(['AAAA', 'BBBB']); // oldest first
    const b = decodeEventLog({ abi: pocketDropAbi, data: logs[0].data, topics: logs[0].topics as never }) as { eventName: string; args: Record<string, unknown> };
    expect(b.eventName).toBe('LinkBound');
    expect(b.args).toMatchObject({ linkId: 29n, recipient: RECIPIENT, recipientKeyHash: KH, bindDeadline: 1_800_000_000n, rebind: false, relayer: RELAYER });
    const c = decodeEventLog({ abi: pocketDropAbi, data: logs[1].data, topics: logs[1].topics as never }) as { eventName: string; args: Record<string, unknown> };
    expect(c.eventName).toBe('LinkClaimed');
    expect(c.args).toMatchObject({ linkId: 29n, recipient: RECIPIENT, amount: 10n ** 17n, relayer: RELAYER });
  });

  it('skips failed txs, other targets and undecodable payloads; a claim needs link state', async () => {
    const logs = await v3HybridLogs([
      tx('F1', 1, bindData, 14),
      tx('F2', 2, bindData, 0, '0x0000000000000000000000000000000000000001'),
      tx('F3', 3, '0xdeadbeef'),
    ], V3, readLink);
    expect(logs).toEqual([]);
    expect(await v3HybridLogs([tx('C', 4, claimData)], V3, async () => null)).toEqual([]);
  });

  it('counts the claim in v3 stats and marks the row as a hybrid relay', async () => {
    const logs = await v3HybridLogs([tx('AAAA', 10, bindData), tx('BBBB', 11, claimData)], V3, readLink);
    const s = buildStats(logs, new Map());
    expect(s.counts.claimed).toBe(1);
    expect(s.counts.bound).toBe(1);
    expect(s.volume.claimedWei).toBe(String(10n ** 17n));
    expect(s.recent[0]).toMatchObject({ kind: 'claimed', linkId: '29', txHash: 'BBBB', lane: 'hybrid' });
  });
});

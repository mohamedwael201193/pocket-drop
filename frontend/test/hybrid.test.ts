import { describe, expect, it } from 'vitest';
import type { Hex } from 'viem';
import { createdId } from '../src/lib/v4';
import { hybridCreated } from '../src/lib/links4';
import { mergeHybrid } from '../src/lib/radar';
import type { RouteResult, XvmEvent } from '../src/lib/api';

const POCKET = '0x00000000000000000000000000000000000000AA' as Hex;
const H = ('0x' + '11'.repeat(32)) as Hex;
const base: RouteResult = { txHash: '93FC5B4B3704CF84F6C587FB4B543294793A0FDC4CC95F8D4EA0843C5345C192' as Hex, status: 'success', env: 'prod', action: 'relay', lane: 'hybrid' };
const ev = (eventName: string, args: Record<string, unknown>, block = '10'): XvmEvent => ({ eventName, args, blockNumber: block, transactionHash: 'AB'.repeat(32), lane: 'hybrid' });

describe('createdId', () => {
  it('takes the link or pool id from the router return value of a hybrid relay', async () => {
    expect(await createdId({ ...base, result: { linkId: '42' } }, 'drop')).toBe(42n);
    expect(await createdId({ ...base, result: { poolId: '7' } }, 'pool')).toBe(7n);
  });
  it('refuses a native-lane hash with no id (there is no EVM receipt to read)', async () => {
    await expect(createdId({ ...base, result: {} }, 'drop')).rejects.toThrow(/id was not returned/);
    await expect(createdId({ ...base, result: { linkId: 'x' } }, 'drop')).rejects.toThrow(/id was not returned/);
  });
});

describe('hybridCreated', () => {
  it('keeps only this Pocket\'s drops and pools, with amounts as bigints', () => {
    const out = hybridCreated([
      ev('LinkCreated', { linkId: '5', sender: POCKET.toLowerCase(), mode: 1, amount: '100', linkKeyHash: H }),
      ev('PoolCreated', { poolId: '8', host: POCKET, slots: 3, perSlot: '7', linkKeyHash: H }),
      ev('LinkCreated', { linkId: '6', sender: '0x00000000000000000000000000000000000000bb', mode: 0, amount: '1', linkKeyHash: H }),
      ev('LinkClaimed', { linkId: '5' }),
    ], POCKET);
    expect(out).toEqual([
      { kind: 'drop', id: 5n, txHash: 'AB'.repeat(32), linkKeyHash: H, amountWei: 100n, mode: 'Open' },
      { kind: 'pool', id: 8n, txHash: 'AB'.repeat(32), linkKeyHash: H, amountWei: 21n, slots: 3, perSlot: 7n },
    ]);
  });
});

describe('mergeHybrid (radar)', () => {
  it('appends hybrid events in place and never counts a Pocket twice', () => {
    const l: Record<string, { args: Record<string, unknown>; transactionHash: Hex; blockNumber: bigint }[]> = {
      PocketDeployed: [{ args: { pocket: POCKET, owner: POCKET }, transactionHash: '0x1' as Hex, blockNumber: 1n }], LinkCreated: [], LinkBound: [],
    };
    mergeHybrid(l, [ev('PocketDeployed', { pocket: POCKET.toLowerCase() }), ev('PocketDeployed', { pocket: '0x00000000000000000000000000000000000000bb' }), ev('LinkBound', { linkId: '1' }, '12'), ev('Unknown', {})]);
    expect(l.PocketDeployed).toHaveLength(2);
    expect(l.LinkBound[0].blockNumber).toBe(12n);
  });
});

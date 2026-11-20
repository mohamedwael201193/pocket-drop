import { describe, expect, it } from 'vitest';
import type { Address, Hex } from 'viem';
import { buildV4Env, getV4Stats, keyEras, V2_RELEASE_BLOCK, type EvLog, type V4Reader } from '../src/statsv4.js';

const A = (n: number) => ('0x' + n.toString(16).padStart(40, '0')) as Address;
const ev = (args: Record<string, unknown>, block: bigint): EvLog => ({ args, blockNumber: block, transactionHash: ('0x' + '00'.repeat(32)) as Hex });
const own = new Map([[A(1).toLowerCase(), 'team']]);
const empty = { PocketDeployed: [], LinkCreated: [], LinkBound: [], LinkConfirmed: [], LinkClaimed: [], LinkCancelled: [], PoolCreated: [], PoolClaimed: [] } as Record<string, EvLog[]>;

describe('v4 stats', () => {
  it('splits own and external through the Pocket owner, like /radar', () => {
    const l = { ...empty, PocketDeployed: [ev({ pocket: A(10), owner: A(1) }, 1n), ev({ pocket: A(11), owner: A(2) }, 1n)], LinkCreated: [ev({ sender: A(10) }, 2n), ev({ sender: A(11) }, 2n), ev({ sender: A(11) }, 3n)] };
    const s = buildV4Env('prod', l as any, own);
    expect(s.pockets).toBe(2);
    expect(s.pocketsOwn).toEqual({ own: 1, external: 1 });
    expect(s.dropSenders).toEqual({ own: 1, external: 2 });
  });
  it('classifies Pockets by deploy block against the v2 release and counts v1-era ones still holding QOR', async () => {
    const d = [ev({ pocket: A(10), owner: A(1) }, V2_RELEASE_BLOCK - 1n), ev({ pocket: A(11), owner: A(2) }, V2_RELEASE_BLOCK - 5n), ev({ pocket: A(12), owner: A(3) }, V2_RELEASE_BLOCK)];
    const k = await keyEras(d, own, async (a) => (a === A(11) ? 5n : 0n));
    expect(k.v1Era).toMatchObject({ total: 2, own: 1, external: 1, stillHoldingQor: 1, stillHoldingExternal: 1 });
    expect(k.v2Era).toMatchObject({ total: 1, own: 0, external: 1 });
  });
  it('reports both instances and never mixes them with v3', async () => {
    const r: V4Reader = { head: async () => 100n, balance: async () => 0n, events: async () => [] };
    const s: any = await getV4Stats(r, own);
    expect(s.prod.pockets).toBe(0);
    expect(s.lab.drops.created).toBe(0);
  });
});

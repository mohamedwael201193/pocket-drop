import { describe, expect, it, vi } from 'vitest';
vi.mock('../src/lib/chain', () => ({ pub: {} }));
vi.mock('../src/lib/claim4', () => ({ keyStatus: async () => null }));
import { compareWithApi, keyEras, V2_RELEASE_BLOCK, type EnvStats } from '../src/lib/radar';
import own from '../src/data/own.json';

const ownAddr = Object.values((own as { accounts: Record<string, string> }).accounts)[0];
const ext = '0x00000000000000000000000000000000000000e1';

describe('legacy-key telemetry', () => {
  it('splits deployed Pockets at the v2 release block and counts v1-era ones still holding QOR', async () => {
    const d = [
      { args: { pocket: '0x01', owner: ownAddr }, blockNumber: V2_RELEASE_BLOCK - 1n },
      { args: { pocket: '0x02', owner: ext }, blockNumber: V2_RELEASE_BLOCK - 9n },
      { args: { pocket: '0x03', owner: ext }, blockNumber: V2_RELEASE_BLOCK },
    ];
    const k = await keyEras(d, async (a) => (a === '0x02' ? 1n : 0n));
    expect(k.v1Era).toEqual({ total: 2, own: 1, external: 1, stillHoldingQor: 1, stillHoldingExternal: 1 });
    expect(k.v2Era).toEqual({ total: 1, own: 0, external: 1 });
  });
});

describe('API agreement', () => {
  const mine = { pockets: 3, drops: { created: 2, claimed: 1 }, pools: { created: 1 }, pocketsOwn: { own: 2, external: 1 } } as unknown as EnvStats;
  it('agrees when the API counts the same and names every differing field otherwise', () => {
    expect(compareWithApi(mine, { pockets: 3, drops: { created: 2, claimed: 1 }, pools: { created: 1 }, pocketsOwn: { own: 2, external: 1 } })).toEqual([]);
    expect(compareWithApi(mine, { pockets: 4, drops: { created: 2, claimed: 0 }, pools: { created: 1 }, pocketsOwn: { own: 2, external: 1 } })).toEqual(['pockets', 'drops claimed']);
    expect(compareWithApi(mine, undefined)).toEqual(['missing']);
  });
});

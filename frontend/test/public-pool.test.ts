import { describe, expect, it } from 'vitest';
import { parseLinkId } from '../src/lib/claim4';
import { parseClaimFragment } from '../src/lib/protocol';
import { isPublicPool, PUBLIC_POOL, PUBLIC_POOL_ENV, PUBLIC_POOL_ID, PUBLIC_POOL_PATH } from '../src/lib/publicPool';

describe('public pool config', () => {
  it('describes a v5.2 prod pool and a bearer path the claim page can parse', () => {
    expect(PUBLIC_POOL_PATH).toBe('/pool');
    expect(PUBLIC_POOL.env).toBe('prod');
    expect(PUBLIC_POOL.generation).toBe('v5.2');
    expect(PUBLIC_POOL.poolId).toBe(5);
    expect(PUBLIC_POOL.slots).toBe(20);
    expect(PUBLIC_POOL.perSlotQor).toBe('0.5');
    const hashIdx = PUBLIC_POOL.path.indexOf('#');
    const id = PUBLIC_POOL.path.slice(0, hashIdx).split('/').pop() ?? '';
    const parsed = parseLinkId(id);
    expect(parsed).toEqual({ v: 4, env: 'prod', id: 5n });
    expect(parseClaimFragment(PUBLIC_POOL.path.slice(hashIdx))).toBeInstanceOf(Uint8Array);
    expect(isPublicPool(PUBLIC_POOL_ENV, PUBLIC_POOL_ID)).toBe(true);
    expect(isPublicPool('prod', 4n)).toBe(false);
    expect(isPublicPool('prodV4', 5n)).toBe(false);
  });
});

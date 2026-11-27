import pub from '../data/public-pool.json';

/** The team's current public Drop Pool (v5.2 prod). /pool (no id) opens this. */
export const PUBLIC_POOL = pub;
export const PUBLIC_POOL_PATH = '/pool';
export const PUBLIC_POOL_ENV = pub.env as 'prod';
export const PUBLIC_POOL_ID = BigInt(pub.poolId);
export const isPublicPool = (env: string, id: bigint) => env === pub.env && id === PUBLIC_POOL_ID;

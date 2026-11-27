// Landing-only constants. Kept free of viem and of the app's config module so the landing chunk stays small.
import { PUBLIC_POOL_PATH } from '../lib/publicPool';

export const API_BASE: string = import.meta.env.VITE_API_BASE || 'https://pocket-drop-api.vercel.app';
export const EXPLORER = 'https://explore.qore.network';
export const SOURCE_URL = 'https://github.com/mohamedwael201193/pocket-drop';
/** Cosmos hashes open in the explorer; EVM hashes (0x...) open the app's /check page, because the explorer indexes Cosmos
 *  transactions only and returns "Transaction not found" for an EVM hash. */
export const explorerTx = (h: string) => (/^0x[0-9a-fA-F]{64}$/.test(h) ? `/check/${h}` : `${EXPLORER}/tx/${h}`);
/** The team-hosted public Drop Pool: "Claim a sample slot" opens /pool, which resolves the current pool. */
export const SAMPLE_PATH: string = PUBLIC_POOL_PATH;
/** Dashboard home. */
export const APP_PATH = '/app';

// Landing-only constants. Kept free of viem and of the app's config module so the landing chunk stays small.
import sample from '../data/sample-pool.json';

export const API_BASE: string = import.meta.env.VITE_API_BASE || 'https://pocket-drop-api.vercel.app';
export const EXPLORER = 'https://explore.qore.network';
export const SOURCE_URL = 'https://github.com/mohamedwael201193/pocket-drop';
/** Cosmos hashes open in the explorer; EVM hashes (0x...) open the app's /check page, because the explorer indexes Cosmos
 *  transactions only and returns "Transaction not found" for an EVM hash. */
export const explorerTx = (h: string) => (/^0x[0-9a-fA-F]{64}$/.test(h) ? `/check/${h}` : `${EXPLORER}/tx/${h}`);
/** The team-hosted sample Drop Pool (data/sample-pool.json): "Claim a sample slot" opens it directly. */
export const SAMPLE_PATH: string = sample.path;
/** Dashboard home. */
export const APP_PATH = '/app';

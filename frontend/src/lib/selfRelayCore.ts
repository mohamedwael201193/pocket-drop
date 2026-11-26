// "Relay it yourself", the pure part (no SDK, unit-tested). PocketRouter.relay / deployAndRelay have no caller check: the
// authority is the ML-DSA-87 signature inside the forwarded call, so the user's own account may submit it instead of the
// Pocket Drop relayer. On Diana every EVM tx needs a live EVM window, so the account opens its OWN window, hybrid-signed,
// scoped to the one router, with a short expiry and small tx and value caps (selfRelay.ts does the chain work).
import { encodeFunctionData, type Hex } from 'viem';
import { routerAbi } from './abi4';

export interface RouteBody {
  env: 'prod' | 'lab' | 'prodV51' | 'labV51' | 'prodV5' | 'labV5' | 'prodV4' | 'labV4'; target?: string; data: string;
  pocket?: { owner: string; guardians: string[]; threshold: number; dailyLimit: string; userSalt: string };
}

/** The window the user opens for one self-relay: router only, about 9 minutes, 3 txs. */
export const SELF_WINDOW = { blocks: 400, maxTxs: 3, txGasCap: 1_200_000n } as const;
/** Fees of the native txs a self-relay may need (uqor): PoP key registration and the window open. */
export const NATIVE_FEE_UQOR = { register: 60_000n, openWindow: 100_000n } as const;
const UQOR_WEI = 10n ** 12n;

/** Router calldata for a route body: relay(target, data) when the target exists, else deployAndRelay(config, data). */
export function routerCalldata(p: RouteBody): Hex {
  if (p.target) return encodeFunctionData({ abi: routerAbi, functionName: 'relay', args: [p.target as Hex, p.data as Hex] });
  if (!p.pocket) throw new Error('A route needs a target or a Pocket config.');
  const c = p.pocket;
  return encodeFunctionData({ abi: routerAbi, functionName: 'deployAndRelay', args: [c.owner as Hex, c.guardians as Hex[], c.threshold, BigInt(c.dailyLimit), c.userSalt as Hex, p.data as Hex] });
}

/** Wei the account needs before a self-relay: the native fees still to pay plus the EVM gas of one tx at the cap. */
export function selfRelayNeedWei(o: { registered: boolean; windowReady: boolean; gasPriceWei: bigint }): bigint {
  const native = (o.registered ? 0n : NATIVE_FEE_UQOR.register) + (o.windowReady ? 0n : NATIVE_FEE_UQOR.openWindow);
  return native * UQOR_WEI + SELF_WINDOW.txGasCap * o.gasPriceWei;
}

/** A live window this account can reuse: router only, at least one tx left. */
export function windowReusable(w: { live: boolean; allowedTargets?: string[]; remainingTxs?: bigint | number | string } | null, router: string): boolean {
  if (!w || !w.live) return false;
  const t = (w.allowedTargets ?? []).map((a) => a.toLowerCase());
  return t.length === 1 && t[0] === router.toLowerCase() && BigInt(w.remainingTxs ?? 0) > 0n;
}

/** Errors that mean "the relayer cannot do it right now" (down, paused, rate limited, timed out), as opposed to a request
 *  the chain would refuse anyway (422: the simulation reverted; 400: bad input). Only these offer self-relay. */
export function relayerUnavailable(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const x = e as { name?: string; status?: number };
  if (x.name === 'TypeError' || x.name === 'AbortError' || x.name === 'TimeoutError') return true; // network failure or our timeout
  if (x.name === 'RelayerWindowUnavailable' || x.name === 'RateLimited' || x.name === 'RelayerLow' || x.name === 'RelayerUnavailable') return true;
  return typeof x.status === 'number' && x.status >= 500;
}

const PREF = 'pd.selfRelay.v1';
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const store = (): Store | null => { try { return globalThis.localStorage ?? null; } catch { return null; } };
/** Advanced setting: always submit from this browser's own account, never through the relayer. */
export const selfRelayPreferred = (s: Store | null = store()): boolean => s?.getItem(PREF) === '1';
export const setSelfRelayPreferred = (on: boolean, s: Store | null = store()) => { if (on) s?.setItem(PREF, '1'); else s?.removeItem(PREF); };

/** Ask-the-user host, mounted once by the app shell (components/selfRelayOffer.tsx). No host (tests, scripts) = decline. */
export interface OfferRequest { reason: string; resolve: (ok: boolean) => void }
let host: ((r: OfferRequest) => void) | null = null;
export function setSelfRelayHost(h: (r: OfferRequest) => void): () => void { host = h; return () => { if (host === h) host = null; }; }
export function offerSelfRelay(reason: string): Promise<boolean> {
  const h = host;
  if (!h) return Promise.resolve(false);
  return new Promise((resolve) => h({ reason, resolve }));
}

/** Relayer first; if it is unavailable, offer the user's own submission. With the preference on, skip the relayer. */
export async function routeWithFallback<T>(p: RouteBody, viaRelayer: (p: RouteBody) => Promise<T>, viaSelf: (p: RouteBody) => Promise<T>, opts: { preferred?: boolean; offer?: (reason: string) => Promise<boolean> } = {}): Promise<T> {
  if (opts.preferred ?? selfRelayPreferred()) return viaSelf(p);
  try { return await viaRelayer(p); }
  catch (e) {
    if (!relayerUnavailable(e)) throw e;
    const reason = e instanceof Error ? e.message : 'The relayer did not answer.';
    if (!(await (opts.offer ?? offerSelfRelay)(reason))) throw e;
    return viaSelf(p);
  }
}

// QoreX wallet (window.qorex). Facts from the published provider docs and the signArbitrary spike (work/spike-qorex/RESULTS.md):
//  - native.enable / getKey / signAndBroadcast / signArbitrary exist; the EVM provider answers eth_requestAccounts only
//    (no eth_sendTransaction, no personal_sign), so QoreX cannot sign the v3 contract transactions today.
//  - What QoreX does here: identity, balance, funding by a native MsgSend, and (when advertised) message signing.
import { MsgSend } from 'cosmjs-types/cosmos/bank/v1beta1/tx';
import type { Hex } from 'viem';
import { COSMOS_CHAIN_ID, COSMOS_REST } from './config';
import { pub } from './chain';

export const QOREX_CHAIN = COSMOS_CHAIN_ID;
export const QOREX_MAINNET_NOTE = 'QoreX is on mainnet here. Pocket Drop runs on Diana testnet. Switch QoreX to testnet in the mobile app (developer mode, then testnet), or use this browser.';

interface NativeKey { bech32Address: string }
interface NativeProvider {
  capabilities?: readonly string[];
  enable(chainId: string): Promise<unknown>;
  getKey(chainId: string): Promise<NativeKey>;
  signAndBroadcast?(req: { chainId: string; messages: { typeUrl: string; value: Uint8Array }[]; memo?: string; gasLimit?: number }): Promise<{ txHash: string; code: number; height?: number; shield?: string }>;
  signArbitrary?(chainId: string, signer: string, data: string | Uint8Array): Promise<unknown>;
}
interface EvmProvider { request(a: { method: string; params?: unknown[] }): Promise<unknown> }
interface QorexGlobal { native?: NativeProvider; evm?: EvmProvider }

const root = (): QorexGlobal | undefined => (typeof window === 'undefined' ? undefined : (window as unknown as { qorex?: QorexGlobal }).qorex);

export interface QorexIdentity {
  cosmos: string;
  evm: Hex | null;
  capabilities: string[];
  canFund: boolean;
  canSignMessage: boolean;
}

const LS = 'pd.qorex.v1';
export const rememberedQorex = (): string | null => { try { return localStorage.getItem(LS); } catch { return null; } };
const remember = (v: string | null) => { try { if (v) localStorage.setItem(LS, v); else localStorage.removeItem(LS); } catch { /* ignore */ } };

/** The extension injects after page load on some browsers, so wait briefly. */
export async function detectQorex(waitMs = 1500): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < waitMs) { if (root()?.native) return true; await new Promise((r) => setTimeout(r, 150)); }
  return !!root()?.native;
}

async function evmAddress(prompt: boolean): Promise<Hex | null> {
  const evm = root()?.evm;
  if (!evm) return null;
  try {
    const r = (await evm.request({ method: prompt ? 'eth_requestAccounts' : 'eth_accounts' })) as string[];
    return r?.[0] && /^0x[0-9a-fA-F]{40}$/.test(r[0]) ? (r[0] as Hex) : null;
  } catch { return null; }
}

async function build(cosmos: string, prompt: boolean): Promise<QorexIdentity> {
  const n = root()!.native!;
  const capabilities = [...(n.capabilities ?? [])];
  return {
    cosmos, evm: await evmAddress(prompt), capabilities,
    canFund: capabilities.includes('signAndBroadcast') && typeof n.signAndBroadcast === 'function',
    canSignMessage: capabilities.includes('signArbitrary') && typeof n.signArbitrary === 'function',
  };
}

/** Asks the user to connect (a QoreX prompt). Throws a plain-language Error on refusal. */
export async function connectQorex(): Promise<QorexIdentity> {
  if (!(await detectQorex())) throw new Error('QoreX was not found in this browser. On a phone, open this page from the QoreX in-app browser.');
  const n = root()!.native!;
  try {
    const evm = root()?.evm;
    if (evm) { try { const c = (await evm.request({ method: 'eth_chainId' })) as string; if (c && parseInt(c, 16) !== 9800) throw new Error(QOREX_MAINNET_NOTE); } catch (e) { if ((e as Error).message === QOREX_MAINNET_NOTE) throw e; } }
    await n.enable(QOREX_CHAIN); const k = await n.getKey(QOREX_CHAIN); remember(k.bech32Address); return await build(k.bech32Address, true); }
  catch (e) {
    const m = (e as Error).message ?? String(e);
    if (m === QOREX_MAINNET_NOTE) throw e;
    if (/rejected/i.test(m)) throw new Error('You declined the connection in QoreX.');
    if (/locked/i.test(m)) throw new Error('QoreX is locked. Unlock it, then try again.');
    if (/network|chain/i.test(m)) throw new Error(QOREX_MAINNET_NOTE);
    throw new Error(`QoreX: ${m.replace(/^QoreX:\s*/, '')}`);
  }
}

/** Silent re-connect on page load: only succeeds if the site is already connected (no prompt). */
export async function restoreQorex(): Promise<QorexIdentity | null> {
  const saved = rememberedQorex();
  if (!saved || !(await detectQorex(2500))) return null;
  if (!(await evmAddress(false))) return null;
  try { const k = await root()!.native!.getKey(QOREX_CHAIN); remember(k.bech32Address); return await build(k.bech32Address, false); } catch { return null; }
}
export const forgetQorex = () => remember(null);

/** Native QOR balance in wei (18 decimals). Uses the EVM address when QoreX gave one, else the Cosmos bank balance (6 decimals). */
export async function qorexBalanceWei(id: QorexIdentity): Promise<bigint> {
  if (id.evm) return pub.getBalance({ address: id.evm });
  const r = await fetch(`${COSMOS_REST}/cosmos/bank/v1beta1/balances/${id.cosmos}`);
  if (!r.ok) throw new Error(`Balance lookup failed (HTTP ${r.status})`);
  const j = (await r.json()) as { balances?: { denom: string; amount: string }[] };
  return BigInt(j.balances?.find((b) => b.denom === 'uqor')?.amount ?? '0') * 10n ** 12n;
}

/** Fund a Pocket with a normal native send signed in QoreX. `uqor` is the 6-decimal amount. */
export async function fundFromQorex(id: QorexIdentity, toCosmos: string, uqor: bigint): Promise<{ txHash: string; shield?: string }> {
  const n = root()?.native;
  if (!n?.signAndBroadcast || !id.canFund) throw new Error('This QoreX build cannot send transactions from a web page.');
  const value = MsgSend.encode(MsgSend.fromPartial({ fromAddress: id.cosmos, toAddress: toCosmos, amount: [{ denom: 'uqor', amount: uqor.toString() }] })).finish();
  try {
    const r = await n.signAndBroadcast({ chainId: QOREX_CHAIN, messages: [{ typeUrl: '/cosmos.bank.v1beta1.MsgSend', value }], memo: 'Fund Pocket Drop account', gasLimit: 200000 });
    if (r.code !== 0) throw new Error(`The send was rejected by the chain (code ${r.code}).`);
    return { txHash: r.txHash, shield: r.shield };
  } catch (e) {
    const m = (e as Error).message ?? String(e);
    if (/rejected/i.test(m)) throw new Error('You declined the send in QoreX.');
    throw new Error(m.replace(/^QoreX:\s*/, ''));
  }
}

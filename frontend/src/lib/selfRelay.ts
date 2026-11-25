// "Relay it yourself", the chain part. The user's own browser account submits the signed call to the PocketRouter, so a
// claim or a spend works while the Pocket Drop relayer is down, slow or out of gas. Steps, all from this browser:
//   1. the ML-DSA-87 key is registered with proof of possession (once; classical-signed, about 0.06 QOR);
//   2. a hybrid-signed (secp256k1 + ML-DSA-87) MsgOpenEVMWindow scoped to the one router, about 9 minutes, 3 txs (0.1 QOR),
//      unless a live router-only window with a tx left already exists;
//   3. an EVM tx to router.relay / deployAndRelay from the account's own address, after a gas estimate (a call that would
//      revert stops here and sends nothing).
// The native txs (1, 2) are broadcast through the app's key-less /rpc proxy because Diana's public REST/RPC do not send CORS
// headers; the proxy holds no keys. The EVM tx goes straight to the public EVM RPC. Needs QOR in the account for fees.
import { createWalletClient, http, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { dianaChain, EVM_RPC, txUrl } from './config';
import { pub } from './chain';
import { loadRoot } from './identity';
import { INST } from './v4';
import type { RouteResult } from './api';
import { SELF_WINDOW, routerCalldata, selfRelayNeedWei, windowReusable, type RouteBody } from './selfRelayCore';

export class SelfRelayError extends Error {
  constructor(message: string, readonly code: 'NoKey' | 'NoGas' | 'WouldRevert' | 'Reverted', readonly detail?: Record<string, string>) { super(message); this.name = 'SelfRelayError'; }
}

export type SelfRelayStep = 'register' | 'window' | 'submit' | 'done';
let onStep: ((s: SelfRelayStep, hash?: string) => void) | null = null;
/** Progress listener for the offer dialog (one at a time). */
export const setSelfRelayProgress = (f: typeof onStep) => { onStep = f; };

export async function selfRelayRoute(p: RouteBody): Promise<RouteResult> {
  const root = loadRoot();
  if (!root) throw new SelfRelayError('This browser holds no key, so it cannot submit for itself. Create or import your key first.', 'NoKey');
  const rec = await import('./recipient');
  const acct = await rec.deriveFromRoot(root);
  const router = INST[p.env].router as Hex;
  const data = routerCalldata(p);
  const me = acct.evm as Hex;

  const [ks, w, gp, bal] = await Promise.all([rec.keyStatus(me), rec.windowScope(acct), pub.getGasPrice(), pub.getBalance({ address: me })]);
  const ready = windowReusable(w, router);
  const gasPrice = (gp * 13n) / 10n;
  const need = selfRelayNeedWei({ registered: ks.registered && ks.possessionProven, windowReady: ready, gasPriceWei: gasPrice });
  if (bal < need) throw new SelfRelayError(`Your account ${me} needs about ${Number(need) / 1e18} QOR for fees to submit by itself; it holds ${Number(bal) / 1e18} QOR.`, 'NoGas', { address: me, needWei: need.toString(), haveWei: bal.toString() });

  if (!(ks.registered && ks.possessionProven)) { onStep?.('register'); onStep?.('register', await rec.registerKey(acct)); }
  if (!ready) { onStep?.('window'); onStep?.('window', await rec.openRouterWindow(acct, router, SELF_WINDOW)); }

  onStep?.('submit');
  let gas: bigint;
  try { gas = await pub.estimateGas({ account: me, to: router, data }); }
  catch (e) { throw new SelfRelayError(`The chain would refuse this call, so nothing was sent: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`, 'WouldRevert'); }
  const wallet = createWalletClient({ account: privateKeyToAccount(acct.privateKey as Hex), chain: dianaChain, transport: http(EVM_RPC) });
  const hash = await wallet.sendTransaction({ to: router, data, gas: (gas * 13n) / 10n, type: 'legacy', gasPrice });
  const rc = await pub.waitForTransactionReceipt({ hash, timeout: 90_000 });
  if (rc.status !== 'success') throw new SelfRelayError(`Your transaction ${hash} was mined but reverted.`, 'Reverted', { hash });
  onStep?.('done', hash);
  return { txHash: hash, status: rc.status, explorer: txUrl(hash), gasUsed: rc.gasUsed.toString(), env: p.env, action: 'self-relay', lane: 'evm' };
}

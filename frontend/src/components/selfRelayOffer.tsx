// "Relay it yourself": shown when the relayer is down, slow or out of gas. It explains what the user's own account will do
// (open a short window scoped to the one router, then submit the same signed call) and what it costs, and asks first.
import { useEffect, useState } from 'react';
import { selfRelayPreferred, setSelfRelayHost, setSelfRelayPreferred, type OfferRequest } from '../lib/selfRelayCore';
import { setSelfRelayProgress, type SelfRelayStep } from '../lib/selfRelay';
import { txUrl } from '../lib/config';
import { Button } from './ui';

const STEP_TEXT: Record<SelfRelayStep, string> = {
  register: 'Registering your quantum-safe key (once)',
  window: 'Opening your own window, scoped to the Pocket Drop router only',
  submit: 'Submitting the signed call from your own account',
  done: 'Done',
};

/** Progress of a self-relay (also when the Advanced setting is on and no dialog was shown). */
export function SelfRelayProgress() {
  const [steps, setSteps] = useState<{ s: SelfRelayStep; hash?: string }[]>([]);
  useEffect(() => {
    setSelfRelayProgress((s, hash) => setSteps((x) => {
      const base = x.length && x[x.length - 1].s === 'done' ? [] : x; // a new self-relay starts a new list
      return [...base.filter((y) => y.s !== s), { s, hash }];
    }));
    return () => setSelfRelayProgress(null);
  }, []);
  if (!steps.length || steps[steps.length - 1].s === 'done') return null;
  return (
    <div role="status" className="fixed bottom-4 left-1/2 z-[79] w-[min(92vw,28rem)] -translate-x-1/2 rounded-2xl border border-zinc-200 bg-white p-4 text-sm shadow-xl" data-testid="self-relay-progress">
      <p className="font-semibold text-zinc-900">Relaying it yourself</p>
      <ul className="mt-2 space-y-1 text-zinc-700">
        {steps.map((x, i) => <li key={i}>{STEP_TEXT[x.s]}{x.hash && <> · <a className="underline" href={txUrl(x.hash)} target="_blank" rel="noreferrer">tx</a></>}</li>)}
      </ul>
    </div>
  );
}

export function SelfRelayOfferHost() {
  const [req, setReq] = useState<OfferRequest | null>(null);
  useEffect(() => setSelfRelayHost((r) => setReq(r)), []);
  const answer = (ok: boolean) => { req?.resolve(ok); setReq(null); };
  return (
    <>
      <SelfRelayProgress />
      {req && (
        <div className="fixed inset-0 z-[81] flex items-end justify-center sm:items-center sm:p-6">
          <div className="absolute inset-0 bg-zinc-950/40" onClick={() => answer(false)} aria-hidden />
          <div role="dialog" aria-modal="true" aria-labelledby="self-relay-title" data-testid="self-relay-offer" className="relative w-full max-w-lg rounded-t-[28px] border border-zinc-200 bg-white p-5 shadow-2xl sm:rounded-[28px]">
            <h2 id="self-relay-title" className="font-display text-xl font-semibold text-zinc-900">The relayer is not answering. Relay it yourself?</h2>
            <p className="mt-2 text-sm text-zinc-600" data-testid="self-relay-reason">{req.reason}</p>
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-zinc-700">
              <li>Your own account submits the call you already signed. Your ML-DSA-87 signature is still the only thing that can move your money.</li>
              <li>It opens a window for your account that reaches only the Pocket Drop router, for about 9 minutes and at most 3 transactions.</li>
              <li>You pay the fees from your account: about 0.1 QOR for the window, the gas of the call, and 0.06 QOR once if your key is not registered yet. A delivery fee the link pays goes to whoever submits, which is you.</li>
            </ul>
            <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="secondary" onClick={() => answer(false)} data-testid="self-relay-decline">Wait for the relayer</Button>
              <Button onClick={() => answer(true)} data-testid="self-relay-accept">Relay it myself</Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** Advanced setting on /pocket: always submit from this browser's own account (never through the relayer). */
export function SelfRelaySetting() {
  const [on, setOn] = useState(selfRelayPreferred());
  return (
    <div className="space-y-3 text-sm text-zinc-700" data-testid="self-relay-setting">
      <p>Every Pocket action is a call you sign with your ML-DSA-87 key. Normally the Pocket Drop relayer submits it and pays the gas. If the relayer is down or slow, the app offers to submit it from your own account instead. Turn this on to always do that.</p>
      <p>Your account then opens its own window that reaches only the Pocket Drop router, for about 9 minutes and 3 transactions, hybrid-signed. You pay the fees (about 0.1 QOR per window plus gas).</p>
      <label className="flex items-center gap-2 font-medium text-zinc-900">
        <input type="checkbox" checked={on} onChange={(e) => { setSelfRelayPreferred(e.target.checked); setOn(e.target.checked); }} data-testid="self-relay-toggle" />
        Always relay it myself
      </label>
    </div>
  );
}

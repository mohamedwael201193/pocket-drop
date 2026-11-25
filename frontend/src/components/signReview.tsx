// The signing confirmation: shown before every owner intent is signed. It reads the intent back in plain words (built by
// lib/clearsign from the same fields as the digest) and shows the exact text the ML-DSA-87 key will sign.
import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { setReviewHost, type ReviewRequest } from '../lib/signReview';
import { ShieldCheck, X } from './icons';
import { Button, CopyButton, cx } from './ui';

const KEY_LINES = new Set(['Recipient', 'Amount', 'Link amount', 'Total leaving the Pocket', 'Per claimer', 'Slots', 'New daily limit', 'Guardians']);
const isLong = (v: string) => /^0x[0-9a-fA-F]{40,}$/.test(v);

export function SignReviewHost() {
  const [req, setReq] = useState<ReviewRequest | null>(null);
  useEffect(() => setReviewHost((r) => setReq(r)), []);
  const answer = (ok: boolean) => { req?.resolve(ok); setReq(null); };
  useEffect(() => {
    if (!req) return;
    const t = setTimeout(() => document.querySelector<HTMLButtonElement>('[data-testid=sign-review-approve]')?.focus(), 60);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') answer(false); };
    window.addEventListener('keydown', onKey);
    return () => { clearTimeout(t); window.removeEventListener('keydown', onKey); };
  }, [req]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <AnimatePresence>
      {req && (
        <motion.div key="sign-review" className="fixed inset-0 z-[80] flex items-end justify-center sm:items-center sm:p-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <div className="absolute inset-0 bg-zinc-950/40 backdrop-blur-[3px]" onClick={() => answer(false)} aria-hidden />
          <motion.div role="dialog" aria-modal="true" aria-labelledby="sign-review-title" data-testid="sign-review"
            className="relative flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-[28px] border border-zinc-200 bg-white shadow-2xl sm:rounded-[28px]"
            initial={{ y: 40, scale: 0.98 }} animate={{ y: 0, scale: 1 }} exit={{ y: 40, scale: 0.98 }} transition={{ type: 'spring', stiffness: 420, damping: 36 }}>
            <div className="flex items-start gap-3 border-b border-zinc-100 px-5 pb-4 pt-5">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-accent"><ShieldCheck className="h-5 w-5" /></span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium uppercase tracking-[0.14em] text-zinc-500">Check before you sign</p>
                <h2 id="sign-review-title" className="font-display text-xl font-semibold text-zinc-900" data-testid="sign-review-title">{req.clear.title}</h2>
              </div>
              <button type="button" onClick={() => answer(false)} aria-label="Cancel" className="flex h-10 w-10 items-center justify-center rounded-full text-zinc-500 hover:bg-zinc-100"><X className="h-5 w-5" /></button>
            </div>
            <div className="overflow-y-auto px-5 py-4">
              <p className="text-sm text-zinc-600">Your quantum-safe key (ML-DSA-87) signs exactly this. The chain checks the signature with its post-quantum precompile, so nobody can change these values on the way.</p>
              <dl className="mt-3 divide-y divide-zinc-100 rounded-2xl border border-zinc-200" data-testid="sign-review-lines">
                {req.clear.lines.map((l) => (
                  <div key={l.k} className={cx('grid grid-cols-[minmax(7rem,38%)_1fr] gap-3 px-3 py-2 text-sm', KEY_LINES.has(l.k) && 'bg-emerald-50/50')}>
                    <dt className="text-zinc-600">{l.k}</dt>
                    <dd className={cx('min-w-0 text-zinc-900', isLong(l.v) ? 'break-all font-mono text-xs leading-5' : 'break-words', KEY_LINES.has(l.k) && 'font-semibold')}>{l.v}</dd>
                  </div>
                ))}
              </dl>
              <details className="mt-3 text-xs text-zinc-600" data-testid="sign-review-raw">
                <summary className="cursor-pointer select-none font-medium text-zinc-700">The exact text that gets signed</summary>
                <p className="mt-2">The digest below is recomputed from the lines above. If any line were different, this hash would be different and the chain would refuse the signature.</p>
                <code className="mt-2 block break-all rounded-xl bg-zinc-50 p-2 font-mono text-[11px] text-zinc-800" data-testid="sign-review-text">{req.clear.signedText}</code>
                <div className="mt-2"><CopyButton text={req.clear.signedText} label="Copy text" /></div>
              </details>
            </div>
            <div className="flex flex-col-reverse gap-2 border-t border-zinc-100 px-5 pb-[calc(env(safe-area-inset-bottom)+16px)] pt-4 sm:flex-row sm:justify-end sm:pb-4">
              <Button variant="secondary" onClick={() => answer(false)} data-testid="sign-review-cancel">Cancel</Button>
              <Button onClick={() => answer(true)} data-testid="sign-review-approve">Sign and send</Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

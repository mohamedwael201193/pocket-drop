import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Droplets, KeyRound, MessageCircle, CheckCircle2 } from 'lucide-react';
import { PhoneFrame } from '../components/PhoneFrame';
import { Notice, SourceBadge, cx } from '../components/ui';
import { fmtQor } from '../lib/chain';
import { fingerprint } from '../lib/protocol';
import { useLatestDrop } from '../lib/queries';

/** Accepts a full link, or "/c/17#k=<64 hex>", and returns the in-app path. */
export function parseClaimInput(raw: string): string | null {
  const m = /\/c\/(\d+)#k=([0-9a-fA-F]{64})\s*$/.exec(raw.trim());
  return m ? `/c/${m[1]}#k=${m[2].toLowerCase()}` : null;
}

export default function ClaimEntryPage() {
  const nav = useNavigate();
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [step, setStep] = useState(1);
  const { id, link } = useLatestDrop();
  const amount = link ? fmtQor(BigInt(link.amount)) : '…';
  const drip = link ? fmtQor(BigInt(link.drip)) : '…';
  const words = link?.recipientKeyHash ? fingerprint(link.recipientKeyHash).join(' · ') : '· · · ·';

  function open() {
    const p = parseClaimInput(text);
    if (!p) { setErr('That does not look like a Pocket Drop link. It ends with /c/NUMBER#k= and 64 characters.'); return; }
    setErr(null); nav(p);
  }
  const row = (n: number, icon: React.ReactNode, title: string, badges: [string, string, string]) => (
    <div className={cx('flex items-center justify-between rounded-xl border border-zinc-200 p-3', step >= n ? 'bg-white' : 'bg-white/60 opacity-75')}>
      <span className="flex items-center gap-2 font-medium">{icon} {n}. {title}</span>
      <span className={cx('font-mono text-[10px]', step >= n ? 'text-emerald-700' : 'text-zinc-500')}>{step > n || (n === 3 && step === 3) ? badges[2] : step === n ? badges[1] : badges[0]}</span>
    </div>
  );

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8" data-testid="claim-entry">
      <div className="grid items-center gap-8 lg:grid-cols-12">
        <div className="space-y-4 lg:col-span-5">
          <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-zinc-500">390×844 Mobile Experience</span>
          <h1 className="font-serif text-4xl text-zinc-900">What your friend sees when they tap the link</h1>
          <p className="text-sm leading-relaxed text-zinc-600">Browser generates an ML-DSA-87 keypair, binds via <code className="font-mono text-xs">POST /api/bind</code> so the drip lands, registers PoP, and settles the escrow.</p>

          <div className="rounded-3xl border border-zinc-200 bg-white/90 p-5 shadow-sm">
            <label htmlFor="claim-input" className="text-xs font-semibold text-zinc-900">Got a link? Paste it here</label>
            <p className="mt-0.5 text-[11px] text-zinc-500">Links from any chat app (WhatsApp, Telegram, SMS, email) work. Normally you just tap the link and this page is skipped.</p>
            <div className="mt-2 flex gap-2">
              <input id="claim-input" value={text} onChange={(e) => setText(e.target.value)} placeholder="https://…/c/17#k=…" data-testid="claim-input" className="min-w-0 flex-1 rounded-xl border border-zinc-300 bg-white px-3 py-2 font-mono text-xs" />
              <button type="button" onClick={open} data-testid="claim-open" className="rounded-full bg-zinc-900 px-4 py-2 text-xs font-medium text-white hover:bg-zinc-800">Open</button>
            </div>
            {err && <div className="mt-2"><Notice tone="error" testId="claim-input-error">{err}</Notice></div>}
          </div>

          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setStep(1)} className="rounded-full border border-zinc-300 px-3.5 py-2 text-xs font-medium hover:bg-stoneCard">Reset walkthrough</button>
            <button type="button" onClick={() => setStep((s) => Math.min(3, s + 1))} className="rounded-full bg-zinc-900 px-3.5 py-2 text-xs font-medium text-white">Next step</button>
            <SourceBadge kind="ILLUSTRATION" title="This phone is a walkthrough drawn from the latest real drop. It sends nothing to the chain." />
          </div>
        </div>

        <div className="flex justify-center lg:col-span-7">
          <PhoneFrame testId="walkthrough-phone">
            <div className="flex items-center justify-between">
              <span className="font-serif text-lg text-zinc-900">Pocket Drop</span>
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-[10px] font-medium text-emerald-800"><MessageCircle className="h-3 w-3" /> Chat link</span>
            </div>
            <div className="py-2 text-center">
              <div className="text-xs text-zinc-500">Walkthrough · amounts from drop #{id ?? '…'}</div>
              <div className="mt-1 font-serif text-4xl text-zinc-900" data-testid="walk-amount">{amount} QOR</div>
              <div className="mt-1 font-mono text-[11px] text-zinc-500">+ {drip} QOR gas drip included <SourceBadge kind="LIVE" /></div>
            </div>
            <div className="capsule-titanium rounded-2xl border border-zinc-300 p-4 text-center">
              <div className="mb-1 font-mono text-[10px] uppercase tracking-widest text-zinc-500">4-Word Verification Seal</div>
              <div className="font-mono text-sm font-bold uppercase tracking-wider text-zinc-900">{words}</div>
            </div>
            <div className="space-y-2 text-xs">
              {row(1, <KeyRound className="h-4 w-4 text-zinc-600" />, 'Browser ML-DSA-87 Key', ['Pending', 'Ready', 'Ready'])}
              {row(2, <Droplets className="h-4 w-4 text-zinc-600" />, 'Bind & Register PoP', ['Pending', 'Drip Landed', 'Done'])}
              {row(3, <CheckCircle2 className="h-4 w-4 text-zinc-600" />, 'Claim Escrow', ['Pending', 'Settled ✓', 'Settled ✓'])}
            </div>
            <button type="button" onClick={() => setStep((s) => Math.min(3, s + 1))} className="w-full rounded-full bg-zinc-900 py-3 text-xs font-semibold text-stone-100 transition-all hover:bg-zinc-800">
              {step === 1 ? 'Bind & Receive Drip →' : step === 2 ? 'Sign & Claim QOR →' : 'Walkthrough complete ✓'}
            </button>
            <p className="text-center text-[10px] text-zinc-400">Illustration only. Real claims happen on the link itself.</p>
          </PhoneFrame>
        </div>
      </div>
    </div>
  );
}

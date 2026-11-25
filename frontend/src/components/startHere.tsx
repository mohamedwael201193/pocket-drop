// First-run guide on the Overview: three steps, each with one obvious action, ticked from LIVE state
// (Pocket balance from the chain, links from contract logs) and from this browser (drill visited).
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, Check, Gift, KeyRound, Send, X } from './icons';
import { motionOk } from './alive';
import { cx } from './ui';
import { useAccount, usePocketView } from '../lib/account';
import { useMyLinks } from '../lib/hooks4';
import sample from '../data/sample-pool.json';
import { drillSeen, hideStartHere, startHereHidden } from '../lib/firstRun';


export function StartHere() {
  const a = useAccount();
  const { data: pv } = usePocketView();
  const { links } = useMyLinks();
  const [hidden, setHidden] = useState(startHereHidden);
  const hasQor = !!pv && pv.balance > 0n;
  const sent = links.length > 0;
  const steps = [
    { key: 'qor', Icon: Gift, title: 'Get free testnet QOR', done: hasQor || sent,
      body: 'Open the team-hosted sample pool. It makes your quantum-safe key and your Pocket in this browser and pays a slot into it. No wallet, no sign-up.',
      cta: { to: sample.path, label: a.root ? 'Take a sample slot' : 'Start with the sample' } },
    { key: 'send', Icon: Send, title: 'Send QOR through a link', done: sent,
      body: 'Pick an amount, check what you sign, and share the link in any chat. Your friend opens it and the QOR lands in a Pocket made for them.',
      cta: { to: '/send', label: 'Create a link' } },
    { key: 'drill', Icon: KeyRound, title: 'Try to steal it', done: drillSeen(),
      body: 'Five real Pockets have their classical keys published. Try to move their QOR: only the post-quantum key can.',
      cta: { to: '/qday', label: 'Open the Q-Day drill' } },
  ];
  const doneN = steps.filter((s) => s.done).length;
  const next = steps.findIndex((s) => !s.done);
  if (hidden || next === -1) return null;
  const anim = motionOk();
  return (
    <motion.section data-testid="start-here" aria-labelledby="start-here-title"
      className="relative mb-4 overflow-hidden rounded-[22px] border border-emerald-200/70 bg-gradient-to-br from-white via-white to-emerald-50/70 p-5 sm:p-6"
      initial={anim ? { opacity: 0, y: 14 } : false} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-emerald-800">Start here · {doneN} of 3 done</p>
          <h2 id="start-here-title" className="mt-1 font-display text-xl font-semibold tracking-[-0.02em] text-zinc-950 sm:text-2xl">Three steps, about two minutes</h2>
        </div>
        <button type="button" onClick={() => { hideStartHere(); setHidden(true); }} aria-label="Hide the start guide"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-800" data-testid="start-here-hide"><X className="h-4 w-4" /></button>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-zinc-100" aria-hidden>
        <motion.div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-accent" initial={anim ? { width: 0 } : false} animate={{ width: `${Math.max(6, (doneN / 3) * 100)}%` }} transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1], delay: 0.2 }} />
      </div>
      <ol className="mt-4 grid gap-3 md:grid-cols-3">
        {steps.map((s, i) => {
          const current = i === next;
          return (
            <motion.li key={s.key} data-testid={`start-${s.key}`} data-done={s.done ? '1' : '0'}
              initial={anim ? { opacity: 0, y: 10 } : false} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 + 0.07 * i, duration: 0.45 }}
              className={cx('relative flex flex-col rounded-2xl border p-4 transition-shadow', current ? 'border-emerald-300 bg-white shadow-[0_12px_30px_-18px_rgba(15,107,74,.55)]' : s.done ? 'border-zinc-200/80 bg-white/60' : 'border-zinc-200/80 bg-white/80')}>
              <div className="flex items-center gap-2.5">
                <span className={cx('flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold', s.done ? 'bg-accent text-white' : current ? 'bg-emerald-50 text-accent ring-1 ring-emerald-200' : 'bg-zinc-100 text-zinc-500')}>
                  {s.done ? <Check className="h-4 w-4" /> : i + 1}
                </span>
                <h3 className={cx('text-[15px] font-semibold', s.done ? 'text-zinc-500 line-through decoration-zinc-300' : 'text-zinc-900')}>{s.title}</h3>
              </div>
              <p className={cx('mt-2 flex-1 text-sm leading-relaxed text-zinc-600', !current && 'hidden md:block')}>{s.body}</p>
              {!s.done && (
                <Link to={s.cta.to} data-testid={`start-${s.key}-cta`}
                  className={cx(!current && 'hidden md:inline-flex', 'press mt-3 inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl px-4 text-[15px] font-medium transition-colors', current ? 'bg-accent text-white shadow-[0_8px_20px_-8px_rgba(15,107,74,.6)] hover:bg-accentHover' : 'border border-zinc-200 bg-white text-zinc-800 hover:border-zinc-300')}>
                  <s.Icon className="h-4 w-4" />{s.cta.label}<ArrowRight className="h-4 w-4" />
                </Link>
              )}
            </motion.li>
          );
        })}
      </ol>
    </motion.section>
  );
}

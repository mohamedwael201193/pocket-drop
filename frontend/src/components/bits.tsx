import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { cx } from './ui';

/** Scroll-reveal (the design's reveal-card). Plays once. */
export function Reveal({ children, className, delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  return (
    <motion.div className={className} initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '0px 0px -8% 0px' }} transition={{ duration: 0.65, delay, ease: 'easeOut' }}>
      {children}
    </motion.div>
  );
}

/** Small live-data placeholder that keeps layout stable while the API answers. */
export function Dash({ className }: { className?: string }) {
  return <span className={cx('inline-block animate-pulseDot', className)} aria-label="loading">…</span>;
}

/** The design's section header: mono eyebrow, small sub-line, serif H2. */
export function SectionHead({ eyebrow, sub, title, className }: { eyebrow: string; sub?: string; title: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <p className="mb-2 text-sm font-medium text-zinc-600">{eyebrow}</p>
      {sub && <p className="mb-3 text-xs text-zinc-500">{sub}</p>}
      <h2 className="max-w-2xl font-serif text-4xl leading-[1.03] text-zinc-900 sm:text-5xl">{title}</h2>
    </div>
  );
}

/** Tiny pill used for source labels inside dark / titanium surfaces. */
export function SourcePill({ kind, className }: { kind: 'LIVE' | 'RECORDED' | 'ILLUSTRATION'; className?: string }) {
  const tone = kind === 'LIVE' ? 'border-emerald-400/60 bg-emerald-500/15 text-emerald-300' : kind === 'RECORDED' ? 'border-amber-400/60 bg-amber-500/15 text-amber-300' : 'border-zinc-400/60 bg-white/10 text-zinc-300';
  return <span className={cx('inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 font-mono text-xs font-semibold tracking-wider', tone, className)}>{kind}</span>;
}

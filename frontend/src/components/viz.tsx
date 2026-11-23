/**
 * Dashboard visuals: gauge ring, sparkline, bento card. Decoration only: the numbers they draw are passed in
 * from LIVE reads, and with reduced motion (or in an automated browser) they render the final state at once.
 */
import { useId, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { motionOk } from './alive';
import { cx } from './ui';
import { sparkPath } from '../lib/overview';

const EASE = [0.22, 1, 0.36, 1] as const;

export function GaugeRing({ pct, size = 128, stroke = 12, label, testId }: { pct: number | null; size?: number; stroke?: number; label?: ReactNode; testId?: string }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = pct === null ? 0 : Math.max(0, Math.min(100, pct));
  const anim = motionOk();
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} data-testid={testId} data-pct={pct ?? ''}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#E7EFEA" strokeWidth={stroke} />
        <motion.circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="url(#gauge-grad)" strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c} initial={{ strokeDashoffset: anim ? c : c * (1 - v / 100) }} animate={{ strokeDashoffset: c * (1 - v / 100) }}
          transition={{ duration: anim ? 1.3 : 0, ease: EASE, delay: anim ? 0.25 : 0 }} />
        <defs><linearGradient id="gauge-grad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#10B981" /><stop offset="1" stopColor="#0F6B4A" /></linearGradient></defs>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{label}</div>
    </div>
  );
}

export function Sparkline({ values, w = 220, h = 64, testId }: { values: number[]; w?: number; h?: number; testId?: string }) {
  const id = useId().replace(/:/g, '');
  const { line, area } = sparkPath(values, w, h);
  if (!line) return <div style={{ height: h }} />;
  const anim = motionOk();
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-16 w-full overflow-visible" aria-hidden data-testid={testId} data-points={values.length}>
      <defs><linearGradient id={`sp-${id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#10B981" stopOpacity=".28" /><stop offset="1" stopColor="#10B981" stopOpacity="0" /></linearGradient></defs>
      <motion.path d={area} fill={`url(#sp-${id})`} initial={{ opacity: anim ? 0 : 1 }} animate={{ opacity: 1 }} transition={{ duration: 0.8, delay: anim ? 0.9 : 0 }} />
      <motion.path d={line} fill="none" stroke="#0F6B4A" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"
        initial={{ pathLength: anim ? 0 : 1 } as never} animate={{ pathLength: 1 } as never} transition={{ duration: anim ? 1.4 : 0, ease: EASE, delay: anim ? 0.3 : 0 }} />
    </svg>
  );
}

/** One bento card: white, hairline border, soft shadow; lifts and shines on hover; enters in a stagger set by `i`. */
export function Bento({ children, className, i = 0, testId, as = 'section' }: { children: ReactNode; className?: string; i?: number; testId?: string; as?: 'section' | 'div' }) {
  const M = as === 'div' ? motion.div : motion.section;
  return (
    <M data-testid={testId} className={cx('bento relative overflow-hidden rounded-[22px] border border-zinc-200/80 bg-white p-5 sm:p-6', className)}
      initial={motionOk() ? { opacity: 0, y: 18, scale: 0.985 } : false} animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.55, ease: EASE, delay: 0.06 * i }}>
      {children}
    </M>
  );
}

/** Shimmering placeholder line used while a LIVE value loads. */
export function Shimmer({ className }: { className?: string }) {
  return <span role="status" aria-label="Loading" className={cx('skeleton inline-block h-4 w-24 align-middle', className)} />;
}

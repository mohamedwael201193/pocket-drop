/**
 * The page header (a white card) and the Pocket object that lives in it: a frosted emerald glass hexagon
 * holding a droplet, with a dotted orbit. Plain SVG + CSS (no WebGL, no extra chunk); it floats, the orbit turns
 * and the droplet falls in once. All motion stops for prefers-reduced-motion (index.css).
 */
import type { ReactNode } from 'react';
import { motion } from 'framer-motion';

const cx = (...a: Array<string | false | null | undefined>) => a.filter(Boolean).join(' ');

/** Frosted emerald glass Pocket (matches the light cover). */
export function PocketStatic({ className }: { className?: string }) {
  return (
    <svg viewBox="6 30 188 150" className={className} aria-hidden>
      <defs>
        <linearGradient id="pg-side" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#34D399" stopOpacity=".85" /><stop offset="1" stopColor="#059669" stopOpacity=".95" /></linearGradient>
        <linearGradient id="pg-top" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#D1FAE5" stopOpacity=".95" /><stop offset=".6" stopColor="#6EE7B7" stopOpacity=".7" /><stop offset="1" stopColor="#34D399" stopOpacity=".8" /></linearGradient>
        <linearGradient id="pg-well" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#10B981" stopOpacity=".55" /><stop offset="1" stopColor="#A7F3D0" stopOpacity=".5" /></linearGradient>
        <radialGradient id="pg-drop" cx=".35" cy=".3" r=".75"><stop offset="0" stopColor="#ffffff" /><stop offset=".5" stopColor="#D1FAE5" /><stop offset="1" stopColor="#34D399" /></radialGradient>
        <radialGradient id="pg-glow" cx=".5" cy=".5" r=".5"><stop offset="0" stopColor="#10B981" stopOpacity=".35" /><stop offset="1" stopColor="#10B981" stopOpacity="0" /></radialGradient>
      </defs>
      <ellipse cx="100" cy="160" rx="70" ry="16" fill="url(#pg-glow)" />
      <g><ellipse className="pg-orbit" cx="100" cy="110" rx="92" ry="34" fill="none" stroke="#10B981" strokeOpacity=".45" strokeWidth="1.6" strokeDasharray="1.5 6" strokeLinecap="round" /></g>
      <g className="pg-float">
        {/* body: front faces of a hexagonal prism */}
        <path d="M38 78 L38 128 L70 150 L130 150 L162 128 L162 78 L130 100 L70 100 Z" fill="url(#pg-side)" />
        <path d="M70 100 L70 150 M130 100 L130 150" stroke="#ECFDF5" strokeOpacity=".5" strokeWidth="1.2" />
        {/* top face with the well */}
        <path d="M70 56 L130 56 L162 78 L130 100 L70 100 L38 78 Z" fill="url(#pg-top)" stroke="#ffffff" strokeOpacity=".9" strokeWidth="1.4" />
        <path d="M80 64 L120 64 L141 78 L120 92 L80 92 L59 78 Z" fill="url(#pg-well)" />
        <path d="M41 80 L70 100 L130 100" fill="none" stroke="#ffffff" strokeOpacity=".7" strokeWidth="1.2" />
        <g className="pg-drop"><path d="M100 50c5 7 9 12.5 9 17.5a9 9 0 1 1-18 0c0-5 4-10.5 9-17.5Z" fill="url(#pg-drop)" stroke="#ffffff" strokeOpacity=".9" strokeWidth="1" /></g>
        <ellipse cx="100" cy="80" rx="12" ry="3.5" fill="#ffffff" fillOpacity=".5" className="pg-ripple" />
      </g>
    </svg>
  );
}

/** The decorative Pocket object in each page header. */
export function PocketObject({ className }: { className?: string }) {
  return (
    <div className={className} aria-hidden data-testid="pocket-object" data-mode="svg">
      <PocketStatic className="h-full w-full drop-shadow-[0_18px_30px_rgba(16,185,129,.25)]" />
    </div>
  );
}

/** The page header: a white card at the top of the page column (light dashboard). Same props as the old dark band. */
export function Stage({ eyebrow, title, children, action, object = true, live, testId }: { live?: boolean; eyebrow?: ReactNode; title: ReactNode; children?: ReactNode; action?: ReactNode; object?: boolean; testId?: string }) {
  return (
    <header data-testid={testId} className="stage relative mb-6 -mt-2 sm:mb-8 sm:-mt-4">
      <div className="relative z-[1] flex items-center gap-6 px-5 py-7 sm:px-8 sm:py-9">
        <motion.div className="min-w-0 flex-1" initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}>
          {eyebrow && <div className={cx('flex min-w-0 flex-wrap items-center gap-2 text-sm font-medium text-emerald-800 [overflow-wrap:anywhere]', object && 'pr-[84px] sm:pr-0')}>{live && <span className="live-dot animate-pulseDot" aria-hidden />}{eyebrow}</div>}
          <h1 className={cx(object && 'pr-[72px] sm:pr-0', 'mt-2 font-display text-[2rem] font-semibold leading-[1.05] tracking-[-0.035em] text-zinc-950 sm:text-[2.75rem]')}>{title}</h1>
          {children && <div className="mt-3 max-w-2xl text-[15px] leading-relaxed text-zinc-600">{children}</div>}
          {action && <div className="mt-6">{action}</div>}
        </motion.div>
        {object && <PocketObject className="pointer-events-none absolute right-3 top-4 h-16 w-16 shrink-0 sm:static sm:order-last sm:h-32 sm:w-32 lg:h-40 lg:w-40" />}
      </div>
    </header>
  );
}

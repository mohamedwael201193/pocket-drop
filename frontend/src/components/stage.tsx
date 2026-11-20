/**
 * The obsidian stage every app page opens with (direction B), and the 3D Pocket that lives in it.
 * The 3D chunk loads only after the page is idle, never for reduced motion or data saver, and falls back
 * to the static drawing below if WebGL is missing or the device is slow.
 */
import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { reducedMotion } from './alive';

const cx = (...a: Array<string | false | null | undefined>) => a.filter(Boolean).join(' ');

const Pocket3D = lazy(() => import('./Pocket3D'));
const SLOW_KEY = 'pd.3d.slow';

function webgl(): boolean {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; }
}

/** Static Pocket drawing: the first paint and the fallback. Same object as the 3D one. */
export function PocketStatic({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 200" className={className} aria-hidden>
      <defs>
        <linearGradient id="pk-body" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#3A3A40" /><stop offset=".55" stopColor="#161619" /><stop offset="1" stopColor="#2A2A2F" /></linearGradient>
        <linearGradient id="pk-plate" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#ECE8E0" /><stop offset=".5" stopColor="#B9B3A8" /><stop offset="1" stopColor="#E2DDD3" /></linearGradient>
        <radialGradient id="pk-drop" cx=".38" cy=".32" r=".7"><stop offset="0" stopColor="#A7F3D0" /><stop offset=".45" stopColor="#10B981" /><stop offset="1" stopColor="#0B6B4B" /></radialGradient>
      </defs>
      <ellipse cx="100" cy="100" rx="86" ry="30" fill="none" stroke="#6EE7B7" strokeOpacity=".5" strokeWidth="1.4" transform="rotate(-18 100 100)" />
      <polygon points="100,24 166,62 166,138 100,176 34,138 34,62" fill="url(#pk-body)" stroke="#6EE7B7" strokeOpacity=".45" strokeWidth="1.2" />
      <polygon points="100,44 149,72 149,128 100,156 51,128 51,72" fill="url(#pk-plate)" />
      <ellipse cx="100" cy="102" rx="19" ry="23" fill="url(#pk-drop)" />
      <circle cx="176" cy="78" r="3.5" fill="#F6F5F3" />
    </svg>
  );
}

/** The decorative Pocket object: static first, then three.js once idle. */
export function PocketObject({ className }: { className?: string }) {
  const [want, setWant] = useState(false);
  const [ready, setReady] = useState(false);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (reducedMotion() || sessionStorage.getItem(SLOW_KEY) === '1') return;
    const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    if (conn?.saveData || !webgl()) return;
    let idle = 0; let to = 0;
    const go = () => { to = window.setTimeout(() => setWant(true), 600); };
    const ric = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    const start = () => { if (ric) idle = ric(go, { timeout: 2500 }); else to = window.setTimeout(go, 1200); };
    if (document.readyState === 'complete') start(); else window.addEventListener('load', start, { once: true });
    return () => { window.removeEventListener('load', start); clearTimeout(to); const c = (window as Window & { cancelIdleCallback?: (n: number) => void }).cancelIdleCallback; if (idle && c) c(idle); };
  }, []);
  return (
    <div className={className} aria-hidden data-testid="pocket-object" data-mode={ready && !slow ? '3d' : 'static'}>
      <div className="relative h-full w-full">
        <motion.div className="absolute inset-[8%]" animate={{ opacity: ready && !slow ? 0 : 1 }} transition={{ duration: 0.6 }}>
          <PocketStatic className="h-full w-full drop-shadow-[0_24px_40px_rgba(0,0,0,.45)]" />
        </motion.div>
        {want && !slow && (
          <Suspense fallback={null}>
            <motion.div className="absolute inset-0" initial={{ opacity: 0 }} animate={{ opacity: ready ? 1 : 0 }} transition={{ duration: 0.8 }}>
              <Pocket3D onReady={() => setReady(true)} onSlow={() => { sessionStorage.setItem(SLOW_KEY, '1'); setSlow(true); }} />
            </motion.div>
          </Suspense>
        )}
      </div>
    </div>
  );
}

/** Full-bleed dark band that opens a page. Content aligns with the page column below it (--page-w set by <Page>). */
export function Stage({ eyebrow, title, children, action, object = true, live, testId }: { live?: boolean; eyebrow?: ReactNode; title: ReactNode; children?: ReactNode; action?: ReactNode; object?: boolean; testId?: string }) {
  return (
    <header data-testid={testId} className="stage relative left-1/2 mb-8 -mt-8 w-screen -translate-x-1/2 sm:mb-10 sm:-mt-12">
      <div className="relative z-[1] mx-auto flex items-center gap-6 px-4 py-9 sm:px-6 sm:py-12 lg:px-8" style={{ maxWidth: 'calc(var(--page-w, 64rem))' }}>
        <motion.div className="min-w-0 flex-1" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}>
          {eyebrow && <div className={cx('flex min-w-0 flex-wrap items-center gap-2 text-sm font-medium text-invMuted [overflow-wrap:anywhere]', object && 'pr-[84px] sm:pr-0')}>{live && <span className="live-dot animate-pulseDot" aria-hidden />}{eyebrow}</div>}
          <h1 className={cx(object && 'pr-[72px] sm:pr-0', 'mt-3 font-display text-[2.5rem] font-medium leading-[1.02] tracking-[-0.035em] text-stone-50 sm:text-[3.5rem]')}>{title}</h1>
          {children && <div className="mt-4 max-w-2xl text-[15px] leading-relaxed text-stone-300 sm:text-base">{children}</div>}
          {action && <div className="mt-6">{action}</div>}
        </motion.div>
        {object && <PocketObject className="pointer-events-none absolute right-3 top-5 h-20 w-20 shrink-0 sm:static sm:order-last sm:h-40 sm:w-40 md:h-52 md:w-52 lg:h-60 lg:w-60" />}
      </div>
    </header>
  );
}

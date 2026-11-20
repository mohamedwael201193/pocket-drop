/**
 * The "alive" layer: cursor spotlight, magnetic buttons, count-ups for LIVE numbers and a claim celebration.
 * Everything here is decoration only: it never changes a value, and it switches off for
 * prefers-reduced-motion, touch pointers and automated browsers (so tests read final values at once).
 */
import { useEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { animate, motion } from 'framer-motion';

const mq = (q: string) => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(q).matches;
export const reducedMotion = () => mq('(prefers-reduced-motion: reduce)');
export const finePointer = () => mq('(hover: hover) and (pointer: fine)');
export const automated = () => typeof navigator !== 'undefined' && navigator.webdriver === true;
/** True when decorative motion may run at all. */
export const motionOk = () => !reducedMotion() && !automated();

/** Cursor spotlight on every dark surface (.stage, .capsule-obsidian). Desktop pointers only. One listener for the app. */
export function SpotlightTracker() {
  useEffect(() => {
    if (!finePointer() || reducedMotion()) return;
    let last: HTMLElement | null = null; let raf = 0; let ev: PointerEvent | null = null;
    const tick = () => {
      raf = 0; if (!ev) return;
      const el = (ev.target as Element | null)?.closest?.('.stage, .capsule-obsidian') as HTMLElement | null;
      if (last && last !== el) last.style.setProperty('--so', '0');
      if (el) { const r = el.getBoundingClientRect(); el.style.setProperty('--sx', `${ev.clientX - r.left}px`); el.style.setProperty('--sy', `${ev.clientY - r.top}px`); el.style.setProperty('--so', '1'); }
      last = el;
    };
    const on = (e: PointerEvent) => { ev = e; if (!raf) raf = requestAnimationFrame(tick); };
    const leave = () => { if (last) last.style.setProperty('--so', '0'); last = null; };
    window.addEventListener('pointermove', on, { passive: true });
    document.addEventListener('pointerleave', leave);
    return () => { window.removeEventListener('pointermove', on); document.removeEventListener('pointerleave', leave); if (raf) cancelAnimationFrame(raf); };
  }, []);
  return null;
}

/** Magnetic pull toward the cursor (cursify "magnetic button"), at most 6 px. Uses Tailwind's translate variables so active:scale still works. */
export function useMagnetic<T extends HTMLElement>(ref: RefObject<T>, on = true) {
  useEffect(() => {
    const el = ref.current;
    if (!el || !on || !finePointer() || reducedMotion()) return;
    const move = (e: PointerEvent) => {
      if ((el as unknown as HTMLButtonElement).disabled) return;
      const r = el.getBoundingClientRect();
      const dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
      const dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
      el.style.setProperty('--tw-translate-x', `${(dx * 6).toFixed(1)}px`);
      el.style.setProperty('--tw-translate-y', `${(dy * 4).toFixed(1)}px`);
    };
    const reset = () => { el.style.setProperty('--tw-translate-x', '0px'); el.style.setProperty('--tw-translate-y', '0px'); };
    el.addEventListener('pointermove', move); el.addEventListener('pointerleave', reset);
    return () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerleave', reset); };
  }, [ref, on]);
}

/** Counts up to a LIVE number the first time it appears. Text is always the real value when motion is off. */
export function CountUp({ value, format = (n) => String(Math.round(n)) }: { value: number; format?: (n: number) => string }) {
  const [shown, setShown] = useState(() => (motionOk() ? 0 : value));
  const first = useRef(true);
  useEffect(() => {
    if (!motionOk()) { setShown(value); return; }
    const from = first.current ? 0 : shown;
    first.current = false;
    const c = animate(from, value, { duration: Math.min(1.2, 0.5 + Math.log10(Math.abs(value - from) + 1) * 0.25), ease: [0.22, 1, 0.36, 1], onUpdate: setShown });
    return () => c.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return <span className="tabular-nums">{format(shown)}</span>;
}

const BURST = ['#10B981', '#6EE7B7', '#0B6B4B', '#D5CFC6', '#F6F5F3', '#18181B'];
/** One short celebration when money lands: green and stone shards fly from the centre of the screen. Runs once, never blocks clicks. */
export function Celebrate({ run = true, once }: { run?: boolean; once?: string }) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!run || !motionOk()) return;
    const k = once ? `pd.celebrated.${once}` : '';
    try { if (k && sessionStorage.getItem(k)) return; if (k) sessionStorage.setItem(k, '1'); } catch { /* private mode */ }
    setOn(true); const t = setTimeout(() => setOn(false), 1800); return () => clearTimeout(t);
  }, [run, once]);
  if (!on || typeof document === 'undefined') return null;
  const n = typeof window !== 'undefined' && window.innerWidth < 640 ? 22 : 34;
  const parts = Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2 + (i % 3) * 0.21;
    const d = 140 + ((i * 47) % 160);
    return { i, x: Math.cos(a) * d, y: Math.sin(a) * d * 0.8 - 60, r: (i * 73) % 360, c: BURST[i % BURST.length], s: 6 + (i % 4) * 2, round: i % 3 === 0 };
  });
  return createPortal(
    <div aria-hidden className="pointer-events-none fixed inset-0 z-[60] flex items-center justify-center" data-testid="celebrate">
      {parts.map((p) => (
        <motion.span key={p.i} className="absolute block" style={{ width: p.s, height: p.round ? p.s : p.s * 0.45, background: p.c, borderRadius: p.round ? 999 : 2, boxShadow: '0 1px 2px rgba(0,0,0,.15)' }}
          initial={{ x: 0, y: 0, rotate: 0, opacity: 1, scale: 0.6 }}
          animate={{ x: p.x, y: [0, p.y, p.y + 220], rotate: p.r + 360, opacity: [1, 1, 0], scale: 1 }}
          transition={{ duration: 1.6, ease: [0.22, 1, 0.36, 1], times: [0, 0.45, 1] }} />
      ))}
    </div>,
    document.body,
  );
}

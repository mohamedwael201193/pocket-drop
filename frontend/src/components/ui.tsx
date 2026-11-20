import { useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { useMagnetic } from './alive';
import { Stage } from './stage';
import { Check, Copy, ExternalLink, Loader2 } from './icons';
import { txUrl } from '../lib/config';
import { shortHash } from '../lib/protocol';

export const cx = (...a: Array<string | false | null | undefined>) => a.filter(Boolean).join(' ');

/** LIVE = read from chain/API just now. RECORDED = taken from files in the repo (deployments/diana.json, test output). */
export function SourceBadge({ kind, title }: { kind: 'LIVE' | 'RECORDED' | 'ILLUSTRATION'; title?: string }) {
  const live = kind === 'LIVE';
  if (kind === 'ILLUSTRATION') return <span title={title ?? 'A walkthrough drawing, not a live transaction'} className="inline-flex items-center gap-1 rounded-full border border-zinc-300 bg-zinc-100 px-2 py-0.5 font-mono text-xs font-semibold tracking-wider text-zinc-700">ILLUSTRATION</span>;
  return (
    <span
      title={title ?? (live ? 'Read from the chain or the relayer API just now' : 'Taken from a recorded file in the repository')}
      className={cx('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-xs font-semibold tracking-wider',
        live ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-amber-300 bg-amber-50 text-amber-900')}
    >
      <span className={cx('h-1.5 w-1.5 rounded-full', live ? 'animate-pulseDot bg-emerald-500' : 'bg-amber-500')} />
      {kind}
    </span>
  );
}

export function Card({ children, className, dark, id, ...rest }: { children: ReactNode; className?: string; dark?: boolean; id?: string; 'data-testid'?: string }) {
  return <section id={id} data-testid={rest['data-testid']} className={cx('rounded-3xl border p-5 sm:p-6', dark ? 'capsule-obsidian border-zinc-800 text-stone-100' : 'border-zinc-200 bg-white/90 shadow-sm', className)}>{children}</section>;
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="text-sm font-medium text-zinc-600">{children}</p>;
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'whatsapp'; busy?: boolean; block?: boolean };
export function Button({ variant = 'primary', busy, block, className, children, disabled, ...rest }: BtnProps) {
  const ref = useRef<HTMLButtonElement>(null);
  useMagnetic(ref, variant === 'primary' || variant === 'whatsapp');
  const v = {
    primary: 'bg-accent text-stone-50 hover:bg-accentHover shadow-[0_8px_20px_-8px_rgba(11,107,75,.55)]',
    secondary: 'border border-zinc-300 bg-white text-zinc-900 hover:border-zinc-400 hover:bg-stoneCard',
    ghost: 'text-zinc-700 hover:bg-stoneCard',
    danger: 'border border-red-300 bg-red-50 text-red-800 hover:bg-red-100',
    whatsapp: 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm',
  }[variant];
  return (
    <button
      ref={ref}
      {...rest}
      disabled={disabled || busy}
      className={cx('btn-b transform inline-flex min-h-[48px] items-center justify-center gap-2 rounded-full px-5 text-[15px] font-medium transition-[transform,background-color,border-color,box-shadow] duration-200 ease-out active:scale-[0.97] disabled:cursor-not-allowed', v, block && 'w-full', className)}
    >
      {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

export function CopyButton({ text, label = 'Copy', className, testId }: { text: string; label?: string; className?: string; testId?: string }) {
  const [done, setDone] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(text); } catch {
      const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch { /* ignore */ } ta.remove();
    }
    setDone(true); setTimeout(() => setDone(false), 1400);
  }
  return (
    <Button type="button" variant="secondary" onClick={copy} className={cx('min-h-[40px] px-4', className)} data-testid={testId}>
      {done ? <Check key="ok" className="h-4 w-4 text-emerald-700" /> : <Copy key="copy" className="h-4 w-4" />}
      {done ? 'Copied' : label}
    </Button>
  );
}

export function TxLink({ hash, label, testId }: { hash: string; label?: string; testId?: string }) {
  return (
    <a href={txUrl(hash)} target="_blank" rel="noopener noreferrer" data-testid={testId} data-hash={hash}
      className="inline-flex items-center gap-1 font-mono text-xs text-zinc-700 underline decoration-zinc-300 underline-offset-2 hover:text-black">
      {label ?? shortHash(hash, 6)} <ExternalLink className="h-3 w-3" aria-hidden />
    </a>
  );
}

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx('break-all font-mono text-xs text-zinc-800', className)}>{children}</span>;
}

export function Skeleton({ className }: { className?: string }) { return <div className={cx('skeleton h-5 w-24', className)} />; }

export function Notice({ tone = 'info', children, testId }: { tone?: 'info' | 'warn' | 'error' | 'ok'; children: ReactNode; testId?: string }) {
  const t = { info: 'border-zinc-200 bg-stoneCard text-zinc-800', warn: 'border-amber-300 bg-amber-50 text-amber-950', error: 'border-red-300 bg-red-50 text-red-900', ok: 'border-emerald-300 bg-emerald-50 text-emerald-950' }[tone];
  return <div data-testid={testId} role={tone === 'error' ? 'alert' : undefined} className={cx('break-words rounded-xl border px-3.5 py-3 text-sm leading-relaxed [overflow-wrap:anywhere]', t)}>{children}</div>;
}

export function Fingerprint({ words, testId }: { words: string[]; testId?: string }) {
  return (
    <div className="capsule-titanium rounded-2xl border border-zinc-300 p-4 text-center">
      <div className="mb-2 text-sm font-medium text-zinc-600">4-word verification seal</div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid={testId}>
        {words.map((w, i) => (
          <div key={i} className="word-tile rounded-xl py-2.5 text-center font-mono text-xs font-semibold uppercase tracking-wider text-zinc-900"><span className="mr-1 text-xs text-zinc-400">{i + 1}</span>{w}</div>
        ))}
      </div>
    </div>
  );
}

/** Page title: the obsidian stage (direction B). Same props as before, so every page opens the same way. */
export function PageTitle({ eyebrow, title, children, action }: { eyebrow: ReactNode; title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return <Stage eyebrow={eyebrow} title={title} action={action}>{children}</Stage>;
}

/** Page container: one width, one gutter, one vertical rhythm for every route. */
export function Page({ children, narrow, testId }: { children: ReactNode; narrow?: boolean; testId?: string }) {
  const style = { '--page-w': narrow ? '42rem' : '64rem' } as CSSProperties;
  return <div data-testid={testId} style={style} className={cx('mx-auto px-4 pb-28 pt-8 sm:px-6 sm:pb-16 sm:pt-12 lg:px-8', narrow ? 'max-w-2xl' : 'max-w-5xl')}>{children}</div>;
}

/** Small state pill. */
export function Pill({ tone = 'neutral', children, testId }: { tone?: 'neutral' | 'ok' | 'warn' | 'dark'; children: ReactNode; testId?: string }) {
  const t = { neutral: 'border-zinc-300 bg-stoneCard text-zinc-700', ok: 'border-emerald-300 bg-emerald-50 text-emerald-900', warn: 'border-amber-300 bg-amber-50 text-amber-900', dark: 'border-zinc-800 bg-zinc-900 text-stone-100' }[tone];
  return <span data-testid={testId} className={cx('inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 font-mono text-xs font-medium', t)}>{children}</span>;
}

/** Numbered step card: the one card style used by every linear flow. */
export function StepCard({ n, title, done, locked, children, testId }: { n: number; title: string; done?: boolean; locked?: boolean; children: ReactNode; testId?: string }) {
  return (
    <motion.section data-testid={testId} data-done={done ? '1' : '0'} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      data-locked={locked ? '1' : '0'} className={cx('rounded-3xl border p-5 transition-colors sm:p-6', locked ? 'border-dashed border-zinc-300 bg-stoneCard/60' : 'bg-white/90 shadow-sm', done ? 'border-emerald-300' : !locked && 'border-zinc-200')}>
      <div className="mb-4 flex items-center gap-3">
        <motion.span key={done ? 'd' : 'n'} initial={{ scale: 0.6 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 420, damping: 18 }}
          className={cx('flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-mono text-sm font-medium', done ? 'bg-accent text-white' : locked ? 'bg-zinc-300 text-zinc-800' : 'bg-zinc-900 text-stone-100')}>{done ? <Check className="h-4 w-4" aria-hidden /> : n}</motion.span>
        <h2 className="font-serif text-2xl text-zinc-900">{title}</h2>
      </div>
      {children}
    </motion.section>
  );
}

/** Loading skeleton that keeps the layout of the value it stands for (UX-11). */
export function Skel({ w = '4rem', h = '1em', className, label = 'Loading' }: { w?: string; h?: string; className?: string; label?: string }) {
  return <span role="status" aria-label={label} className={cx('inline-block animate-pulse rounded-md bg-zinc-300/70 align-middle', className)} style={{ width: w, height: h }} />;
}

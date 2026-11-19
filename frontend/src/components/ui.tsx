import { useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Check, Copy, ExternalLink, Loader2 } from 'lucide-react';
import { txUrl } from '../lib/config';
import { shortHash } from '../lib/protocol';

export const cx = (...a: Array<string | false | null | undefined>) => a.filter(Boolean).join(' ');

/** LIVE = read from chain/API just now. RECORDED = taken from files in the repo (deployments/diana.json, test output). */
export function SourceBadge({ kind, title }: { kind: 'LIVE' | 'RECORDED'; title?: string }) {
  const live = kind === 'LIVE';
  return (
    <span
      title={title ?? (live ? 'Read from the chain or the relayer API just now' : 'Taken from a recorded file in the repository')}
      className={cx('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold tracking-wider',
        live ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-amber-300 bg-amber-50 text-amber-900')}
    >
      <span className={cx('h-1.5 w-1.5 rounded-full', live ? 'animate-pulseDot bg-emerald-500' : 'bg-amber-500')} />
      {kind}
    </span>
  );
}

export function Card({ children, className, dark }: { children: ReactNode; className?: string; dark?: boolean }) {
  return <section className={cx('rounded-2xl border p-4 sm:p-5', dark ? 'obsidian border-zinc-800 text-stone-100' : 'border-zinc-200 bg-white shadow-sm', className)}>{children}</section>;
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-500">{children}</p>;
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'whatsapp'; busy?: boolean; block?: boolean };
export function Button({ variant = 'primary', busy, block, className, children, disabled, ...rest }: BtnProps) {
  const v = {
    primary: 'bg-zinc-900 text-stone-50 hover:bg-zinc-800 shadow-sm',
    secondary: 'border border-zinc-300 bg-white text-zinc-900 hover:bg-stone2',
    ghost: 'text-zinc-700 hover:bg-stone2',
    danger: 'border border-red-300 bg-red-50 text-red-800 hover:bg-red-100',
    whatsapp: 'bg-[#128C7E] text-white hover:bg-[#0f7a6e] shadow-sm',
  }[variant];
  return (
    <button
      {...rest}
      disabled={disabled || busy}
      className={cx('inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full px-5 text-sm font-medium transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50', v, block && 'w-full', className)}
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
      {done ? <Check className="h-4 w-4 text-emerald-700" /> : <Copy className="h-4 w-4" />}
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
  const t = { info: 'border-zinc-200 bg-stone2 text-zinc-800', warn: 'border-amber-300 bg-amber-50 text-amber-950', error: 'border-red-300 bg-red-50 text-red-900', ok: 'border-emerald-300 bg-emerald-50 text-emerald-950' }[tone];
  return <div data-testid={testId} role={tone === 'error' ? 'alert' : undefined} className={cx('rounded-xl border px-3.5 py-3 text-sm leading-relaxed', t)}>{children}</div>;
}

export function Fingerprint({ words, testId }: { words: string[]; testId?: string }) {
  return (
    <div className="capsule rounded-2xl border border-zinc-300 p-4 text-center">
      <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">4-word fingerprint</div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid={testId}>
        {words.map((w, i) => (
          <div key={i} className="rounded-xl bg-white/80 px-2 py-3 font-serif text-2xl leading-none text-zinc-900"><span className="mr-1 font-mono text-[10px] text-zinc-400">{i + 1}</span>{w}</div>
        ))}
      </div>
    </div>
  );
}

export function PageTitle({ eyebrow, title, children }: { eyebrow: ReactNode; title: string; children?: ReactNode }) {
  return (
    <header className="mb-6">
      <Eyebrow>{eyebrow}</Eyebrow>
      <h1 className="mt-1.5 font-serif text-[2rem] leading-[1.05] tracking-tight text-zinc-900 sm:text-5xl">{title}</h1>
      {children && <p className="mt-3 max-w-2xl text-sm leading-relaxed text-zinc-600 sm:text-base">{children}</p>}
    </header>
  );
}

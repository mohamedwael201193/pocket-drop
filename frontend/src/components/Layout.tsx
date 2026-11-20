import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { useIsFetching, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, FlaskConical, Hexagon, Inbox, Radio, RefreshCw, Scale, Send, ShieldCheck, Wallet } from 'lucide-react';
import { SOURCE_URL, addrUrl, API_BASE } from '../lib/config';
import { INST } from '../lib/v4';
import { useHealth } from '../lib/queries';
import { RELAYER_PAUSED } from '../lib/api';
import { cx } from './ui';

/** The four tabs. Every route belongs to exactly one of them. */
const TABS = [
  { key: 'send', label: 'Send', to: '/send', Icon: Send, match: (p: string) => p === '/' || p.startsWith('/send') },
  { key: 'receive', label: 'Receive', to: '/receive', Icon: Inbox, match: (p: string) => p.startsWith('/receive') || p.startsWith('/c/') || p.startsWith('/pool/') },
  { key: 'pocket', label: 'Pocket', to: '/pocket', Icon: Wallet, match: (p: string) => p.startsWith('/pocket') },
  { key: 'proof', label: 'Proof', to: '/proof', Icon: ShieldCheck, match: (p: string) => ['/proof', '/lab', '/radar', '/judges'].some((x) => p.startsWith(x)) },
] as const;
export const PROOF_ITEMS = [
  { to: '/lab', label: 'Lab', sub: 'Attacks the chain refused', Icon: FlaskConical },
  { to: '/radar', label: 'Radar', sub: 'Live stats from the chain', Icon: Radio },
  { to: '/judges', label: 'Judges', sub: '60-second checklist', Icon: Scale },
];

function ScrollProgress() {
  const [w, setW] = useState(0);
  useEffect(() => {
    const f = () => { const h = document.documentElement.scrollHeight - window.innerHeight; setW(h > 0 ? (window.scrollY / h) * 100 : 0); };
    window.addEventListener('scroll', f, { passive: true }); f();
    return () => window.removeEventListener('scroll', f);
  }, []);
  return <div className="fixed left-0 top-0 z-50 h-[2.5px] bg-zinc-900" style={{ width: `${w}%` }} aria-hidden />;
}

function SyncChip() {
  const qc = useQueryClient();
  const { data: h, isError } = useHealth();
  const fetching = useIsFetching({ queryKey: ['health'] }) + useIsFetching({ queryKey: ['stats'] }) > 0;
  const label = fetching && !h ? 'Connecting to Diana…' : isError ? 'Diana 9800 · API offline' : h ? (h.window.live ? 'Diana 9800 · live' : 'Diana 9800 · relayer paused') : 'Diana 9800';
  return (
    <button type="button" data-testid="testnet-badge" title="Diana testnet, chain id 9800. Click to re-read the relayer and stats."
      onClick={() => { void qc.invalidateQueries(); }}
      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 font-mono text-[11px] text-zinc-600 transition-colors hover:text-zinc-900">
      <RefreshCw className={cx('h-3 w-3', fetching && 'animate-spin')} aria-hidden />
      <span>{label}</span>
    </button>
  );
}

function RelayerBanner() {
  const { data: h } = useHealth();
  if (!h || h.window.live !== false) return null;
  return <div role="alert" data-testid="relayer-banner" className="border-b border-amber-300 bg-amber-50 px-4 py-2 text-center text-xs text-amber-950">{RELAYER_PAUSED}</div>;
}

function ProofMenu({ active }: { active: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    const f = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', f); return () => document.removeEventListener('mousedown', f);
  }, []);
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-haspopup="menu" aria-expanded={open} data-testid="nav-proof" onClick={() => setOpen((v) => !v)}
        className={cx('inline-flex items-center gap-1 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors', active ? 'nav-pill-active' : 'text-zinc-600 hover:text-zinc-900')}>
        Proof <ChevronDown className={cx('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-50 mt-2 w-64 rounded-2xl border border-zinc-200 bg-white p-1.5 shadow-xl">
          {PROOF_ITEMS.map(({ to, label, sub, Icon }) => (
            <Link key={to} to={to} role="menuitem" data-testid={`proof-${label.toLowerCase()}`} className="flex items-start gap-3 rounded-xl px-3 py-2.5 hover:bg-stoneCard">
              <Icon className="mt-0.5 h-4 w-4 text-zinc-600" aria-hidden />
              <span><span className="block text-sm font-medium text-zinc-900">{label}</span><span className="block text-xs text-zinc-500">{sub}</span></span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export function Layout() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return (
    <div className="flex min-h-screen flex-col">
      <ScrollProgress />
      <header className="glass-nav sticky top-0 z-40 border-b border-zinc-200/60">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <Link to="/" className="flex items-center gap-2" aria-label="Pocket Drop home">
            <span className="flex h-7 w-7 items-center justify-center rounded-full border border-zinc-300 bg-white text-zinc-900"><Hexagon className="h-4 w-4" aria-hidden /></span>
            <span className="text-sm font-medium tracking-tight text-zinc-900">Pocket Drop</span>
          </Link>
          <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
            {TABS.map((t) => t.key === 'proof'
              ? <ProofMenu key={t.key} active={t.match(pathname)} />
              : <NavLink key={t.key} to={t.to} data-testid={`nav-${t.key}`} className={cx('rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors', t.match(pathname) ? 'nav-pill-active' : 'text-zinc-600 hover:text-zinc-900')}>{t.label}</NavLink>)}
          </nav>
          <SyncChip />
        </div>
      </header>
      <RelayerBanner />
      <main className="flex-1"><Outlet /></main>
      <footer className="border-t border-zinc-200/80 bg-white/70 py-8">
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-3 px-4 pb-20 text-center font-mono text-[11px] text-zinc-500 sm:flex-row sm:px-6 sm:pb-0 sm:text-left lg:px-8">
          <span>Testnet QOR only · No monetary value · Unaudited · Diana 9800</span>
          <span className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
            <a href={`${API_BASE}/api/health`} target="_blank" rel="noopener noreferrer" className="hover:text-zinc-900">API health</a>
            <a href={addrUrl(INST.prod.router)} target="_blank" rel="noopener noreferrer" className="hover:text-zinc-900">v4 router</a>
            <a href={SOURCE_URL} target="_blank" rel="noopener noreferrer" className="hover:text-zinc-900">Source</a>
          </span>
        </div>
      </footer>
      <nav aria-label="Tabs" data-testid="tabbar" className="fixed inset-x-0 bottom-0 z-40 border-t border-zinc-200 bg-stoneBg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        <div className="mx-auto grid max-w-md grid-cols-4">
          {TABS.map(({ key, label, to, Icon, match }) => (
            <NavLink key={key} to={to} data-testid={`tab-${key}`} className={cx('flex min-h-[56px] flex-col items-center justify-center gap-0.5 text-[11px] font-medium', match(pathname) ? 'text-zinc-900' : 'text-zinc-500')}>
              <Icon className={cx('h-5 w-5', match(pathname) && 'stroke-[2.25]')} aria-hidden />{label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}

import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { LegacyKeyStrip } from './upgrade';
import { useEffect, useRef, useState } from 'react';
import { useIsFetching, useQueryClient } from '@tanstack/react-query';
import { MotionConfig, motion } from 'framer-motion';
import { SpotlightTracker } from './alive';
import { ChevronDown, FlaskConical, Hexagon, Inbox, KeyRound, Radio, RefreshCw, Scale, Send, ShieldCheck, Wallet } from './icons';
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
  { key: 'proof', label: 'Proof', to: '/proof', Icon: ShieldCheck, match: (p: string) => ['/proof', '/lab', '/radar', '/judges', '/qday'].some((x) => p.startsWith(x)) },
] as const;
export const PROOF_ITEMS = [
  { to: '/lab', label: 'Lab', sub: 'Attacks the chain refused', Icon: FlaskConical },
  { to: '/qday', label: 'Steal this Pocket', sub: 'Q-Day drill: public keys, live', Icon: KeyRound },
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
  return <div className="fixed left-0 top-0 z-50 h-[2.5px] bg-liveBright" style={{ width: `${w}%` }} aria-hidden />;
}

function SyncChip() {
  const qc = useQueryClient();
  const { data: h, isError } = useHealth();
  const fetching = useIsFetching({ queryKey: ['health'] }) + useIsFetching({ queryKey: ['stats'] }) > 0;
  const label = fetching && !h ? 'Connecting to Diana…' : isError ? 'Diana 9800 · API offline' : h ? (h.window.live ? 'Diana 9800 · live' : 'Diana 9800 · relayer paused') : 'Diana 9800';
  return (
    <button type="button" data-testid="testnet-badge" title="Diana testnet, chain id 9800. Click to re-read the relayer and stats."
      onClick={() => { void qc.invalidateQueries(); }}
      className="inline-flex min-h-[40px] items-center gap-2 rounded-full px-3 py-1.5 text-[13px] font-medium text-invMuted transition-colors hover:text-stone-50">
      {h?.window.live && !isError ? <span className="live-dot animate-pulseDot" aria-hidden /> : <RefreshCw className={cx('h-3.5 w-3.5', fetching && 'animate-spin')} aria-hidden />}
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
        className={cx('relative inline-flex h-16 items-center gap-1 px-3 text-[15px] font-medium transition-colors', active ? 'text-stone-50' : 'text-invMuted hover:text-stone-50')}>
        {active && <motion.span layoutId="nav-bar" className="absolute inset-x-3 bottom-0 h-[2px] rounded-full bg-liveBright" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}
        Proof <ChevronDown className={cx('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open && (
        <motion.div role="menu" initial={{ opacity: 0, y: -6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.18 }} className="absolute right-0 top-full z-50 mt-1 w-72 origin-top-right rounded-2xl border border-white/10 bg-obsidian2 p-1.5 shadow-2xl">
          {PROOF_ITEMS.map(({ to, label, sub, Icon }) => (
            <Link key={to} to={to} role="menuitem" data-testid={`proof-${to.slice(1)}`} className="group flex items-start gap-3 rounded-xl px-3 py-2.5 hover:bg-white/5">
              <span className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg bg-white/5 text-[#6EE7B7]"><Icon className="h-[18px] w-[18px]" aria-hidden /></span>
              <span><span className="block text-[15px] font-medium text-stone-50">{label}</span><span className="block text-xs text-invMuted">{sub}</span></span>
            </Link>
          ))}
        </motion.div>
      )}
    </div>
  );
}

export function Layout() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return (
    <MotionConfig reducedMotion="user">
    <div className="flex min-h-screen flex-col">
      <ScrollProgress />
      <SpotlightTracker />
      <header className="nav-obsidian sticky top-0 z-40">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <Link to="/" className="group flex min-h-[44px] items-center gap-2.5" aria-label="Pocket Drop home">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[.06] text-[#6EE7B7] ring-1 ring-white/10 transition-transform duration-500 group-hover:rotate-[30deg]"><Hexagon className="h-[18px] w-[18px]" aria-hidden /></span>
            <span className="font-money text-[26px] leading-none text-stone-50">Pocket Drop</span>
          </Link>
          <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
            {TABS.map((t) => t.key === 'proof'
              ? <ProofMenu key={t.key} active={t.match(pathname)} />
              : <NavLink key={t.key} to={t.to} data-testid={`nav-${t.key}`} className={cx('relative inline-flex h-16 items-center px-3 text-[15px] font-medium transition-colors', t.match(pathname) ? 'text-stone-50' : 'text-invMuted hover:text-stone-50')}>
                  {t.match(pathname) && <motion.span layoutId="nav-bar" className="absolute inset-x-3 bottom-0 h-[2px] rounded-full bg-liveBright" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}
                  {t.label}
                </NavLink>)}
          </nav>
          <SyncChip />
        </div>
      </header>
      <RelayerBanner />
      <LegacyKeyStrip path={pathname} />
      <main className="flex-1">
        <motion.div key={pathname} initial={{ y: 10 }} animate={{ y: 0 }} transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}><Outlet /></motion.div>
      </main>
      <footer className="border-t border-zinc-200/80 bg-white/70 py-8">
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-3 px-4 pb-20 text-center text-[13px] text-zinc-600 sm:flex-row sm:px-6 sm:pb-0 sm:text-left lg:px-8">
          <span>Testnet QOR only · No monetary value · Unaudited · Diana 9800</span>
          <span className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
            <a href={`${API_BASE}/api/health`} target="_blank" rel="noopener noreferrer" className="hover:text-zinc-900">API health</a>
            <a href={addrUrl(INST.prod.router)} target="_blank" rel="noopener noreferrer" className="hover:text-zinc-900">v4 router</a>
            <a href={SOURCE_URL} target="_blank" rel="noopener noreferrer" className="hover:text-zinc-900">Source</a>
          </span>
        </div>
      </footer>
      <nav aria-label="Tabs" data-testid="tabbar" className="tabbar-obsidian fixed inset-x-0 bottom-0 z-40 pb-[env(safe-area-inset-bottom)] md:hidden">
        <div className="mx-auto grid max-w-md grid-cols-4">
          {TABS.map(({ key, label, to, Icon, match }) => (
            <NavLink key={key} to={to} data-testid={`tab-${key}`} className={cx('relative flex min-h-[58px] flex-col items-center justify-center gap-1 text-[13px] font-medium transition-colors', match(pathname) ? 'text-stone-50' : 'text-invMuted')}>
              {match(pathname) && <motion.span layoutId="tab-bar" className="absolute inset-x-5 top-0 h-[2px] rounded-full bg-liveBright" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}
              <motion.span animate={match(pathname) ? { y: -1, scale: 1.08 } : { y: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 500, damping: 26 }} className={cx('flex', match(pathname) && 'text-[#6EE7B7]')}>
                <Icon className="h-[22px] w-[22px]" weight={match(pathname) ? 'fill' : 'duotone'} aria-hidden />
              </motion.span>{label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
    </MotionConfig>
  );
}

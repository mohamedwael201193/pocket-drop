import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useIsFetching, useQueryClient } from '@tanstack/react-query';
import { Hexagon, Menu, RefreshCw, X } from 'lucide-react';
import { SOURCE_URL, POCKETDROP_ADDRESS, addrUrl, API_BASE } from '../lib/config';
import { useHealth } from '../lib/queries';
import { RELAYER_PAUSED } from '../lib/api';
import { cx } from './ui';

const NAV = [
  { to: '/', label: 'Overview', end: true },
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/lab', label: '/lab' },
  { to: '/radar', label: '/radar' },
  { to: '/judges', label: '/judges' },
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

/** The design's "Diana 9800" chip, wired: shows the real relayer/API state and re-syncs on click. */
function SyncChip() {
  const qc = useQueryClient();
  const { data: h, isError } = useHealth();
  const fetching = useIsFetching({ queryKey: ['health'] }) + useIsFetching({ queryKey: ['stats'] }) > 0;
  const label = fetching ? 'Syncing…' : isError ? 'Diana 9800 · API offline' : h ? (h.window.live ? 'Diana 9800 · live' : 'Diana 9800 · relayer paused') : 'Diana 9800';
  return (
    <button type="button" data-testid="testnet-badge" title="Diana testnet, chain id 9800. Click to re-read the relayer and stats."
      onClick={() => { void qc.invalidateQueries(); }}
      className="hidden items-center gap-1.5 rounded-full px-3 py-1.5 font-mono text-[11px] text-zinc-600 transition-colors hover:text-zinc-900 sm:inline-flex">
      <RefreshCw className={cx('h-3 w-3', fetching && 'animate-spin')} aria-hidden />
      <span>{label}</span>
    </button>
  );
}

/** Honest banner when the relayer window has expired: say what is wrong and that funds are safe. */
function RelayerBanner() {
  const { data: h } = useHealth();
  if (!h || h.window.live !== false) return null;
  return (
    <div role="alert" data-testid="relayer-banner" className="border-b border-amber-300 bg-amber-50 px-4 py-2 text-center text-xs text-amber-950">
      {RELAYER_PAUSED}
    </div>
  );
}

export function Layout() {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  useEffect(() => { window.scrollTo(0, 0); setOpen(false); }, [pathname]);
  const mobileNav = [NAV[0], NAV[1], { to: '/claim', label: 'Claim Link' }, ...NAV.slice(2)];
  return (
    <div className="flex min-h-screen flex-col">
      <ScrollProgress />
      <header className="glass-nav sticky top-0 z-40 border-b border-zinc-200/60">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <Link to="/" className="group flex items-center gap-2 text-left" aria-label="Pocket Drop home">
            <span className="flex h-6 w-6 items-center justify-center rounded-full border border-zinc-300 bg-white text-zinc-900"><Hexagon className="h-3.5 w-3.5" aria-hidden /></span>
            <span className="font-sans text-sm font-medium tracking-tight text-zinc-900">+ Pocket Drop</span>
          </Link>
          <nav aria-label="Main" className="hidden items-center gap-6 text-xs font-medium md:flex">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end}
                className={({ isActive }) => cx('rounded-full px-2.5 py-1 transition-all', isActive ? 'nav-pill-active' : 'text-zinc-600 hover:text-zinc-900')}>
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <SyncChip />
            <Link to="/dashboard" data-testid="nav-send" className="rounded-full bg-zinc-900 px-4 py-1.5 text-xs font-medium text-stone-100 transition-all hover:bg-zinc-800">Send a Drop</Link>
            <Link to="/claim" data-testid="nav-claim" className="hidden rounded-full border border-zinc-300/80 bg-stoneCard px-4 py-1.5 text-xs font-medium text-zinc-800 transition-all hover:bg-white sm:inline-flex">Claim Link</Link>
            <button type="button" aria-label="Toggle menu" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="rounded-full border border-zinc-300 bg-white p-2 text-zinc-800 md:hidden">
              {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
          </div>
        </div>
        {open && (
          <div className="space-y-1 border-t border-zinc-200 bg-stoneBg px-4 py-3 md:hidden" data-testid="mobile-menu">
            {mobileNav.map((n) => (
              <Link key={n.to} to={n.to} className="block w-full rounded-xl px-3 py-2 text-left text-sm font-medium hover:bg-stoneCard">{n.label}</Link>
            ))}
          </div>
        )}
      </header>
      <RelayerBanner />
      <main className="flex-1"><Outlet /></main>
      <footer className="mt-12 border-t border-zinc-200/80 bg-white/70 py-14">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <div className="grid gap-8 border-b border-zinc-200/80 pb-10 md:grid-cols-12">
            <div className="md:col-span-5">
              <div className="mb-2 font-serif text-4xl text-zinc-900">Pocket Drop</div>
              <p className="max-w-xs text-xs leading-relaxed text-zinc-600">Zero-wallet onboarding. PoP-gated quantum-safe QOR distribution on QoreChain Diana Testnet.</p>
            </div>
            <div className="grid grid-cols-3 gap-6 text-xs md:col-span-7">
              <div>
                <div className="mb-3 font-mono text-[10px] uppercase tracking-widest text-zinc-400">Protocol</div>
                <ul className="space-y-2 text-zinc-600">
                  <li><Link to="/" className="hover:text-zinc-900">Overview</Link></li>
                  <li><Link to="/lab" className="hover:text-zinc-900">/lab</Link></li>
                  <li><Link to="/radar" className="hover:text-zinc-900">/radar</Link></li>
                  <li><Link to="/judges" className="hover:text-zinc-900">/judges</Link></li>
                </ul>
              </div>
              <div>
                <div className="mb-3 font-mono text-[10px] uppercase tracking-widest text-zinc-400">Developers</div>
                <ul className="space-y-2 text-zinc-600">
                  <li><a href={`${API_BASE}/api/health`} target="_blank" rel="noopener noreferrer" className="hover:text-zinc-900">/api/health</a></li>
                  <li><a href={`${API_BASE}/api/stats`} target="_blank" rel="noopener noreferrer" className="hover:text-zinc-900">/api/stats</a></li>
                  <li><a href={addrUrl(POCKETDROP_ADDRESS)} target="_blank" rel="noopener noreferrer" className="hover:text-zinc-900">Main Contract</a></li>
                  <li><a href={SOURCE_URL} target="_blank" rel="noopener noreferrer" className="hover:text-zinc-900">Source</a></li>
                </ul>
              </div>
              <div>
                <div className="mb-3 font-mono text-[10px] uppercase tracking-widest text-zinc-400">Resources</div>
                <ul className="space-y-2 text-zinc-600">
                  <li><Link to="/dashboard" className="hover:text-zinc-900">Send a Drop</Link></li>
                  <li><Link to="/claim" className="hover:text-zinc-900">Claim Link</Link></li>
                  <li><span className="text-zinc-400">MIT License</span></li>
                </ul>
              </div>
            </div>
          </div>
          <div className="flex flex-col items-center justify-between gap-2 pt-6 font-mono text-[11px] text-zinc-400 sm:flex-row">
            <span>Testnet QOR Only · No Monetary Value · Unaudited</span>
            <span>0x0A01 · 0x0A02 · Diana Testnet 9800</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

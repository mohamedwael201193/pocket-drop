import { NavLink, Outlet, Link, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { TESTNET_BADGE, SOURCE_URL, POCKETDROP_ADDRESS, addrUrl } from '../lib/config';
import { cx } from './ui';

const NAV = [
  { to: '/', label: 'Send', end: true },
  { to: '/stats', label: 'Dashboard' },
  { to: '/lab', label: 'Lab' },
  { to: '/judges', label: 'Judges' },
];

export function Layout() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return (
    <div className="dot-bg flex min-h-screen flex-col">
      <div className="bg-zinc-900 px-4 py-1.5 text-center font-mono text-[11px] tracking-wide text-stone-200" data-testid="testnet-badge">{TESTNET_BADGE}</div>
      <header className="sticky top-0 z-20 border-b border-zinc-200/80 bg-paper/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-2.5">
          <Link to="/" className="flex items-center gap-2" aria-label="Pocket Drop home">
            <span className="grid h-8 w-8 place-items-center rounded-xl bg-zinc-900 text-stone-50" aria-hidden>
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor"><path d="M12 2.5c3.5 4.4 6 7.6 6 11a6 6 0 1 1-12 0c0-3.4 2.5-6.6 6-11Z" /></svg>
            </span>
            <span className="font-serif text-xl leading-none text-zinc-900">Pocket Drop</span>
          </Link>
          <nav aria-label="Main" className="flex items-center gap-0.5 rounded-full border border-zinc-200 bg-white p-0.5">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end}
                className={({ isActive }) => cx('rounded-full px-3 py-1.5 text-xs font-medium transition sm:px-4 sm:text-sm', isActive ? 'bg-zinc-900 text-white' : 'text-zinc-600 hover:text-zinc-900')}>
                {n.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:py-10"><Outlet /></main>
      <footer className="border-t border-zinc-200 bg-white/70 px-4 py-6 text-xs text-zinc-500">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <span>Unaudited testnet software. QOR here has no monetary value.</span>
          <span className="flex flex-wrap gap-x-4 gap-y-1">
            <a className="underline" href={addrUrl(POCKETDROP_ADDRESS)} target="_blank" rel="noopener noreferrer">Contract</a>
            <a className="underline" href={SOURCE_URL} target="_blank" rel="noopener noreferrer">Source</a>
            <Link className="underline" to="/judges">Verify in 60 seconds</Link>
          </span>
        </div>
      </footer>
    </div>
  );
}

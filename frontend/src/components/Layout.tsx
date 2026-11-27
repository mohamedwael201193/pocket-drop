/**
 * The app shell: a white sidebar dashboard.
 *  - >= 1024 px: fixed left sidebar (collapsible, remembered), sliding active indicator, live network status and the Pocket chip.
 *  - 768-1023 px: an icon rail that expands over the page.
 *  - < 768 px: a slim top bar and a bottom tab bar (Send, Receive, Pocket, Proof, More); More opens a sheet with the rest.
 * Only the chrome for the current width is rendered, so every test id exists once.
 */
import { Link, Outlet, useLocation } from 'react-router-dom';
import { Suspense, useEffect, useState, type ComponentType } from 'react';
import { useIsFetching, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, MotionConfig, motion } from 'framer-motion';
import { LegacyKeyStrip } from './upgrade';
import { SpotlightTracker } from './alive';
import { SignReviewHost } from './signReview';
import { LogoMark, Wordmark } from './logo';
import { Compass, FlaskConical, Inbox, KeyRound, LayoutGrid, Menu, Radio, RefreshCw, Scale, Send, ShieldCheck, Sidebar, Wallet, X, type IconProps } from './icons';
import { SOURCE_URL, addrUrl, API_BASE } from '../lib/config';
import { CURRENT_VERSION, INST } from '../lib/v4';
import { useHealth } from '../lib/queries';
import { RELAYER_PAUSED, relayerUp } from '../lib/api';
import { useAccount } from '../lib/account';
import { useBreakpoint } from '../lib/useMedia';
import { shortAddr } from '../lib/overview';
import { cx } from './ui';
import v4 from '../data/v4.json';
import { titleFor } from '../lib/titles';

const QCAI = v4.qcai as { score?: string; stage2Score?: string; stage3Score?: string; stage4Score?: string | null; stage5Score?: string | null };
const scoreOf = (s?: string) => (s ?? '').split(' ')[0];

type Item = { key: string; label: string; to: string; Icon: ComponentType<IconProps>; match: (p: string) => boolean };
const OVERVIEW: Item = { key: 'overview', label: 'Overview', to: '/app', Icon: LayoutGrid, match: (p) => p === '/app' };
/** The primary navigation: exactly Send, Receive, Pocket, Proof. */
export const TABS: Item[] = [
  { key: 'send', label: 'Send', to: '/send', Icon: Send, match: (p) => p.startsWith('/send') },
  { key: 'receive', label: 'Receive', to: '/receive', Icon: Inbox, match: (p) => p.startsWith('/receive') || p.startsWith('/c/') || p === '/pool' || p.startsWith('/pool/') },
  { key: 'pocket', label: 'Pocket', to: '/pocket', Icon: Wallet, match: (p) => p.startsWith('/pocket') },
  { key: 'proof', label: 'Proof', to: '/proof', Icon: ShieldCheck, match: (p) => p.startsWith('/proof') },
];
/** Proof pages, listed under the divider in the sidebar and in the More sheet. */
export const PROOF_ITEMS = [
  { to: '/qday', label: 'Q-Day Drill', sub: 'Public classical keys, live: try to take the QOR', Icon: KeyRound },
  { to: '/lab', label: 'Lab', sub: 'Attacks the chain refused', Icon: FlaskConical },
  { to: '/radar', label: 'Radar', sub: 'Live stats from the chain', Icon: Radio },
  { to: '/check', label: 'Check a transaction', sub: 'Re-verify its ML-DSA-87 signatures in your browser', Icon: ShieldCheck },
  { to: '/judges', label: 'Judges', sub: '60-second checklist', Icon: Scale },
];
const SECONDARY: Item[] = [
  { key: 'qday', label: 'Q-Day drill', to: '/qday', Icon: KeyRound, match: (p) => p.startsWith('/qday') },
  { key: 'check', label: 'Check a tx', to: '/check', Icon: ShieldCheck, match: (p) => p.startsWith('/check') },
  { key: 'judges', label: 'Judges', to: '/judges', Icon: Scale, match: (p) => p.startsWith('/judges') },
  { key: 'lab', label: 'Lab', to: '/lab', Icon: FlaskConical, match: (p) => p.startsWith('/lab') },
  { key: 'radar', label: 'Radar', to: '/radar', Icon: Radio, match: (p) => p.startsWith('/radar') },
  { key: 'about', label: 'How it works', to: '/', Icon: Compass, match: () => false },
];
const proofFamily = (p: string) => ['/proof', '/lab', '/radar', '/judges', '/qday', '/check'].some((x) => p.startsWith(x));

function ScrollProgress() {
  const [w, setW] = useState(0);
  useEffect(() => {
    const f = () => { const h = document.documentElement.scrollHeight - window.innerHeight; setW(h > 0 ? (window.scrollY / h) * 100 : 0); };
    window.addEventListener('scroll', f, { passive: true }); f();
    return () => window.removeEventListener('scroll', f);
  }, []);
  return <div className="fixed left-0 top-0 z-[70] h-[2px] bg-gradient-to-r from-emerald-400 to-accent" style={{ width: `${w}%` }} aria-hidden />;
}

/** Slow, soft colour fields behind the page (transform-only, off for reduced motion). */
function Ambient() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="ambient-blob ambient-a" />
      <div className="ambient-blob ambient-b" />
      <div className="ambient-grid" />
    </div>
  );
}

function useNet() {
  const { data: h, isError } = useHealth();
  const fetching = useIsFetching({ queryKey: ['health'] }) > 0;
  const up = relayerUp(h) && !isError;
  const label = fetching && !h ? 'Connecting to Diana…' : isError ? 'Diana 9800 · API offline' : h ? (relayerUp(h) ? 'Diana 9800 · live' : 'Diana 9800 · relayer paused') : 'Diana 9800';
  return { h, up, label, fetching };
}

function NetChip({ compact }: { compact?: boolean }) {
  const qc = useQueryClient();
  const { up, label, fetching } = useNet();
  return (
    <button type="button" data-testid="testnet-badge" title="Diana testnet, chain id 9800. Click to re-read the relayer and stats." onClick={() => { void qc.invalidateQueries(); }}
      className={cx('inline-flex min-h-[36px] items-center gap-2 rounded-full text-[13px] font-medium text-zinc-700 transition-colors hover:text-zinc-950', compact ? 'border border-zinc-200 bg-white px-3' : '')}>
      {up ? <span className="live-dot animate-pulseDot" aria-hidden /> : <RefreshCw className={cx('h-3.5 w-3.5', fetching && 'animate-spin')} aria-hidden />}
      <span>{label}</span>
    </button>
  );
}

function BlockHeight() {
  const { h } = useNet();
  const n = h?.headBlock ? Number(h.headBlock) : null;
  return (
    <div className="mt-1 flex items-center justify-between font-mono text-xs text-zinc-500" data-testid="side-block" title="Head block read from the relayer API (LIVE, every 30 s)">
      <span>block</span>
      {/* old and new number share one grid cell, so no popLayout (its injected <style> is blocked by the CSP) */}
      <span className="grid overflow-hidden text-right">
        <AnimatePresence initial={false}>
          <motion.span key={n ?? 'none'} initial={{ y: -8, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 8, opacity: 0 }} transition={{ duration: 0.3 }} className="col-start-1 row-start-1 tabular-nums text-zinc-700">
            {n ? n.toLocaleString('en-US') : '…'}
          </motion.span>
        </AnimatePresence>
      </span>
    </div>
  );
}

function PocketChip() {
  const { activePocket, root } = useAccount();
  return (
    <Link to="/pocket" data-testid="side-pocket" title={activePocket ?? 'No Pocket in this browser yet'}
      className="mt-2.5 flex min-h-[40px] items-center gap-2 rounded-xl border border-zinc-200 bg-white px-2.5 text-[13px] text-zinc-800 transition-colors hover:border-emerald-300">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-accent"><Wallet className="h-3.5 w-3.5" /></span>
      <span className="truncate font-mono">{activePocket ? shortAddr(activePocket) : root ? 'Deriving…' : 'No Pocket yet'}</span>
    </Link>
  );
}

function SideLink({ item, active, collapsed, group }: { item: Item; active: boolean; collapsed: boolean; group: string }) {
  const { Icon } = item;
  return (
    <Link to={item.to} data-testid={group === 'main' ? `nav-${item.key}` : `side-${item.key}`} title={collapsed ? item.label : undefined}
      aria-current={active ? 'page' : undefined}
      className={cx('group relative flex min-h-[38px] items-center gap-3 rounded-xl px-3 text-[15px] font-medium transition-colors', active ? 'text-emerald-900' : 'text-zinc-600 hover:text-zinc-950', collapsed && 'justify-center px-0')}>
      {active && <motion.span layoutId="side-active" className="absolute inset-0 rounded-xl bg-emerald-50 ring-1 ring-emerald-100" transition={{ type: 'spring', stiffness: 520, damping: 42 }} />}
      {active && <motion.span layoutId="side-bar" className="absolute -left-3 top-2 bottom-2 w-[3px] rounded-r-full bg-accent" transition={{ type: 'spring', stiffness: 520, damping: 42 }} />}
      {!active && <span className="absolute inset-0 rounded-xl bg-zinc-100 opacity-0 transition-opacity group-hover:opacity-100" />}
      <Icon className={cx('relative h-[20px] w-[20px] transition-transform duration-300 group-hover:scale-110', active ? 'text-accent' : 'text-zinc-500 group-hover:text-zinc-800')} weight={active ? 'fill' : undefined} />
      {!collapsed && <span className="relative truncate">{item.label}</span>}
    </Link>
  );
}

function SidebarNav({ collapsed, onToggle, overlay }: { collapsed: boolean; onToggle: () => void; overlay?: boolean }) {
  const { pathname } = useLocation();
  const net = useNet();
  return (
    <motion.aside data-testid="sidebar" aria-label="Sidebar" initial={false} animate={{ width: collapsed ? 76 : 256 }} transition={{ type: 'spring', stiffness: 380, damping: 38 }}
      className={cx('fixed inset-y-0 left-0 z-40 flex flex-col border-r border-zinc-200/80 bg-white/95 backdrop-blur', overlay && !collapsed && 'shadow-2xl')}>
      <div className={cx('flex h-[68px] shrink-0 items-center gap-2.5', collapsed ? 'justify-center px-2' : 'px-5')}>
        <Link to="/" className="group flex min-h-[44px] items-center gap-2.5" aria-label="Pocket Drop home page" title="Back to the Pocket Drop home page" data-testid="logo">
          <LogoMark size={32} pulse={pathname} />
          {!collapsed && <Wordmark />}
        </Link>
        {!collapsed && (
          <button type="button" onClick={onToggle} data-testid="sidebar-toggle" aria-label="Collapse sidebar" aria-expanded title="Collapse sidebar"
            className="ml-auto flex h-9 w-9 items-center justify-center rounded-xl text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-900">
            <Sidebar className="h-4 w-4" />
          </button>
        )}
      </div>
      <nav aria-label="Main" className={cx('flex-1 overflow-y-auto overflow-x-hidden pb-4 pt-2', collapsed ? 'px-2.5' : 'px-4')}>
        <div className="space-y-0.5">
          <SideLink item={OVERVIEW} active={OVERVIEW.match(pathname)} collapsed={collapsed} group="main" />
          {TABS.map((t) => <SideLink key={t.key} item={t} active={t.match(pathname)} collapsed={collapsed} group="main" />)}
        </div>
        <div className="my-3 h-px bg-zinc-200/80" role="separator" />
        {!collapsed && <p className="mb-1.5 px-3 text-xs font-medium uppercase tracking-[0.14em] text-zinc-400">Verify</p>}
        <div className="space-y-0.5">
          {SECONDARY.map((t) => <SideLink key={t.key} item={t} active={t.match(pathname)} collapsed={collapsed} group="side" />)}
        </div>
      </nav>
      <div className={cx('shrink-0 border-t border-zinc-200/80', collapsed ? 'p-2.5' : 'p-4')}>
        {collapsed ? (
          <div className="flex flex-col items-center gap-2">
            <span className={cx('live-dot', net.up ? 'animate-pulseDot' : 'bg-amber-500')} title={net.label} role="img" aria-label={net.label} />
          </div>
        ) : (
          <div className="rounded-2xl border border-zinc-200/80 bg-zinc-50/70 p-3" data-testid="side-status">
            <NetChip />
            <BlockHeight />
            <PocketChip />
          </div>
        )}
        {collapsed && (
          <button type="button" onClick={onToggle} data-testid="sidebar-toggle" aria-label="Expand sidebar" aria-expanded={false} title="Expand sidebar"
            className="mt-2 flex min-h-[36px] w-full items-center justify-center rounded-xl text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900">
            <Sidebar className="h-4 w-4" />
          </button>
        )}
      </div>
    </motion.aside>
  );
}

function MobileTop() {
  const { pathname } = useLocation();
  return (
    <header className="sticky top-0 z-40 border-b border-zinc-200/80 bg-[#F7F7F5]/85 backdrop-blur-md">
      <div className="flex h-14 items-center justify-between gap-3 px-4">
        <Link to="/" className="flex min-h-[44px] items-center gap-2" aria-label="Pocket Drop home page" title="Back to the Pocket Drop home page" data-testid="logo">
          <LogoMark size={28} pulse={pathname} /><Wordmark className="text-[17px]" />
        </Link>
        <NetChip compact />
      </div>
    </header>
  );
}

function MoreSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { pathname } = useLocation();
  useEffect(() => { onClose(); }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div key="scrim" className="fixed inset-0 z-50 bg-zinc-950/30 backdrop-blur-[2px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} aria-hidden />
          <motion.div key="sheet" role="dialog" aria-modal="true" aria-label="More" data-testid="more-sheet"
            className="fixed inset-x-0 bottom-0 z-50 rounded-t-[28px] border-t border-zinc-200 bg-white px-4 pb-[calc(env(safe-area-inset-bottom)+16px)] pt-3 shadow-2xl"
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', stiffness: 420, damping: 40 }}>
            <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-zinc-200" aria-hidden />
            <div className="mb-2 flex items-center justify-between">
              <span className="font-display text-lg font-semibold text-zinc-900">More</span>
              <button type="button" onClick={onClose} aria-label="Close" className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-zinc-100"><X className="h-5 w-5" /></button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {[OVERVIEW, ...SECONDARY].map((t, i) => (
                <motion.div key={t.key} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.03 * i }}>
                  <Link to={t.to} data-testid={`more-${t.key}`} className={cx('flex min-h-[52px] items-center gap-2.5 rounded-2xl border px-3 text-[15px] font-medium', t.match(pathname) ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-zinc-200 text-zinc-800')}>
                    <t.Icon className="h-5 w-5 text-accent" />{t.label}
                  </Link>
                </motion.div>
              ))}
            </div>
            <div className="mt-3 rounded-2xl border border-zinc-200/80 bg-zinc-50/70 p-3"><BlockHeight /><PocketChip /></div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function TabBar() {
  const { pathname } = useLocation();
  const [more, setMore] = useState(false);
  const isActive = (t: Item) => (t.key === 'proof' ? proofFamily(pathname) : t.match(pathname));
  const moreActive = !TABS.some(isActive);
  return (
    <>
      <nav aria-label="Tabs" data-testid="tabbar" className="fixed inset-x-0 bottom-0 z-40 border-t border-zinc-200/80 bg-white/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-md">
        <div className="mx-auto grid max-w-md grid-cols-5">
          {TABS.map((t) => {
            const on = isActive(t);
            return (
              <Link key={t.key} to={t.to} data-testid={`tab-${t.key}`} aria-current={on ? 'page' : undefined}
                className={cx('relative flex min-h-[60px] flex-col items-center justify-center gap-1 text-[12px] font-medium transition-colors', on ? 'text-emerald-900' : 'text-zinc-500')}>
                {on && <motion.span layoutId="tab-pill" className="absolute top-1.5 h-8 w-14 rounded-full bg-emerald-50" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
                <motion.span className="relative flex" animate={on ? { y: -1, scale: 1.08 } : { y: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 500, damping: 26 }}>
                  <t.Icon className={cx('h-[22px] w-[22px]', on && 'text-accent')} weight={on ? 'fill' : 'duotone'} />
                </motion.span>
                <span className="relative">{t.label}</span>
              </Link>
            );
          })}
          <button type="button" data-testid="tab-more" aria-haspopup="dialog" aria-expanded={more} onClick={() => setMore(true)}
            className={cx('relative flex min-h-[60px] flex-col items-center justify-center gap-1 text-[12px] font-medium', moreActive ? 'text-emerald-900' : 'text-zinc-500')}>
            {moreActive && <motion.span layoutId="tab-pill" className="absolute top-1.5 h-8 w-14 rounded-full bg-emerald-50" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
            <Menu className={cx('relative h-[22px] w-[22px]', moreActive && 'text-accent')} /><span className="relative">More</span>
          </button>
        </div>
      </nav>
      <MoreSheet open={more} onClose={() => setMore(false)} />
    </>
  );
}

function RelayerBanner() {
  const { data: h } = useHealth();
  if (!h || relayerUp(h)) return null;
  return <div role="alert" data-testid="relayer-banner" className="border-b border-amber-300 bg-amber-50 px-4 py-2 text-center text-xs text-amber-950">{RELAYER_PAUSED}</div>;
}

function PageFallback() {
  return (
    <div className="mx-auto max-w-5xl space-y-4 px-4 pt-10 sm:px-6 lg:px-8" data-testid="page-loading">
      <div className="skeleton h-40 w-full rounded-[22px]" />
      <div className="grid gap-4 sm:grid-cols-3"><div className="skeleton h-32 rounded-[22px]" /><div className="skeleton h-32 rounded-[22px]" /><div className="skeleton h-32 rounded-[22px]" /></div>
    </div>
  );
}

const SIDE_KEY = 'pd.sidebar.collapsed';
export function Layout() {
  const { pathname } = useLocation();
  const bp = useBreakpoint();
  const [pref, setPref] = useState<boolean>(() => { try { return localStorage.getItem(SIDE_KEY) === '1'; } catch { return false; } });
  const [railOpen, setRailOpen] = useState(false);
  useEffect(() => { window.scrollTo(0, 0); document.title = titleFor(pathname); setRailOpen(false); }, [pathname]);
  const collapsed = bp === 'tablet' ? !railOpen : pref;
  const toggle = () => {
    if (bp === 'tablet') { setRailOpen((v) => !v); return; }
    setPref((v) => { const n = !v; try { localStorage.setItem(SIDE_KEY, n ? '1' : '0'); } catch { /* ignore */ } return n; });
  };
  const pad = bp === 'mobile' ? 0 : bp === 'tablet' ? 76 : collapsed ? 76 : 256;
  return (
    <MotionConfig reducedMotion="user">
      <Ambient />
      <ScrollProgress />
      <SpotlightTracker />
      {bp !== 'mobile' && <SidebarNav collapsed={collapsed} onToggle={toggle} overlay={bp === 'tablet'} />}
      {bp === 'tablet' && railOpen && <div className="fixed inset-0 z-30 bg-zinc-950/10" onClick={() => setRailOpen(false)} aria-hidden />}
      <div className="flex min-h-screen flex-col transition-[padding] duration-300 ease-out" style={{ paddingLeft: pad }} data-shell={bp}>
        {bp === 'mobile' && <MobileTop />}
        <RelayerBanner />
        <LegacyKeyStrip path={pathname} />
        <main className="flex-1">
          <Suspense fallback={<PageFallback />}>
            <motion.div key={pathname} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1] }}>
              <Outlet />
            </motion.div>
          </Suspense>
        </main>
        <footer className="border-t border-zinc-200/70 py-6">
          <div className={cx('mx-auto flex max-w-5xl flex-col items-center justify-between gap-3 px-4 text-center text-[13px] text-zinc-600 sm:flex-row sm:px-6 sm:text-left lg:px-8', bp === 'mobile' && 'pb-20')}>
            <span>Testnet QOR only · No monetary value · <a href={`${SOURCE_URL}/blob/main/docs/AUDIT.md`} target="_blank" rel="noopener noreferrer" className="underline decoration-zinc-300 underline-offset-2 hover:text-zinc-900" data-testid="footer-audit">QCAI automated audit {scoreOf(QCAI.score)}, {scoreOf(QCAI.stage2Score)}, {scoreOf(QCAI.stage3Score)} (v5), then {scoreOf(QCAI.stage4Score ?? undefined)} (v5.1) and {scoreOf(QCAI.stage5Score ?? undefined)} (v5.2) of 100 · no human audit</a> · <span className="whitespace-nowrap">Diana 9800</span></span>
            <span className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
              <a href={`${API_BASE}/api/health`} target="_blank" rel="noopener noreferrer" className="hover:text-zinc-900">API health</a>
              <a href={addrUrl(INST.prod.router)} target="_blank" rel="noopener noreferrer" className="hover:text-zinc-900">router ({CURRENT_VERSION})</a>
              <a href={SOURCE_URL} target="_blank" rel="noopener noreferrer" className="hover:text-zinc-900">Source</a>
            </span>
          </div>
        </footer>
        {bp === 'mobile' && <TabBar />}
      </div>
      <SignReviewHost />
    </MotionConfig>
  );
}

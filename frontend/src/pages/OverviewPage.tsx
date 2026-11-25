/**
 * Overview: the dashboard home. Bento cards wired to LIVE reads only:
 *  - Your Pocket: balance of the active Pocket (chain), its address and whether its key is ML-DSA-87 protected (pqcKeyStatus).
 *  - Quantum safety: key registered, possession proven (pqcKeyStatus precompile) and the relay lane (/api/health).
 *  - Proof: hybrid-signed relays verified by the chain (/api/stats) and a sparkline of every v4 event by block (contract logs).
 *  - Recent activity: the latest production events on Diana (v5 and the previous v4) (contract logs), each opening in the transaction checker.
 * Test counts are RECORDED (frontend/src/data/tests.json). Nothing here is a mock.
 */
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { ArrowRight, ArrowUpRight, Check, CircleDashed, Inbox, KeyRound, Search, Send, ShieldCheck, XCircle, Zap } from '../components/icons';
import { CountUp, motionOk } from '../components/alive';
import { Bento, GaugeRing, Shimmer, Sparkline } from '../components/viz';
import { CopyButton, SourceBadge, cx } from '../components/ui';
import { useAccount, useKeyAccount, usePocketView } from '../lib/account';
import { useHealth, useStats } from '../lib/queries';
import { ago, cumulativeSeries, safetyChecks, safetyScore, shortAddr, type CheckState } from '../lib/overview';
import tests from '../data/tests.json';

const qorNum = (wei: bigint) => Number(wei) / 1e18;
const fmtBal = (n: number) => (n >= 100 ? n.toFixed(2) : n >= 1 ? n.toFixed(2) : n.toFixed(4));

function useActivity() {
  // production on the current v5 contracts plus the previous v4 contracts, merged newest first
  return useQuery({
    queryKey: ['radar', 'prod+prodV4'], refetchInterval: 60_000, retry: 1, staleTime: 30_000,
    queryFn: async () => {
      const m = await import('../lib/radar');
      const [a, b] = await Promise.all([m.envStats('prod'), m.envStats('prodV4')]);
      return {
        pockets: a.pockets + b.pockets,
        hybridEvents: a.hybridEvents == null || b.hybridEvents == null ? null : a.hybridEvents + b.hybridEvents,
        eventBlocks: [...(a.eventBlocks ?? []), ...(b.eventBlocks ?? [])].sort((x, y) => x - y),
        recent: [...a.recent.map((r) => ({ ...r, gen: 'v5' })), ...b.recent.map((r) => ({ ...r, gen: 'v4' }))].sort((x, y) => (x.block === y.block ? 0 : x.block > y.block ? -1 : 1)),
      };
    },
  });
}

function CardHead({ title, badge, to }: { title: string; badge?: ReactNode; to?: string }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <h2 className="font-display text-[17px] font-semibold tracking-[-0.01em] text-zinc-900">{title}</h2>
      <div className="flex items-center gap-2">{badge}{to && <Link to={to} aria-label={`Open ${title}`} className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900"><ArrowUpRight className="h-4 w-4" /></Link>}</div>
    </div>
  );
}

function PocketCardO() {
  const a = useAccount();
  const { data: pv, isLoading } = usePocketView();
  const { status, ready } = useKeyAccount();
  return (
    <Bento i={0} className="lg:col-span-5" testId="ov-pocket">
      <CardHead title="Your Pocket" badge={a.activePocket ? <SourceBadge kind="LIVE" title="Balance read from Diana just now" /> : undefined} to="/pocket" />
      {!a.root ? (
        <div data-testid="ov-pocket-empty">
          <p className="font-display text-[2.6rem] font-semibold leading-none tracking-[-0.04em] text-zinc-300">0 <span className="text-2xl">QOR</span></p>
          <p className="mt-3 max-w-sm text-sm leading-relaxed text-zinc-600">No Pocket in this browser yet. Open a link someone sent you, or create your quantum-safe key on Send. Your key never leaves this tab.</p>
        </div>
      ) : (
        <div>
          <p className="font-display text-[2.9rem] font-semibold leading-none tracking-[-0.045em] text-zinc-950" data-testid="ov-balance" data-wei={pv ? pv.balance.toString() : ''}>
            {pv ? <CountUp value={qorNum(pv.balance)} format={fmtBal} /> : isLoading || !a.activePocket ? <Shimmer className="h-10 w-40" /> : '…'}
            <span className="ml-2 text-2xl font-medium text-zinc-500">QOR</span>
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span data-testid="ov-protected" data-state={!status ? 'loading' : ready ? 'ok' : 'no'} className={cx('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium', ready ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-zinc-200 bg-zinc-50 text-zinc-600')}>
              <ShieldCheck className="h-3.5 w-3.5" weight={ready ? 'fill' : undefined} />{!status ? 'Reading key status…' : ready ? 'ML-DSA-87 protected' : 'Key not registered yet'}
            </span>
            {a.activePocket && <span className="font-mono text-xs text-zinc-500" title={a.activePocket} data-testid="ov-address">{shortAddr(a.activePocket)}</span>}
            {pv && !pv.deployed && <span className="text-xs text-zinc-500">not deployed yet (made on first use)</span>}
            {pv?.frozen && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-900">frozen by guardians</span>}
          </div>
        </div>
      )}
      <div className="mt-6 flex flex-wrap gap-2.5">
        <Link to="/send" data-testid="ov-send" className="press inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-accent px-5 text-[15px] font-medium text-white shadow-[0_8px_20px_-8px_rgba(15,107,74,.6)] transition-colors hover:bg-accentHover"><Send className="h-4 w-4" weight="fill" />Send drop</Link>
        <Link to="/receive" data-testid="ov-receive" className="press inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-zinc-200 bg-white px-5 text-[15px] font-medium text-zinc-900 transition-colors hover:border-zinc-300 hover:bg-zinc-50"><Inbox className="h-4 w-4" />Receive</Link>
        {a.activePocket && <CopyButton text={a.activePocket} label="Copy address" className="!min-h-[44px] !rounded-xl" />}
      </div>
    </Bento>
  );
}

const ICON: Record<CheckState, ReactNode> = {
  ok: <Check className="h-4 w-4 text-accent" />, no: <XCircle className="h-4 w-4 text-amber-600" />,
  unknown: <CircleDashed className="h-4 w-4 animate-spin text-zinc-400" />, nokey: <CircleDashed className="h-4 w-4 text-zinc-300" />,
};

function SafetyCard() {
  const a = useAccount();
  const { status } = useKeyAccount();
  const { data: h } = useHealth();
  const checks = safetyChecks(!!a.root, status, h);
  const sc = safetyScore(checks);
  return (
    <Bento i={1} className="lg:col-span-4" testId="ov-safety">
      <CardHead title="Quantum safety" badge={<SourceBadge kind="LIVE" title="pqcKeyStatus precompile and /api/health, read just now" />} />
      <div className="flex items-center gap-5">
        <GaugeRing pct={sc.ready ? sc.pct : null} size={118} stroke={11} testId="ov-gauge"
          label={sc.ready ? <><span className="font-display text-2xl font-semibold tracking-tight text-zinc-950"><CountUp value={sc.pct} />%</span><span className="text-[11px] text-zinc-500" data-testid="ov-gauge-ratio">{sc.passed} of {sc.total}</span></> : <Shimmer className="h-5 w-12" />} />
        <ul className="min-w-0 flex-1 space-y-2.5">
          {checks.map((c, i) => (
            <motion.li key={c.id} data-testid={`ov-check-${c.id}`} data-state={c.state} className="flex items-start gap-2"
              initial={motionOk() ? { opacity: 0, x: 8 } : false} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.35 + i * 0.12 }}>
              <span className="mt-0.5">{ICON[c.state]}</span>
              <span className="min-w-0"><span className={cx('block text-sm font-medium', c.state === 'nokey' ? 'text-zinc-500' : 'text-zinc-900')}>{c.label}</span><span className="block text-xs leading-snug text-zinc-500">{c.detail}</span></span>
            </motion.li>
          ))}
        </ul>
      </div>
      {!a.root && <Link to="/send" data-testid="ov-create-key" className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:text-accentHover"><KeyRound className="h-4 w-4" />Create your key on Send <ArrowRight className="h-4 w-4" /></Link>}
    </Bento>
  );
}

function ProofCard() {
  const { data: s } = useStats();
  const { data: act } = useActivity();
  const v4 = s?.v4 as { prod?: { hybridRelayEvents?: number }; prodV4?: { hybridRelayEvents?: number } } | undefined;
  const apiHybrid = v4?.prod?.hybridRelayEvents != null && v4?.prodV4?.hybridRelayEvents != null ? v4.prod.hybridRelayEvents + v4.prodV4.hybridRelayEvents : null;
  const hybrid = apiHybrid ?? act?.hybridEvents ?? null;
  const series = cumulativeSeries(act?.eventBlocks ?? [], 28);
  return (
    <Bento i={2} className="lg:col-span-3" testId="ov-proof">
      <CardHead title="Proof" badge={<SourceBadge kind="LIVE" title="/api/stats and contract logs, read just now" />} to="/proof" />
      <p className="font-display text-[2.6rem] font-semibold leading-none tracking-[-0.04em] text-zinc-950" data-testid="ov-hybrid" data-value={hybrid ?? ''}>
        {hybrid !== null ? <CountUp value={hybrid} /> : <Shimmer className="h-9 w-16" />}
      </p>
      <p className="mt-1.5 text-sm text-zinc-600">hybrid-signed relays the chain verified (secp256k1 + ML-DSA-87)</p>
      <div className="mt-3"><Sparkline values={series} testId="ov-spark" /></div>
      <p className="mt-1 text-xs text-zinc-500" data-testid="ov-events">{act ? `${act.eventBlocks?.length ?? 0} events (v5 + v4) · ${act.pockets} Pockets on chain` : 'Counting events…'}</p>
    </Bento>
  );
}

function ActivityCard() {
  const { data: act, isLoading, error } = useActivity();
  const a = useAccount();
  const mine = new Set([a.acct?.evm, a.activePocket, ...a.adopted].filter(Boolean).map((x) => String(x).toLowerCase()));
  return (
    <Bento i={3} className="lg:col-span-8" testId="ov-activity">
      <CardHead title="Recent activity" badge={<SourceBadge kind="LIVE" title="PocketFactory, PocketDrop and DropPool events on Diana (production, current v5 and previous v4), read just now" />} to="/radar" />
      <div className="overflow-hidden rounded-2xl border border-zinc-200/80">
        <table className="w-full text-left text-sm">
          <thead className="bg-zinc-50/80 text-xs text-zinc-500"><tr><th className="px-4 py-2.5 font-medium">Action</th><th className="hidden px-4 py-2.5 font-medium sm:table-cell">Ref</th><th className="px-4 py-2.5 font-medium">When</th><th className="px-4 py-2.5 text-right font-medium">Tx</th></tr></thead>
          <tbody data-testid="ov-activity-rows">
            {act ? act.recent.slice(0, 6).map((r, i) => (
              <motion.tr key={r.tx + r.kind} className="border-t border-zinc-100 transition-colors hover:bg-emerald-50/40"
                initial={motionOk() ? { opacity: 0, y: 6 } : false} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 * i }}>
                <td className="px-4 py-2.5 text-zinc-900">
                  <span className="inline-flex items-center gap-2"><span className={cx('h-1.5 w-1.5 rounded-full', r.kind.includes('claimed') ? 'bg-emerald-500' : r.kind.includes('Pocket') ? 'bg-zinc-400' : 'bg-accent')} />{r.kind}</span>
                  {mine.has(r.who.toLowerCase()) && <span className="ml-2 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-800">yours</span>}
                </td>
                <td className="hidden px-4 py-2.5 font-mono text-xs text-zinc-600 sm:table-cell">{r.id.startsWith('0x') ? shortAddr(r.id) : r.id} <span className="text-zinc-400">{r.gen}</span></td>
                <td className="px-4 py-2.5 text-xs text-zinc-600">{r.at ? ago(r.at) : `block ${r.block.toString()}`}</td>
                <td className="px-4 py-2.5 text-right"><Link to={`/check/${r.tx}`} className="font-mono text-xs text-zinc-700 underline decoration-zinc-300 underline-offset-2 hover:text-accent" title="Re-verify this transaction">{shortAddr(r.tx)}</Link></td>
              </motion.tr>
            )) : Array.from({ length: 4 }, (_, i) => (
              <tr key={i} className="border-t border-zinc-100"><td className="px-4 py-3" colSpan={4}>{error ? (i === 0 ? <span className="text-xs text-zinc-500">Could not read the chain logs: {(error as Error).message}</span> : null) : <Shimmer className={cx('h-4', i % 2 ? 'w-2/3' : 'w-5/6')} />}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      {act && act.recent.length === 0 && <p className="mt-3 text-sm text-zinc-500">No events yet.</p>}
      {!act && isLoading && <p className="mt-3 text-xs text-zinc-500">Reading contract events from Diana…</p>}
    </Bento>
  );
}

function RelayerCard() {
  const { data: h } = useHealth();
  const bal = h?.relayer?.balance ? Number(h.relayer.balance) : null;
  return (
    <Bento i={4} as="div" testId="ov-relayer">
      <CardHead title="Relayer" badge={<SourceBadge kind="LIVE" title="/api/health, read just now" />} />
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="font-display text-2xl font-semibold tracking-tight text-zinc-950" data-testid="ov-relayer-balance">{bal !== null ? <><CountUp value={bal} format={(n) => n.toFixed(2)} /> <span className="text-base font-medium text-zinc-500">QOR</span></> : <Shimmer className="h-7 w-24" />}</p>
          <p className="mt-1 text-xs text-zinc-500">pays network fees, so receivers need no gas</p>
        </div>
        <span className={cx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium', h?.relay?.mode === 'hybrid' ? 'bg-emerald-50 text-emerald-900' : 'bg-zinc-100 text-zinc-700')} data-testid="ov-relay-mode">
          <Zap className="h-3.5 w-3.5" weight="fill" />{h?.relay?.mode === 'hybrid' ? 'hybrid lane' : h?.relay?.mode === 'evm' ? 'EVM window lane' : '…'}
        </span>
      </div>
    </Bento>
  );
}

function TestsCard() {
  const fe = tests.frontend, be = tests.backend;
  return (
    <Bento i={5} as="div" testId="ov-tests">
      <CardHead title="Tests" badge={<SourceBadge kind="RECORDED" title={`frontend/src/data/tests.json, recorded ${tests.recordedAt.slice(0, 10)}`} />} to="/judges" />
      <div className="grid grid-cols-2 gap-3">
        <div><p className="font-display text-2xl font-semibold tracking-tight text-zinc-950"><CountUp value={fe.passed} /></p><p className="text-xs text-zinc-500">app tests pass ({fe.failed} failed)</p></div>
        <div><p className="font-display text-2xl font-semibold tracking-tight text-zinc-950"><CountUp value={be.passed} /></p><p className="text-xs text-zinc-500">relayer tests pass ({be.failed} failed)</p></div>
      </div>
    </Bento>
  );
}

function DrillCard() {
  return (
    <Bento i={6} as="div" className="!bg-zinc-950 !border-zinc-900 text-white" testId="ov-qday">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10 text-emerald-300"><KeyRound className="h-5 w-5" /></span>
        <div className="min-w-0">
          <p className="font-display text-[17px] font-semibold">Q-Day drill</p>
          <p className="mt-1 text-sm leading-snug text-zinc-300">Classical keys of real Pockets are public. Try to take the QOR.</p>
          <Link to="/qday" className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-emerald-300 hover:text-emerald-200">Open the drill <ArrowRight className="h-4 w-4" /></Link>
        </div>
      </div>
    </Bento>
  );
}

function CheckSearch() {
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const submit = (e: FormEvent) => { e.preventDefault(); const v = q.trim(); nav(v ? `/check/${v}` : '/check'); };
  return (
    <form onSubmit={submit} role="search" className="relative w-full sm:w-72" data-testid="ov-search">
      <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Check a tx hash or Pocket" aria-label="Check a transaction hash or Pocket address"
        className="!h-11 !min-h-[44px] w-full !rounded-xl !border !border-zinc-200 !bg-white !pl-10 !pr-3 text-[15px] text-zinc-900 !shadow-sm outline-none transition-[border-color,box-shadow] placeholder:text-zinc-400 focus:!border-emerald-400 focus:!shadow-[0_0_0_4px_rgba(16,185,129,.15)]" />
    </form>
  );
}

export default function OverviewPage() {
  const a = useAccount();
  const { data: pv } = usePocketView();
  return (
    <div className="mx-auto max-w-6xl px-4 pb-28 pt-6 sm:px-6 sm:pb-16 sm:pt-8 lg:px-8" data-testid="overview">
      <motion.div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between" initial={motionOk() ? { opacity: 0, y: 10 } : false} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45 }}>
        <div>
          <h1 className="font-display text-[2rem] font-semibold leading-tight tracking-[-0.035em] text-zinc-950">Overview</h1>
          <p className="text-[15px] text-zinc-600">{a.root ? 'Your Pocket at a glance' : 'Send testnet QOR through a link. Your friend needs no wallet.'}</p>
        </div>
        <div className="flex items-center gap-2.5">
          <CheckSearch />
          <Link to="/send" data-testid="ov-new-drop" className="press hidden min-h-[44px] shrink-0 items-center gap-2 rounded-xl bg-zinc-950 px-4 text-[15px] font-medium text-white hover:bg-zinc-800 sm:inline-flex">New drop</Link>
        </div>
      </motion.div>
      {pv?.queue.some((q) => q.state === 'Pending') && (
        <Link to="/pocket" className="mb-4 flex items-center justify-between rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950" data-testid="ov-queued">
          <span>A spend is waiting in your Pocket&apos;s timelock. You can stop it on the Pocket page.</span><ArrowRight className="h-4 w-4" />
        </Link>
      )}
      <div className="grid gap-4 lg:grid-cols-12">
        <PocketCardO />
        <SafetyCard />
        <ProofCard />
        <ActivityCard />
        <div className="grid gap-4 lg:col-span-4">
          <RelayerCard />
          <TestsCard />
          <DrillCard />
        </div>
      </div>
      <p className="mt-6 text-xs text-zinc-500">Diana testnet (EVM 9800) only; QOR here has no monetary value. LIVE values are read when this page opens; RECORDED values come from files in the repository.</p>
    </div>
  );
}

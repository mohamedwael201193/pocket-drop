import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Notice, SourceBadge, TxLink, cx } from '../components/ui';
import { Dash, Reveal } from '../components/bits';
import { PHONE } from '../data/proofs';
import latency from '../data/latency.json';
import { API_BASE, addrUrl, LAB_ADDRESS, POCKETDROP_ADDRESS } from '../lib/config';
import { pub } from '../lib/chain';
import { pocketDropAbi } from '../lib/abi';
import { useHealth, useStats } from '../lib/queries';

interface LatencyRun { label: string; date: string; stepsMs: Record<string, number> }
const RUNS = (latency as { runs: LatencyRun[] }).runs;
const STEPS: [string, string][] = [['key', 'Browser keygen'], ['bind', 'Bind (drip lands)'], ['register', 'PoP register'], ['window', 'Scoped window'], ['claim', 'Escrow claim']];

function Bars({ rows, unit = 's', testId }: { rows: { label: string; value: number; tone?: string }[]; unit?: string; testId?: string }) {
  const max = Math.max(0.001, ...rows.map((r) => r.value));
  return (
    <div className="space-y-3" data-testid={testId}>
      {rows.map((r) => (
        <div key={r.label}>
          <div className="flex justify-between text-xs"><span className="text-zinc-700">{r.label}</span><span className="font-mono text-zinc-900">{r.value < 0.1 ? r.value.toFixed(3) : r.value.toFixed(1)} {unit}</span></div>
          <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-stoneCard">
            <motion.div className={cx('h-full rounded-full', r.tone ?? 'bg-zinc-900')} initial={{ width: 0 }} animate={{ width: `${Math.max(2, (r.value / max) * 100)}%` }} transition={{ duration: 0.7, ease: 'easeOut' }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function Funnel({ label, value, max, tone }: { label: string; value: number; max: number; tone: string }) {
  const pct = max > 0 ? Math.max(value > 0 ? 4 : 0, Math.round((value / max) * 100)) : 0;
  return (
    <div>
      <div className="flex justify-between text-xs"><span className="text-zinc-700">{label}</span><span className="font-mono text-zinc-900">{value}</span></div>
      <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-stoneCard"><motion.div className={cx('h-full rounded-full', tone)} initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.7, ease: 'easeOut' }} /></div>
    </div>
  );
}

function useLinkCounts() {
  return useQuery({
    queryKey: ['link-counts'], refetchInterval: 30_000,
    queryFn: async () => {
      const read = (address: `0x${string}`) => pub.readContract({ address, abi: pocketDropAbi, functionName: 'linkCount' }) as Promise<bigint>;
      const [main, lab, head] = await Promise.all([read(POCKETDROP_ADDRESS), read(LAB_ADDRESS), pub.getBlockNumber()]);
      return { main: main.toString(), lab: lab.toString(), head: head.toString() };
    },
  });
}

const card = 'rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm';

export default function RadarPage() {
  const { data: s, error } = useStats();
  const { data: h } = useHealth();
  const { data: c } = useLinkCounts();
  const max = s ? Math.max(1, s.counts.created) : 1;
  const accounts = s ? s.addresses.own + s.addresses.external : undefined;
  const avg = (k: string) => (RUNS.length ? RUNS.reduce((a, r) => a + (r.stepsMs[k] ?? 0), 0) / RUNS.length / 1000 : 0);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8" data-testid="radar">
      <div className="mb-8">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-zinc-500">Telemetry · <a className="underline" href={`${API_BASE}/api/stats`} target="_blank" rel="noopener noreferrer">/api/stats</a> <SourceBadge kind="LIVE" title="Indexed from the contract's on-chain events by the relayer API, refreshed every 30 seconds" /></p>
        <h1 className="mt-1 font-serif text-3xl text-zinc-900 sm:text-5xl">Live Accounts &amp; Step Latency</h1>
      </div>
      {error && <div className="mb-4"><Notice tone="error">Could not load stats from the API: {(error as Error).message}</Notice></div>}

      <div className="grid gap-6 md:grid-cols-12">
        <div className={cx(card, 'md:col-span-7')}>
          <div className="flex items-start justify-between gap-2"><h2 className="mb-1 font-serif text-2xl text-zinc-900">Step latency of the claim flow</h2><SourceBadge kind="RECORDED" title="Measured by Playwright against the deployed app; not a live reading" /></div>
          {RUNS.length > 0 ? (
            <>
              <p className="mb-4 text-xs text-zinc-500" data-testid="latency-caption">Mean of {RUNS.length} recorded run{RUNS.length > 1 ? 's' : ''} ({[...new Set(RUNS.map((r) => r.label))].join(', ')}) against the deployed app on {RUNS[0].date}. Desktop CPU, public Diana RPC, seconds per step. Measured by this app, not by an estimate.</p>
              <Bars testId="latency-bars" rows={STEPS.map(([k, l]) => ({ label: l, value: avg(k), tone: k === 'claim' ? 'bg-emerald-600' : k === 'register' ? 'bg-zinc-900' : 'bg-zinc-600' }))} />
            </>
          ) : <p className="mb-4 text-xs text-zinc-500">No recorded runs yet.</p>}
          <div className="mt-6 border-t border-zinc-100 pt-4">
            <div className="mb-2 flex items-center justify-between"><h3 className="text-sm font-semibold text-zinc-900">Real phones: register key + open window + claim</h3><SourceBadge kind="RECORDED" title={`Source: ${PHONE.source}`} /></div>
            <Bars testId="phone-bars" rows={[
              { label: 'Android Chrome, run 1', value: PHONE.androidMs[0] / 1000 },
              { label: 'Android Chrome, run 2', value: PHONE.androidMs[1] / 1000 },
              { label: 'iPhone Safari (iOS 18.0)', value: PHONE.iphoneMs / 1000, tone: 'bg-emerald-600' },
            ]} />
            <p className="mt-3 text-[11px] leading-relaxed text-zinc-500">{PHONE.note} Source: {PHONE.source}. These were separate spike runs, not this app's full flow.</p>
          </div>
        </div>

        <div className="capsule-titanium flex flex-col justify-between rounded-3xl border border-zinc-300 p-6 md:col-span-5">
          <div>
            <span className="font-mono text-[11px] uppercase tracking-widest text-zinc-500">On-Chain Address Split <SourceBadge kind="LIVE" /></span>
            <h3 className="mb-4 mt-1 font-serif text-2xl text-zinc-900">Verified Diana Breakdown</h3>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between border-b border-zinc-300/70 py-2"><span className="text-zinc-600">Main Contract Links</span><span className="font-mono font-semibold" data-testid="radar-main">{c?.main ?? <Dash />}</span></div>
              <div className="flex justify-between border-b border-zinc-300/70 py-2"><span className="text-zinc-600">Lab Contract Links</span><span className="font-mono font-semibold" data-testid="radar-lab">{c?.lab ?? <Dash />}</span></div>
              <div className="flex justify-between border-b border-zinc-300/70 py-2"><span className="text-zinc-600">Accounts: own / other</span><span className="font-mono font-semibold" data-testid="radar-accounts">{s ? `${s.addresses.own} / ${s.addresses.external}` : <Dash />}</span></div>
              <div className="flex justify-between border-b border-zinc-300/70 py-2"><span className="text-zinc-600">Chain head</span><span className="font-mono text-xs">{c?.head ?? h?.headBlock ?? '…'}</span></div>
              <div className="flex justify-between py-2"><span className="text-zinc-600">Relayer API</span><span className="font-mono text-xs">{API_BASE.replace('https://', '')}</span></div>
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-zinc-600">Addresses, not users. "Own" is the team test list (deployer, relayer, test wallets); "other" includes our automated test accounts. PoP is enforced by the contract: a claim to an unproven key reverts with PossessionNotProven (<Link className="underline" to="/lab">lab attack 3</Link>).</p>
          </div>
          <a href={`${API_BASE}/api/stats`} target="_blank" rel="noopener noreferrer" className="mt-6 w-full rounded-full bg-zinc-900 py-2.5 text-center text-xs font-semibold text-white hover:bg-zinc-800">Open Raw /api/stats JSON ↗</a>
        </div>
      </div>

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <Reveal className={card}>
          <div className="mb-3 flex items-center justify-between"><h2 className="font-serif text-2xl text-zinc-900">Link funnel</h2><SourceBadge kind="LIVE" /></div>
          {!s ? <Dash /> : (
            <div className="space-y-3" data-testid="funnel">
              <Funnel label="Created" value={s.counts.created} max={max} tone="bg-zinc-900" />
              <Funnel label="Opened by a recipient (bound)" value={s.counts.bound} max={max} tone="bg-zinc-700" />
              <Funnel label="Confirmed by sender" value={s.counts.confirmed} max={max} tone="bg-zinc-500" />
              <Funnel label="Claimed" value={s.counts.claimed} max={max} tone="bg-emerald-600" />
              <Funnel label="Cancelled" value={s.counts.cancelled} max={max} tone="bg-amber-500" />
              <Funnel label="Refunded" value={s.counts.refunded} max={max} tone="bg-amber-400" />
            </div>
          )}
          <p className="mt-3 text-[11px] text-zinc-500">Giveaway links skip the confirm step, so confirmed can be lower than claimed. Volume: {s ? `${s.volume.created} QOR locked, ${s.volume.claimed} QOR delivered` : '…'}.</p>
        </Reveal>

        <Reveal delay={0.08} className={card}>
          <div className="mb-3 flex items-center justify-between"><h2 className="font-serif text-2xl text-zinc-900">Accounts</h2><SourceBadge kind="LIVE" /></div>
          <div className="flex items-end gap-6">
            <div><div className="text-xs text-zinc-500">Distinct addresses seen</div><div className="font-serif text-5xl leading-none" data-testid="kpi-accounts">{accounts ?? <Dash />}</div></div>
            <div className="space-y-1 text-sm">
              <div className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-zinc-900" />Own <strong className="font-mono">{s?.addresses.own ?? '…'}</strong></div>
              <div className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-emerald-600" />Other <strong className="font-mono">{s?.addresses.external ?? '…'}</strong></div>
            </div>
          </div>
          {s && accounts! > 0 && (
            <div className="mt-4 flex h-3 overflow-hidden rounded-full bg-stoneCard" aria-hidden>
              <div className="bg-zinc-900" style={{ width: `${(s.addresses.own / accounts!) * 100}%` }} />
              <div className="bg-emerald-600" style={{ width: `${(s.addresses.external / accounts!) * 100}%` }} />
            </div>
          )}
          {s?.addresses.byRole && (
            <dl className="mt-4 grid grid-cols-3 gap-2 text-xs">
              {Object.entries(s.addresses.byRole).map(([role, v]) => (<div key={role} className="rounded-xl bg-stoneBg p-2"><dt className="text-zinc-500">{role}</dt><dd className="font-mono">{v.own + v.external}</dd></div>))}
            </dl>
          )}
        </Reveal>
      </div>

      <Reveal className={cx(card, 'mt-6')}>
        <div className="mb-3 flex items-center justify-between"><h2 className="font-serif text-2xl text-zinc-900">Relayer</h2><SourceBadge kind="LIVE" /></div>
        {!h ? <Dash /> : (
          <dl className="grid gap-3 text-sm sm:grid-cols-4" data-testid="relayer-facts">
            <div><dt className="text-xs text-zinc-500">Gas float</dt><dd className="font-mono">{h.relayer?.balance ?? '–'} QOR</dd></div>
            <div><dt className="text-xs text-zinc-500">EVM window</dt><dd className={cx('font-mono', h.window.live ? 'text-emerald-700' : 'text-red-700')}>{h.window.live ? 'live' : 'expired'}</dd></div>
            <div><dt className="text-xs text-zinc-500">Blocks / txs left</dt><dd className="font-mono">{h.window.remainingBlocks ?? '–'} / {h.window.remainingTxs ?? '–'}</dd></div>
            <div><dt className="text-xs text-zinc-500">Window expires at block</dt><dd className="font-mono">{h.window.expiryHeight ?? '–'}</dd></div>
          </dl>
        )}
        {h?.warning && <div className="mt-3"><Notice tone="warn">{h.warning.message}</Notice></div>}
        <p className="mt-3 text-[11px] text-zinc-500">The relayer only pays gas. It cannot move anyone's money: every payout needs signatures it cannot forge. The window is scoped to the PocketDrop contract and is renewed on a schedule by a separate job.</p>
      </Reveal>

      <Reveal className={cx(card, 'mt-6')}>
        <div className="mb-3 flex items-center justify-between"><h2 className="font-serif text-2xl text-zinc-900">Recent events</h2><SourceBadge kind="LIVE" /></div>
        {!s ? <Dash /> : (
          <ul className="divide-y divide-zinc-100" data-testid="recent-events">
            {s.recent.slice(0, 12).map((e, i) => (
              <li key={i} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span><span className="font-medium">{e.name.replace(/^Link/, '')}</span>{e.linkId && <span className="ml-2 text-xs text-zinc-500">link #{e.linkId}</span>}</span>
                <TxLink hash={e.txHash} />
              </li>
            ))}
          </ul>
        )}
        {s?.truncated && <p className="mt-2 text-xs text-amber-800">The indexer hit its scan limit; counts may be incomplete.</p>}
        {s && <p className="mt-3 text-[11px] text-zinc-500">Blocks {s.fromBlock} to {s.toBlock}. Contract <a className="underline" href={addrUrl(POCKETDROP_ADDRESS)} target="_blank" rel="noopener noreferrer">{POCKETDROP_ADDRESS.slice(0, 10)}…</a></p>}
      </Reveal>
    </div>
  );
}

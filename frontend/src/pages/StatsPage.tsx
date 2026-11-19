import { motion } from 'framer-motion';
import { Card, Notice, PageTitle, Skeleton, SourceBadge, TxLink, cx } from '../components/ui';
import { useHealth, useStats } from '../lib/queries';
import { addrUrl, POCKETDROP_ADDRESS, TESTNET_BADGE } from '../lib/config';

const num = (n: number | undefined) => (n === undefined ? <Skeleton className="h-8 w-12" /> : <>{n}</>);

function Kpi({ label, value, sub, testId }: { label: string; value: React.ReactNode; sub?: string; testId?: string }) {
  return (
    <Card className="p-4 sm:p-4">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="mt-1 font-serif text-4xl leading-none text-zinc-900" data-testid={testId}>{value}</div>
      {sub && <div className="mt-1.5 text-[11px] text-zinc-500">{sub}</div>}
    </Card>
  );
}

function Bar({ label, value, max, tone }: { label: string; value: number; max: number; tone: string }) {
  const pct = max > 0 ? Math.max(value > 0 ? 4 : 0, Math.round((value / max) * 100)) : 0;
  return (
    <div>
      <div className="flex justify-between text-xs"><span className="text-zinc-700">{label}</span><span className="font-mono text-zinc-900">{value}</span></div>
      <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-stone2">
        <motion.div className={cx('h-full rounded-full', tone)} initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.7, ease: 'easeOut' }} />
      </div>
    </div>
  );
}

export default function StatsPage() {
  const { data: s, error, isLoading } = useStats();
  const { data: h } = useHealth();
  const max = s ? Math.max(1, s.counts.created) : 1;
  const accounts = s ? s.addresses.own + s.addresses.external : undefined;

  return (
    <div className="mx-auto max-w-5xl">
      <PageTitle eyebrow={<span className="flex items-center gap-2">Dashboard <SourceBadge kind="LIVE" title="Indexed from the contract's on-chain events by the relayer API, refreshed every 30 seconds" /></span>} title="What happened on-chain.">
        Counted from the PocketDrop contract's events by the API. {TESTNET_BADGE}.
      </PageTitle>

      {error && <Notice tone="error">Could not load stats from the API: {(error as Error).message}</Notice>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Links created" value={num(s?.counts.created)} testId="kpi-created" />
        <Kpi label="Links claimed" value={num(s?.counts.claimed)} testId="kpi-claimed" />
        <Kpi label="QOR locked in links" value={s ? s.volume.created : <Skeleton className="h-8 w-16" />} sub="total ever created" />
        <Kpi label="QOR delivered" value={s ? s.volume.claimed : <Skeleton className="h-8 w-16" />} sub="paid to recipients" testId="kpi-delivered" />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <div className="mb-3 flex items-center justify-between"><h2 className="font-serif text-2xl">Link funnel</h2><SourceBadge kind="LIVE" /></div>
          {isLoading || !s ? <div className="space-y-3"><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-full" /></div> : (
            <div className="space-y-3">
              <Bar label="Created" value={s.counts.created} max={max} tone="bg-zinc-900" />
              <Bar label="Opened by a recipient (bound)" value={s.counts.bound} max={max} tone="bg-zinc-700" />
              <Bar label="Confirmed by sender" value={s.counts.confirmed} max={max} tone="bg-zinc-500" />
              <Bar label="Claimed" value={s.counts.claimed} max={max} tone="bg-emerald-600" />
              <Bar label="Cancelled" value={s.counts.cancelled} max={max} tone="bg-amber-500" />
              <Bar label="Refunded" value={s.counts.refunded} max={max} tone="bg-amber-400" />
            </div>
          )}
          <p className="mt-3 text-[11px] text-zinc-500">Open-mode links skip the confirm step, so confirmed can be lower than claimed.</p>
        </Card>

        <Card>
          <div className="mb-3 flex items-center justify-between"><h2 className="font-serif text-2xl">Accounts</h2><SourceBadge kind="LIVE" /></div>
          <div className="flex items-end gap-6">
            <div><div className="text-xs text-zinc-500">Distinct accounts seen</div><div className="font-serif text-5xl leading-none" data-testid="kpi-accounts">{num(accounts)}</div></div>
            <div className="space-y-1 text-sm">
              <div className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-zinc-900" />Own <strong className="font-mono">{s?.addresses.own ?? '…'}</strong></div>
              <div className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-emerald-600" />External <strong className="font-mono">{s?.addresses.external ?? '…'}</strong></div>
            </div>
          </div>
          {s && accounts! > 0 && (
            <div className="mt-4 flex h-3 overflow-hidden rounded-full bg-stone2" aria-hidden>
              <div className="bg-zinc-900" style={{ width: `${(s.addresses.own / accounts!) * 100}%` }} />
              <div className="bg-emerald-600" style={{ width: `${(s.addresses.external / accounts!) * 100}%` }} />
            </div>
          )}
          <p className="mt-3 text-[11px] leading-relaxed text-zinc-500">These are blockchain addresses, not people. Own means the addresses on the team's test list (deployer, relayer, test wallets). External is every other address, and that includes our own automated test accounts, so it is not a user count.</p>
        </Card>
      </div>

      <Card className="mt-4">
        <div className="mb-3 flex items-center justify-between"><h2 className="font-serif text-2xl">Relayer</h2><SourceBadge kind="LIVE" /></div>
        {!h ? <Skeleton className="h-5 w-64" /> : (
          <dl className="grid gap-3 text-sm sm:grid-cols-4">
            <div><dt className="text-xs text-zinc-500">Balance</dt><dd className="font-mono">{h.relayer?.balance ?? '–'} QOR</dd></div>
            <div><dt className="text-xs text-zinc-500">EVM window</dt><dd className={cx('font-mono', h.window.live ? 'text-emerald-700' : 'text-red-700')}>{h.window.live ? 'live' : 'closed'}</dd></div>
            <div><dt className="text-xs text-zinc-500">Txs left in window</dt><dd className="font-mono">{h.window.remainingTxs ?? '–'}</dd></div>
            <div><dt className="text-xs text-zinc-500">Head block</dt><dd className="font-mono">{h.headBlock ?? '–'}</dd></div>
          </dl>
        )}
        <p className="mt-3 text-[11px] text-zinc-500">The relayer only pays gas. It cannot move anyone's money: every payout needs signatures it cannot forge. The window is scoped to the PocketDrop contract.</p>
      </Card>

      <Card className="mt-4">
        <div className="mb-3 flex items-center justify-between"><h2 className="font-serif text-2xl">Recent events</h2><SourceBadge kind="LIVE" /></div>
        {!s ? <Skeleton className="h-24 w-full" /> : (
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
      </Card>
    </div>
  );
}

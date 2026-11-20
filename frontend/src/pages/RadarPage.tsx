import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Notice, SourceBadge, TxLink, cx } from '../components/ui';
import { Dash, Reveal } from '../components/bits';
import { envStats, pqSample, type EnvStats, type Split } from '../lib/radar';
import { addrUrl } from '../lib/config';
import { INST, type Env } from '../lib/v4';
import { useHealth } from '../lib/queries';
import { PHONE } from '../data/proofs';

const card = 'rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm';

function Bar({ label, value, max, tone = 'bg-zinc-900' }: { label: string; value: number; max: number; tone?: string }) {
  const pct = max > 0 ? Math.max(value > 0 ? 4 : 0, Math.round((value / max) * 100)) : 0;
  return (
    <div>
      <div className="flex justify-between text-xs"><span className="text-zinc-700">{label}</span><span className="font-mono text-zinc-900">{value}</span></div>
      <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-stoneCard"><motion.div className={cx('h-full rounded-full', tone)} initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.7, ease: 'easeOut' }} /></div>
    </div>
  );
}

const SplitRow = ({ label, s }: { label: string; s: Split }) => (
  <div className="flex items-center justify-between gap-3 border-b border-zinc-100 py-2 text-sm last:border-0" data-testid="split-row">
    <span className="text-zinc-700">{label}</span>
    <span className="font-mono text-xs text-zinc-900"><span title="Accounts listed in backend/config/own-accounts.json">own {s.own}</span> · <span title="Everyone else">external {s.external}</span></span>
  </div>
);

function EnvCard({ s }: { s: EnvStats }) {
  const i = INST[s.env];
  const max = Math.max(1, s.drops.created);
  return (
    <div className={card} data-testid={`radar-${s.env}`}>
      <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-serif text-2xl text-zinc-900">{s.env === 'prod' ? 'Production instance' : 'Lab instance (60 s delays)'}</h2><SourceBadge kind="LIVE" title="Read from chain logs just now" /></div>
      <p className="mt-1 font-mono text-[11px] text-zinc-500">router <a className="underline" href={addrUrl(i.router)} target="_blank" rel="noopener noreferrer">{i.router.slice(0, 10)}…</a> · factory <a className="underline" href={addrUrl(i.factory)} target="_blank" rel="noopener noreferrer">{i.factory.slice(0, 10)}…</a></p>
      <div className="mt-4 grid grid-cols-3 gap-3 text-center">
        {([['Pockets deployed', s.pockets, 'pockets-deployed'], ['Drops created', s.drops.created, 'drops-created'], ['Pools created', s.pools.created, 'pools-created']] as const).map(([l, v, t]) => (
          <div key={l} className="rounded-2xl bg-stoneCard p-3"><div className="font-serif text-3xl text-zinc-900" data-testid={`${s.env}-${t}`}>{v}</div><div className="text-[11px] text-zinc-600">{l}</div></div>
        ))}
      </div>
      <div className="mt-5 space-y-3">
        <Bar label="Created" value={s.drops.created} max={max} />
        <Bar label="Opened (bound)" value={s.drops.bound} max={max} tone="bg-amber-600" />
        <Bar label="Confirmed by sender" value={s.drops.confirmed} max={max} tone="bg-sky-700" />
        <Bar label="Claimed into a Pocket" value={s.drops.claimed} max={max} tone="bg-emerald-600" />
        <Bar label="Pool slots claimed" value={s.pools.slotsClaimed} max={Math.max(max, s.pools.slotsClaimed)} tone="bg-violet-700" />
      </div>
      <div className="mt-5" data-testid={`${s.env}-own-external`}>
        <h3 className="mb-1 text-sm font-semibold text-zinc-900">Own accounts vs external accounts</h3>
        <SplitRow label="Pocket owners" s={s.pocketsOwn} />
        <SplitRow label="Drop senders" s={s.dropSenders} />
        <SplitRow label="Drop recipients" s={s.dropRecipients} />
        <SplitRow label="Pool hosts" s={s.poolHosts} />
        <SplitRow label="Pool claimers" s={s.poolClaimers} />
      </div>
      {s.recent.length > 0 && (
        <ul className="mt-4 space-y-1.5 text-xs">{s.recent.map((r) => <li key={r.tx + r.kind} className="flex items-center justify-between gap-2"><span className="text-zinc-700">{r.kind} {r.id}</span><TxLink hash={r.tx} /></li>)}</ul>
      )}
    </div>
  );
}

function useEnv(e: Env) { return useQuery({ queryKey: ['radar', e], queryFn: () => envStats(e), refetchInterval: 60_000, retry: 1 }); }

export default function RadarPage() {
  const prod = useEnv('prod');
  const lab = useEnv('lab');
  const pq = useQuery({ queryKey: ['pq-sample'], queryFn: () => pqSample(30, 120), refetchInterval: 120_000, retry: 1 });
  const { data: h } = useHealth();
  const ext = (s?: EnvStats) => (s ? s.pocketsOwn.external + s.dropSenders.external + s.dropRecipients.external + s.poolHosts.external + s.poolClaimers.external : 0);
  const extTotal = ext(prod.data) + ext(lab.data);

  return (
    <div className="mx-auto max-w-5xl px-4 pb-28 pt-10 sm:px-6 sm:pb-16 lg:px-8" data-testid="radar">
      <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-zinc-500">Radar · v4 <SourceBadge kind="LIVE" /></p>
      <h1 className="mt-1 font-serif text-3xl text-zinc-900 sm:text-5xl">What is actually on-chain</h1>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-zinc-600">Every number is counted from contract events on Diana testnet when you opened this page. Accounts that belong to the Pocket Drop team and its test setup are counted as <b>own</b>; everyone else is <b>external</b>. Nothing is added by hand.</p>

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <Reveal>{prod.data ? <EnvCard s={prod.data} /> : <div className={card}><Dash />{prod.error && <Notice tone="error">Could not read the logs: {(prod.error as Error).message}</Notice>}</div>}</Reveal>
        <Reveal delay={0.08}>{lab.data ? <EnvCard s={lab.data} /> : <div className={card}><Dash />{lab.error && <Notice tone="error">Could not read the logs: {(lab.error as Error).message}</Notice>}</div>}</Reveal>
      </div>

      <Reveal>
        <div className={cx(card, 'mt-5')} data-testid="external-usage">
          <h2 className="font-serif text-2xl text-zinc-900">Outside use</h2>
          <p className="mt-1 text-sm text-zinc-700"><span className="font-mono text-2xl" data-testid="external-total">{prod.data && lab.data ? extTotal : '…'}</span> external account roles across both instances. {prod.data && lab.data && extTotal === 0 && 'No outside account has used Pocket Drop yet. The team accounts are the only users so far, and this page says so on purpose.'}</p>
        </div>
      </Reveal>

      <Reveal>
        <div className={cx(card, 'mt-5')} data-testid="pq-sample">
          <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-serif text-2xl text-zinc-900">Why Pockets exist</h2><SourceBadge kind="LIVE" title="pqcKeyStatus read from the chain just now for each sampled account" /></div>
          {pq.data ? (
            <>
              <p className="mt-2 text-lg text-zinc-900" data-testid="pq-line">PQ not enforceable on <b className="font-mono">{pq.data.notEnforceable}</b> of <b className="font-mono">{pq.data.sampled}</b> sampled accounts.</p>
              <p className="mt-1 text-xs leading-relaxed text-zinc-600">A live sample: the distinct senders of EVM transactions in the last {pq.data.window} blocks (head {pq.data.head.toString()}), each checked with the <code className="font-mono">pqcKeyStatus</code> precompile. &quot;Not enforceable&quot; means possessionProven is false, so a post-quantum signature check cannot be applied to that account. It is a sample of recent activity, not a census of the chain{h ? '' : ''}.</p>
              <div className="mt-3"><Bar label="possessionProven = false" value={pq.data.notEnforceable} max={Math.max(1, pq.data.sampled)} tone="bg-amber-600" /></div>
            </>
          ) : pq.error ? <Notice tone="error">Could not sample accounts: {(pq.error as Error).message}</Notice> : <p className="mt-2 text-sm text-zinc-500">Sampling recent accounts… <Dash /></p>}
        </div>
      </Reveal>

      <Reveal>
        <div className={cx(card, 'mt-5')}>
          <div className="flex items-center justify-between gap-2"><h2 className="font-serif text-2xl text-zinc-900">Phone timings</h2><SourceBadge kind="RECORDED" /></div>
          <p className="mt-2 text-sm text-zinc-700">On-chain steps on real phones: Android {PHONE.androidLabel}, iPhone {PHONE.iphoneLabel} (register key, open window, claim; the v3 flow). {PHONE.note} Source: {PHONE.source}.</p>
        </div>
      </Reveal>
    </div>
  );
}

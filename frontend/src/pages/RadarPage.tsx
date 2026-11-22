import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Notice, SourceBadge, TxLink, cx } from '../components/ui';
import { Dash, Reveal } from '../components/bits';
import { Stage } from '../components/stage';
import { CountUp } from '../components/alive';
import { compareWithApi, envStats, pqSample, V2_RELEASE_BLOCK, type EnvStats, type Split } from '../lib/radar';
import { addrUrl } from '../lib/config';
import { INST, type Env } from '../lib/v4';
import { useHealth } from '../lib/queries';
import { fetchStats } from '../lib/api';
import { PHONE } from '../data/proofs';

const card = 'rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm';
const short = (a: string) => `${a.slice(0, 8)}…${a.slice(-6)}`;
const ago = (t: number) => { const s = Math.max(0, Math.floor(Date.now() / 1000) - t); return s < 90 ? `${s} s ago` : s < 5400 ? `${Math.round(s / 60)} min ago` : s < 172800 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} days ago`; };

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
      <p className="mt-1 font-mono text-xs text-zinc-500">router <a className="underline" href={addrUrl(i.router)} target="_blank" rel="noopener noreferrer">{i.router.slice(0, 10)}…</a> · factory <a className="underline" href={addrUrl(i.factory)} target="_blank" rel="noopener noreferrer">{i.factory.slice(0, 10)}…</a></p>
      <p className="mt-1 text-xs text-zinc-600" data-testid={`${s.env}-hybrid-note`}>{s.hybridEvents === null || s.hybridEvents === undefined
        ? 'Hybrid relays could not be read from the native lane just now; the counts below are from EVM logs only.'
        : <>Includes <b>{s.hybridEvents}</b> event{s.hybridEvents === 1 ? '' : 's'} from hybrid-signed relays (secp256k1 + ML-DSA-87). Those run as cross-VM calls, which leave no EVM log, so they are read from the native lane.</>}</p>
      <div className="mt-4 grid grid-cols-3 gap-3 text-center">
        {([['Pockets deployed', s.pockets, 'pockets-deployed'], ['Drops created', s.drops.created, 'drops-created'], ['Pools created', s.pools.created, 'pools-created']] as const).map(([l, v, t]) => (
          <div key={l} className="rounded-2xl bg-stoneCard p-3"><div className="font-money text-4xl leading-none text-zinc-900" data-testid={`${s.env}-${t}`}><CountUp value={v} /></div><div className="text-xs text-zinc-600">{l}</div></div>
        ))}
      </div>
      <div className="mt-5 space-y-3">
        <Bar label="Created" value={s.drops.created} max={max} />
        <Bar label="Opened (bound)" value={s.drops.bound} max={max} tone="bg-amber-600" />
        <Bar label="Confirmed by sender" value={s.drops.confirmed} max={max} tone="bg-sky-700" />
        <Bar label="Claimed into a Pocket" value={s.drops.claimed} max={max} tone="bg-emerald-600" />
        <Bar label="Pool slots claimed" value={s.pools.slotsClaimed} max={Math.max(max, s.pools.slotsClaimed)} tone="bg-teal-800" />
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
        <div className="mt-5">
          <h3 className="mb-1 text-sm font-semibold text-zinc-900">Latest events</h3>
          <ul className="space-y-1.5 text-xs" data-testid={`${s.env}-recent`}>{s.recent.map((r) => (
            <li key={r.tx + r.kind} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 border-b border-zinc-100 py-1.5 last:border-0">
              <span className="min-w-0 text-zinc-700">{r.kind} {r.kind === 'Pocket deployed' ? <a className="font-mono underline" href={addrUrl(r.id)} target="_blank" rel="noopener noreferrer" title={r.id}>{short(r.id)}</a> : <span className="font-mono">{r.id}</span>}
                {r.who && <> · <span className={r.own ? 'text-zinc-500' : 'font-semibold text-emerald-800'}>{r.own ? 'own' : 'external'}</span></>}</span>
              <span className="flex items-center gap-2 text-zinc-500">{r.at ? <time dateTime={new Date(r.at * 1000).toISOString()} title={new Date(r.at * 1000).toLocaleString()}>{ago(r.at)}</time> : <span>block {r.block.toString()}</span>}<TxLink hash={r.tx} check /></span>
            </li>
          ))}</ul>
        </div>
      )}
      {s.claimers.length > 0 && (
        <details className="mt-4 text-xs" data-testid={`${s.env}-claimers`}>
          <summary className="cursor-pointer text-sm font-semibold text-zinc-900">Every pool claimer ({s.claimers.length}: own {s.claimers.filter((c) => c.own).length}, external {s.claimers.filter((c) => !c.own).length})</summary>
          <ul className="mt-2 space-y-1.5">{s.claimers.map((c) => (
            <li key={c.tx} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 border-b border-zinc-100 py-1.5 last:border-0">
              <span className="min-w-0">Pool <span className="font-mono">{c.pool}</span> · <a className="font-mono underline" href={addrUrl(c.recipient)} target="_blank" rel="noopener noreferrer" title={c.recipient}>{short(c.recipient)}</a> · <span className={c.own ? 'text-zinc-500' : 'font-semibold text-emerald-800'}>{c.own ? 'own' : 'external'}</span></span>
              <TxLink hash={c.tx} />
            </li>
          ))}</ul>
        </details>
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
  const api = useQuery({ queryKey: ['api-stats'], queryFn: fetchStats, refetchInterval: 120_000, retry: 1 });
  const apiV4 = api.data?.v4 as Record<string, Parameters<typeof compareWithApi>[1]> | undefined;
  const diffs = prod.data && lab.data && apiV4 ? [...compareWithApi(prod.data, apiV4.prod).map((d) => `prod ${d}`), ...compareWithApi(lab.data, apiV4.lab).map((d) => `lab ${d}`)] : null;
  const eras = prod.data?.keyEras;

  return (
    <div className="mx-auto max-w-5xl px-4 pb-28 pt-8 sm:px-6 sm:pb-16 sm:pt-12 lg:px-8" data-testid="radar">
      <Stage live eyebrow={<>Radar · v4 <SourceBadge kind="LIVE" /></>} title="What is actually on-chain">Every number is counted from contract events on Diana testnet when you opened this page. Accounts that belong to the Pocket Drop team and its test setup are counted as <b>own</b>; everyone else is <b>external</b>. Nothing is added by hand.</Stage>

      <div className="grid gap-5 lg:grid-cols-2">
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
        <div className={cx(card, 'mt-5')} data-testid="key-eras">
          <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-serif text-2xl text-zinc-900">Legacy keys still on chain</h2><SourceBadge kind="LIVE" title="PocketDeployed logs and Pocket balances read just now" /></div>
          {eras ? (
            <>
              <p className="mt-2 text-lg text-zinc-900" data-testid="key-eras-line"><b className="font-mono">{eras.v1Era.total}</b> production Pockets were deployed before the v2 key release, <b className="font-mono">{eras.v1Era.stillHoldingQor}</b> of them still hold QOR ({eras.v1Era.stillHoldingExternal} external). <b className="font-mono">{eras.v2Era.total}</b> were deployed after it.</p>
              <div className="mt-3 space-y-3">
                <Bar label={`Before v2 (own ${eras.v1Era.own}, external ${eras.v1Era.external})`} value={eras.v1Era.total} max={Math.max(1, eras.v1Era.total + eras.v2Era.total)} tone="bg-amber-600" />
                <Bar label="Before v2 and still holding QOR" value={eras.v1Era.stillHoldingQor} max={Math.max(1, eras.v1Era.total + eras.v2Era.total)} tone="bg-red-700" />
                <Bar label={`After v2 (own ${eras.v2Era.own}, external ${eras.v2Era.external})`} value={eras.v2Era.total} max={Math.max(1, eras.v1Era.total + eras.v2Era.total)} tone="bg-emerald-600" />
              </div>
              <p className="mt-3 text-xs leading-relaxed text-zinc-600">Classified by the block each Pocket was deployed in, against block {V2_RELEASE_BLOCK.toString()}, the first block after the v2 key derivation went live. The chain cannot show how a key was derived: Pockets the app made before that block use v1 keys (the ML-DSA key follows from the classical key, so they are not quantum-safe); team scripts may use independent keys; a v1 browser can still deploy a Pocket later, so &quot;after v2&quot; means made after v2 shipped, not proof of v2. Pockets that were never deployed are not visible. Legacy users see a banner with a one-tap move to a new key.</p>
            </>
          ) : <p className="mt-2 text-sm text-zinc-500">Reading Pocket deployments… <Dash /></p>}
          <p className="mt-3 border-t border-zinc-100 pt-3 text-xs text-zinc-700" data-testid="api-agrees">
            {diffs === null ? (api.error ? <>/api/stats could not be read: {(api.error as Error).message}</> : <>Checking that <code className="font-mono">/api/stats</code> counts the same… <Dash /></>)
              : diffs.length === 0 ? <><b className="text-emerald-800">/api/stats agrees</b> with this page for both instances (Pockets, drops created and claimed, pools, external Pocket owners). The API reports v3 and v4 separately.</>
              : <><b className="text-amber-800">/api/stats differs</b> on {diffs.join(', ')}. The API caches for 30 s, so a new event can show here first.</>}
          </p>
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

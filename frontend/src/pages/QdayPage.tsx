import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Button, CopyButton, Mono, Notice, Page, PageTitle, Pill, SourceBadge, TxLink, cx } from '../components/ui';
import { Dash } from '../components/bits';
import { ShieldAlert, ShieldCheck, TriangleAlert, KeyRound } from '../components/icons';
import { addrUrl, SOURCE_URL } from '../lib/config';
import { fmtQor } from '../lib/chain';
import { attackScript, fetchQday, normKey, putOnChain, QDAY, tryBait, type AttemptRow, type LiveBait, type TryRow } from '../lib/qday';

const card = 'rounded-3xl border border-zinc-200 bg-white/90 p-5 shadow-sm sm:p-6';
const short = (a: string) => `${a.slice(0, 8)}…${a.slice(-6)}`;

export function TestnetBanner() {
  return (
    <div role="note" data-testid="qday-testnet-banner" className="mb-5 rounded-2xl border-2 border-amber-400 bg-amber-50 px-4 py-3 text-sm leading-relaxed text-amber-950">
      <b>Diana TESTNET only. QOR here has no value.</b> The keys on this page are public on purpose. The same address exists on every EVM chain:{' '}
      <b data-testid="qday-never-real">never send real funds to any address on this page</b>, on any network.
    </div>
  );
}

/** A time with its zone, so a judge in another country reads it right. */
const at = (t: string | number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
const withLocalTimes = (label: string) => label.replace(/\d{4}-\d\d-\d\dT[\d:.]+Z/g, (m) => `${new Date(m).toLocaleDateString([], { day: 'numeric', month: 'short' })} ${at(m)}`);

function BaitCard({ b }: { b: LiveBait }) {
  const ok = b.alarm.length === 0;
  return (
    <div className={cx(card, !ok && 'border-red-400')} data-testid={`qday-bait-${b.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-serif text-xl text-zinc-900">{b.id}</h3>
        {ok ? <Pill tone="ok"><ShieldCheck className="h-3.5 w-3.5" aria-hidden /> holding</Pill> : <Pill tone="warn"><ShieldAlert className="h-3.5 w-3.5" aria-hidden /> check</Pill>}
      </div>
      <p className="mt-1 text-sm text-zinc-700">{b.description}</p>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
        <dt className="text-zinc-500">Pocket</dt><dd className="min-w-0"><a className="underline" href={addrUrl(b.pocket)} target="_blank" rel="noopener noreferrer"><Mono>{short(b.pocket)}</Mono></a>{!b.deployed && <span className="ml-1 text-zinc-500">(not deployed yet)</span>}</dd>
        <dt className="text-zinc-500">In the Pocket</dt><dd className="font-mono text-zinc-900" data-testid={`qday-balance-${b.id}`}>{fmtQor(BigInt(b.pocketWei))} QOR</dd>
        <dt className="text-zinc-500">Key account</dt><dd className="min-w-0"><a className="underline" href={addrUrl(b.keyAccount)} target="_blank" rel="noopener noreferrer"><Mono>{short(b.keyAccount)}</Mono></a> <span className="text-zinc-500">({fmtQor(BigInt(b.keyAccountWei))} QOR)</span></dd>
        <dt className="text-zinc-500">PQ key</dt><dd className={b.keyUnchanged ? 'text-emerald-800' : 'text-red-700'}>{b.keyUnchanged ? 'unchanged since setup' : 'CHANGED or unreadable'}</dd>
        <dt className="text-zinc-500">EVM window</dt><dd className={b.windowLive ? 'font-semibold text-red-700' : 'text-zinc-800'} data-testid={`qday-window-${b.id}`}>{b.windowLive === null ? 'unknown' : b.windowLive ? 'OPEN (the classical key could use it)' : 'closed'}</dd>
      </dl>
      <div className="mt-3 rounded-xl bg-stoneCard p-3" data-testid={`qday-key-${b.id}`}>
        <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-800"><KeyRound className="h-3.5 w-3.5" aria-hidden /> Classical secp256k1 private key</div>
        {b.classicalKey ? (
          <div className="mt-1 flex flex-wrap items-center gap-2"><Mono className="min-w-0 flex-1 text-xs">{b.classicalKey}</Mono><CopyButton text={b.classicalKey} label="Copy key" testId={`qday-copy-${b.id}`} /></div>
        ) : <p className="mt-1 text-xs text-zinc-600">Not published yet. It appears here when publishing is switched on.</p>}
      </div>
      {b.alarm.length > 0 && <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-red-800">{b.alarm.map((a) => <li key={a}>{a}</li>)}</ul>}
    </div>
  );
}

function LogCol({ title, label, rows, testId, empty, children }: { title: string; label: string; rows: AttemptRow[]; testId: string; empty: string; children?: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-2xl border border-zinc-200 bg-white p-4" data-testid={testId}>
      <h3 className="text-sm font-semibold text-zinc-900">{title}</h3>
      <p className="mt-0.5 text-xs text-zinc-500">{label}</p>
      {children}
      {rows.length === 0 ? <p className="mt-3 text-xs text-zinc-500">{empty}</p> : (
        <ul className="mt-3 space-y-1.5 text-xs">{rows.slice(0, 15).map((r) => (
          <li key={r.tx} className="flex flex-wrap items-center justify-between gap-x-2 border-b border-zinc-100 pb-1.5 last:border-0">
            <span className="min-w-0"><b>{r.bait}</b> {r.call} <span className="text-zinc-500">({r.source === 'try-it' ? 'Try it' : r.source === 'team-bot' ? 'our bot' : r.source === 'team-setup' ? 'team' : 'anyone'})</span> · <span className={r.failed ? 'text-emerald-800' : r.source === 'team-setup' ? 'text-zinc-500' : 'font-semibold text-red-700'}>{r.failed ? 'reverted' : r.source === 'team-setup' ? 'team setup' : 'succeeded'}</span></span>
            <TxLink hash={r.tx} />
          </li>
        ))}</ul>
      )}
    </div>
  );
}

function TryIt({ baits }: { baits: LiveBait[] }) {
  const [id, setId] = useState('B1');
  const [key, setKey] = useState('');
  const [rows, setRows] = useState<TryRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [mined, setMined] = useState<Record<string, string>>({});
  const published = baits.find((b) => b.id === id)?.classicalKey ?? null;
  async function run() {
    setErr(null); setRows(null); setBusy(true);
    try { const k = normKey(key || published || ''); if (!k) throw new Error('Paste a 64-hex secp256k1 private key (or wait for the published one).'); setRows(await tryBait(id, k)); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  async function mine(r: TryRow) {
    if (!r.data) return;
    setMined((m) => ({ ...m, [r.id]: 'sending…' }));
    const out: Awaited<ReturnType<typeof putOnChain>> = await putOnChain(r.data).catch((e) => ({ ok: false, error: { message: String(e) } }));
    setMined((m) => ({ ...m, [r.id]: out.ok ? `mined, ${out.status} (${out.expectedRevert}) ${out.txHash}` : out.error?.message ?? 'refused' }));
  }
  return (
    <section className={cx(card, 'mt-5')} data-testid="qday-try">
      <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-serif text-2xl text-zinc-900">Try it in this tab</h2><SourceBadge kind="LIVE" title="eth_call against Diana from your browser" /></div>
      <p className="mt-1 text-sm text-zinc-700">Pick a bait. We sign every attack with the classical key <b>inside this browser tab</b> and ask the chain what would happen (eth_call, nothing is sent). The key is never sent to our server. Your own ML-DSA key is generated fresh for each run, exactly what an attacker with a quantum computer would have.</p>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="text-xs text-zinc-700">Bait<select className="ml-2 rounded-lg border border-zinc-300 bg-white px-2 py-2 text-sm" value={id} onChange={(e) => { setId(e.target.value); setRows(null); }} data-testid="qday-try-bait">{QDAY.baits.map((b) => <option key={b.id} value={b.id}>{b.id}</option>)}</select></label>
        <label className="min-w-0 flex-1 text-xs text-zinc-700">Classical key {published ? '(published key used if empty)' : ''}<input className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 font-mono text-xs" value={key} onChange={(e) => setKey(e.target.value)} placeholder={published ? 'published key' : '0x… 64 hex'} autoComplete="off" spellCheck={false} data-testid="qday-try-key" /></label>
        <Button type="button" onClick={run} busy={busy} data-testid="qday-try-run">Try every path</Button>
      </div>
      {err && <div className="mt-3"><Notice tone="error">{err}</Notice></div>}
      {rows && (
        <ul className="mt-4 space-y-2 text-sm" data-testid="qday-try-rows">{rows.map((r) => (
          <li key={r.id} className="rounded-xl border border-zinc-200 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2"><span><b className="font-mono">{r.id}</b> {r.path}</span>
              <span className={r.outcome === 'refused' ? 'font-mono text-xs text-emerald-800' : 'font-mono text-xs font-bold text-red-700'}>{r.outcome === 'refused' ? `refused: ${r.detail}` : 'WOULD SUCCEED: tell us'}</span></div>
            {r.data && r.outcome === 'refused' && <div className="mt-2 flex flex-wrap items-center gap-2 text-xs"><Button type="button" variant="secondary" className="min-h-[36px] px-3 text-xs" onClick={() => mine(r)} data-testid={`qday-mine-${r.id}`}>Put it on chain</Button><span className="break-all text-zinc-600">{mined[r.id] ?? 'Our relayer mines it (3 per hour per visitor); it only mines calls that revert.'}</span></div>}
          </li>
        ))}</ul>
      )}
      <p className="mt-3 text-xs text-zinc-500">The Cosmos-side paths (bank send, re-register or rotate the PQ key, open an EVM window, link an authenticator) need the chain SDK, so they run in the script below.</p>
    </section>
  );
}

export default function QdayPage() {
  const q = useQuery({ queryKey: ['qday'], queryFn: fetchQday, refetchInterval: 30_000, retry: 1 });
  const s = q.data;
  const [scriptBait, setScriptBait] = useState('B1');
  return (
    <Page testId="qday-page">
      <PageTitle eyebrow={<>Proof · Q-Day drill <SourceBadge kind="LIVE" /></>} title="Steal this Pocket">We published the classical keys of five Pockets. Assume a quantum computer already broke them. Take the money if you can.</PageTitle>
      <TestnetBanner />

      <section className={cx('mb-5 rounded-3xl border-2 p-5 sm:p-6', s?.alarm.raised ? 'border-red-500 bg-red-50' : 'border-emerald-400 bg-emerald-50')} data-testid="qday-alarm">
        {!s ? <p className="text-sm text-zinc-600">{q.error ? `Could not read the drill: ${(q.error as Error).message}` : <>Reading the chain… <Dash /></>}</p>
          : s.alarm.raised ? (<><div className="flex items-center gap-2 font-serif text-2xl text-red-800"><TriangleAlert className="h-6 w-6" aria-hidden /> Breach alarm</div><ul className="mt-2 list-disc pl-5 text-sm text-red-900">{s.alarm.reasons.map((r) => <li key={r}>{r}</li>)}</ul></>)
          : (<><div className="flex items-center gap-2 font-serif text-2xl text-emerald-900"><ShieldCheck className="h-6 w-6" aria-hidden /> No breach</div><p className="mt-1 text-sm text-emerald-950">Every bait still holds what we left in it, every registered PQ key is unchanged, no EVM window is open, and no outside transaction against a bait has succeeded. Checked {at(s.generatedAt)}, re-checked every 30 s.</p></>)}
      </section>

      <h2 className="sr-only">The five baits</h2>
      <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-3" data-testid="qday-baits">
        {s ? s.baits.map((b) => <BaitCard key={b.id} b={b} />) : QDAY.baits.map((b) => <div key={b.id} className={card}><h3 className="font-serif text-xl">{b.id}</h3><p className="text-sm text-zinc-600">{b.description}</p><Dash /></div>)}
      </section>
      <p className="mt-2 text-xs text-zinc-500">The five baits, their guardians and the sender behind B4&apos;s drop are TEAM-RUN accounts: they are listed as own accounts and never counted as outside use. Each Pocket&apos;s ML-DSA key is independent random entropy, so the classical key says nothing about it.</p>

      <TryIt baits={s?.baits ?? []} />

      <section className={cx(card, 'mt-5')} data-testid="qday-script">
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-serif text-2xl text-zinc-900">Or attack from your terminal</h2>
          <select className="rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm" value={scriptBait} onChange={(e) => setScriptBait(e.target.value)} aria-label="Bait for the script">{QDAY.baits.map((b) => <option key={b.id}>{b.id}</option>)}</select></div>
        <pre tabIndex={0} aria-label="Attack script" className="mt-3 overflow-x-auto rounded-xl bg-zinc-950 p-4 text-xs leading-relaxed text-zinc-100"><code>{attackScript(scriptBait)}</code></pre>
        <div className="mt-2 flex flex-wrap items-center gap-2"><CopyButton text={attackScript(scriptBait)} label="Copy script" testId="qday-copy-script" /><a className="text-xs underline" href={`${SOURCE_URL}/tree/main/contracts-v4/script/qday`} target="_blank" rel="noopener noreferrer">Read the script</a></div>
      </section>

      <section className="mt-5" data-testid="qday-log">
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-serif text-2xl text-zinc-900">Every attempt</h2><SourceBadge kind="LIVE" /></div>
        <div className="mt-3 grid gap-3 lg:grid-cols-3">
          <LogCol title="On chain, from anyone" label={s?.log.onChain.label ?? 'Transactions to the router, the drop contract and every bait Pocket, found by scanning blocks.'} rows={s?.log.onChain.rows ?? []} testId="qday-log-onchain" empty={s ? 'No attempts on chain yet.' : '…'} />
          <div className="min-w-0 rounded-2xl border border-zinc-200 bg-white p-4" data-testid="qday-log-refused">
            <h3 className="text-sm font-semibold text-zinc-900">Refused by our relayer</h3>
            <p className="mt-0.5 text-xs text-zinc-500">{s ? withLocalTimes(s.log.relayerRefused.label) : 'Attempts the relayer simulated and refused before sending.'}</p>
            {(s?.log.relayerRefused.rows.length ?? 0) === 0 ? <p className="mt-3 text-xs text-zinc-500">{s ? 'None since this server instance started.' : '…'}</p> : (
              <ul className="mt-3 space-y-1.5 text-xs">{s!.log.relayerRefused.rows.slice(0, 15).map((r) => <li key={r.at + r.call} className="border-b border-zinc-100 pb-1.5 last:border-0"><b>{r.bait}</b> {r.call} · <span className="text-emerald-800">{r.error}</span> <span className="text-zinc-500">{at(r.at)}</span></li>)}</ul>)}
          </div>
          <LogCol title="Our attacker bot (team-run)" label={s?.log.teamBot.label ?? 'Hourly GitHub Actions run by the team.'} rows={s?.log.teamBot.rows ?? []} testId="qday-log-bot" empty={s ? (s.log.teamBot.runs.length > 0 ? 'No bot transaction on chain yet; the runs above are its read-only checks.' : 'No bot attempt on chain yet.') : '…'}>
            {s && s.log.teamBot.runs.length > 0 && <ul className="mt-2 space-y-1 text-xs">{s.log.teamBot.runs.slice(0, 4).map((r) => <li key={r.id}><a className="underline" href={r.url} target="_blank" rel="noopener noreferrer">run {new Date(r.createdAt).toLocaleDateString([], { day: 'numeric', month: 'short' })} {at(r.createdAt)}</a> · {r.conclusion ?? r.status}</li>)}</ul>}
          </LogCol>
        </div>
      </section>

      <section className={cx(card, 'mt-5')} data-testid="qday-before-after">
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-serif text-2xl text-zinc-900">Before and after the fix</h2><SourceBadge kind="RECORDED" /></div>
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4">
            <h3 className="text-sm font-semibold text-red-900">Before: robbed on purpose</h3>
            <p className="mt-1 text-sm text-red-950">{QDAY.before.explain}</p>
            <p className="mt-2 text-xs">Pocket <a className="underline" href={addrUrl(QDAY.before.pocket)} target="_blank" rel="noopener noreferrer"><Mono>{short(QDAY.before.pocket)}</Mono></a> · theft <TxLink hash={QDAY.before.theftTx} testId="qday-theft-tx" /></p>
          </div>
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
            <h3 className="text-sm font-semibold text-emerald-900">After: independent keys</h3>
            <p className="mt-1 text-sm text-emerald-950">{QDAY.after.note} The five baits above use the same fixed design, and you can attack them yourself.</p>
            <p className="mt-2 text-xs">Pocket <a className="underline" href={addrUrl(QDAY.after.pocket)} target="_blank" rel="noopener noreferrer"><Mono>{short(QDAY.after.pocket)}</Mono></a> · a refused attempt <TxLink hash={QDAY.after.exampleRevertTx} /></p>
          </div>
        </div>
      </section>

      <section className={cx(card, 'mt-5')} data-testid="qday-limits">
        <h2 className="font-serif text-2xl text-zinc-900">What this does and does not show</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-zinc-700">
          <li>A Pocket only moves with a signature from its registered ML-DSA-87 key. A stolen classical key cannot produce one.</li>
          <li>The account&apos;s own Cosmos lane needs a hybrid signature once a PQ key is registered, so the classical key alone cannot send, re-register, rotate or open a window.</li>
          <li>Residual risk: while the owner has an EVM window open, the classical key alone can send EVM transactions from the key account. The baits keep their windows closed, and the alarm fires if one opens.</li>
          <li>The before case shows the flaw we found and fixed in our own browser key derivation, not a chain flaw. Pockets made before the fix are counted on <Link className="underline" to="/radar">Radar</Link>.</li>
        </ul>
      </section>
    </Page>
  );
}

import { Link } from 'react-router-dom';
import { Mono, Page, PageTitle, SourceBadge } from '../components/ui';
import { SOURCE_URL, addrUrl, EXPLORER } from '../lib/config';
import testers from '../data/outside-testers.json';

const { pool, claims, call, definition, script } = testers;

export default function TestersPage() {
  return (
    <Page narrow testId="testers-page">
      <PageTitle eyebrow={<>Proof · Outside testers <SourceBadge kind="RECORDED" /></>} title="Outside testers">
        We made a small public call on X for people to try receiving from the public pool. The {claims.length} claims
        below are from addresses that are not in the team&apos;s own-accounts list. Anyone can re-verify each
        transaction.
      </PageTitle>

      <section className="space-y-3 rounded-3xl border border-zinc-200 bg-white/90 p-5 shadow-sm sm:p-6" data-testid="testers-call">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-serif text-2xl text-zinc-900">The public call</h2>
          <SourceBadge kind="RECORDED" />
        </div>
        <p className="text-sm text-zinc-700">
          A short post asked people to claim one slot of the team-hosted public pool.{' '}
          <a href={call} target="_blank" rel="noopener noreferrer" className="underline decoration-zinc-300 underline-offset-2" data-testid="testers-x-link">The post on X</a>.
        </p>
      </section>

      <section className="mt-5 space-y-3 rounded-3xl border border-zinc-200 bg-white/90 p-5 shadow-sm sm:p-6" data-testid="testers-pool">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-serif text-2xl text-zinc-900">The pool</h2>
          <SourceBadge kind="RECORDED" />
        </div>
        <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
          <dt className="text-zinc-600">Contracts</dt>
          <dd className="min-w-0 text-zinc-800">{pool.version} production DropPool, pool {pool.id}</dd>
          <dt className="text-zinc-600">DropPool</dt>
          <dd className="min-w-0"><a href={addrUrl(pool.contract)} target="_blank" rel="noopener noreferrer" className="break-all underline decoration-zinc-300 underline-offset-2"><Mono>{pool.contract}</Mono></a></dd>
          <dt className="text-zinc-600">Slots</dt>
          <dd className="text-zinc-800">{pool.slots} × {pool.perSlotQor} QOR</dd>
          <dt className="text-zinc-600">Host</dt>
          <dd className="min-w-0 text-zinc-800">{pool.hostLabel} host Pocket <a href={addrUrl(pool.host)} target="_blank" rel="noopener noreferrer" className="break-all underline decoration-zinc-300 underline-offset-2"><Mono>{pool.host}</Mono></a></dd>
        </dl>
        <p className="text-xs text-zinc-600">{definition} This page is a snapshot; later claims appear in the live counts on <Link to="/radar" className="underline">Radar</Link>.</p>
      </section>

      <section className="mt-5 space-y-3 rounded-3xl border border-zinc-200 bg-white/90 p-5 shadow-sm sm:p-6" data-testid="testers-list">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-serif text-2xl text-zinc-900">{claims.length} external claims</h2>
          <SourceBadge kind="RECORDED" />
        </div>
        <ul className="divide-y divide-zinc-100">
          {claims.map((c, i) => (
            <li key={c.tx} className="space-y-1 py-3" data-testid={`testers-claim-${i}`}>
              <p className="text-xs text-zinc-600">Claimer</p>
              <p><Mono className="text-sm text-zinc-900">{c.address}</Mono></p>
              <p className="text-xs text-zinc-600">Transaction</p>
              <p className="flex flex-col gap-1 sm:flex-row sm:flex-wrap sm:items-baseline sm:gap-x-3">
                <Link to={`/check/${c.tx}`} className="break-all font-mono text-xs text-zinc-800 underline decoration-zinc-300 underline-offset-2" data-testid={`testers-check-${i}`}>{c.tx}</Link>
                <a href={`${EXPLORER}/tx/${c.tx}`} target="_blank" rel="noopener noreferrer" className="text-xs text-zinc-600 underline decoration-zinc-300 underline-offset-2">explorer</a>
              </p>
            </li>
          ))}
        </ul>
        <p className="text-xs text-zinc-600">
          On the public explorer, pick <b>Testnet</b> in the header first. Re-check: <code className="font-mono">{script}</code>. The recorded file is{' '}
          <a className="underline" href={`${SOURCE_URL}/blob/main/frontend/evidence/outside-testers.json`} target="_blank" rel="noopener noreferrer" data-testid="testers-json">outside-testers.json</a>.
        </p>
      </section>
    </Page>
  );
}

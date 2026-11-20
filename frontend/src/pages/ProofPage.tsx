import { Link } from 'react-router-dom';
import { ArrowRight } from '../components/icons';
import { Mono, Page, PageTitle, SourceBadge } from '../components/ui';
import { PROOF_ITEMS } from '../components/Layout';
import { INST } from '../lib/v4';
import { SOURCE_URL, addrUrl } from '../lib/config';
import { useHealth } from '../lib/queries';

const KIND: Record<string, 'LIVE' | 'RECORDED'> = { '/lab': 'RECORDED', '/radar': 'LIVE', '/judges': 'RECORDED' };

const CONTRACTS = [['Pocket router', 'router'], ['Pocket factory', 'factory'], ['Drop links', 'drop'], ['Drop pools', 'pool']] as const;

export default function ProofPage() {
  const { data: h } = useHealth();
  return (
    <Page narrow testId="proof-page">
      <PageTitle eyebrow="Proof" title="Check our claims">Every number here is labelled LIVE (read from the chain just now) or RECORDED (a mined transaction or file you can open).</PageTitle>
      <ul className="space-y-3">
        {PROOF_ITEMS.map(({ to, label, sub, Icon }) => (
          <li key={to}>
            <Link to={to} data-testid={`proof-card-${label.toLowerCase()}`} className="flex items-center gap-4 rounded-3xl border border-zinc-200 bg-white/90 p-5 shadow-sm hover:bg-stoneBg">
              <span className="flex h-11 w-11 items-center justify-center rounded-full border border-zinc-200 bg-stoneBg"><Icon className="h-5 w-5" aria-hidden /></span>
              <span className="min-w-0 flex-1"><span className="block font-serif text-2xl text-zinc-900">{label}</span><span className="block text-sm text-zinc-600">{sub}</span></span>
              <SourceBadge kind={KIND[to]} /><ArrowRight className="h-4 w-4 text-zinc-400" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>

      <section className="mt-8 space-y-3 rounded-3xl border border-zinc-200 bg-white/90 p-5 shadow-sm sm:p-6" data-testid="proof-contracts">
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-serif text-2xl text-zinc-900">The contracts, on the explorer</h2><SourceBadge kind="RECORDED" /></div>
        <p className="text-sm text-zinc-700">Every drop, pool and Pocket action is a transaction to one of these addresses on Diana testnet (chain id 9800). Open one and read its transactions yourself.</p>
        <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
          {CONTRACTS.map(([label, k]) => (
            <div key={k} className="contents">
              <dt className="text-zinc-600">{label}</dt>
              <dd className="min-w-0"><a href={addrUrl(INST.prod[k])} target="_blank" rel="noopener noreferrer" className="break-all underline decoration-zinc-300 underline-offset-2"><Mono>{INST.prod[k]}</Mono></a></dd>
            </div>
          ))}
        </dl>
        <p className="text-xs text-zinc-600">Production instance. The lab instance (60 s delays, for demos) has its own set, listed on the Lab page.</p>
      </section>

      <section className="mt-5 space-y-3 rounded-3xl border border-zinc-200 bg-white/90 p-5 shadow-sm sm:p-6" data-testid="proof-relayer">
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-serif text-2xl text-zinc-900">The relayer, right now</h2><SourceBadge kind="LIVE" /></div>
        <p className="text-sm text-zinc-700">The relayer pays gas for receivers, so it holds a little QOR. It can only submit what a Pocket key signed; it cannot move anyone&apos;s money.</p>
        <p className="text-sm text-zinc-800" data-testid="proof-relayer-line">{h ? <>Balance <b className="font-mono">{h.relayer?.balance ? Number(h.relayer.balance).toFixed(2) : 'unknown'}</b> QOR · signing window {h.window.live ? <>open, {h.window.remainingBlocks} blocks left</> : 'renewing'}</> : 'Reading the relayer…'}</p>
      </section>

      <section className="mt-5 space-y-2 rounded-3xl border border-zinc-200 bg-white/90 p-5 shadow-sm sm:p-6" data-testid="proof-self-check">
        <h2 className="font-serif text-2xl text-zinc-900">Check it yourself in three steps</h2>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-zinc-700">
          <li>Open <Link to="/lab" className="underline">Lab</Link> and press <b>Verify live</b>: each refused attack is re-read from the chain and replayed.</li>
          <li>Open <Link to="/radar" className="underline">Radar</Link>: every count comes from contract events, with own and external accounts kept apart.</li>
          <li>Read the code and the recorded runs in the <a href={SOURCE_URL} target="_blank" rel="noopener noreferrer" className="underline">public repository</a>.</li>
        </ol>
      </section>
    </Page>
  );
}

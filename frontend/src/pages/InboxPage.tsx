import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button, Mono, Notice, Page, PageTitle, Pill, SourceBadge } from '../components/ui';
import { ConnectChoices } from '../components/account';
import { ConfirmCard, Empty, LinkRow, type OnTx } from '../components/links';
import { SendTabs } from './SendPage';
import { useAccount } from '../lib/account';
import { isTerminal, useMyLinks } from '../lib/hooks4';

export default function InboxPage() {
  const a = useAccount();
  const [params] = useSearchParams();
  const focus = params.get('link');
  const { links, loading, refetch } = useMyLinks();
  const [txs, setTxs] = useState<Record<string, { what: string; hash: string }>>({});
  const onTx: OnTx = (k, t) => setTxs((x) => ({ ...x, [k]: t }));

  const needs = links.filter((l) => l.drop?.state === 'Bound' && l.drop.mode === 'Confirmed');
  const waiting = links.filter((l) => !needs.includes(l) && (l.drop ? !isTerminal(l.drop.state) : l.pool ? !l.pool.closed && l.pool.taken < l.pool.slots : true));
  const done = links.filter((l) => !needs.includes(l) && !waiting.includes(l));

  return (
    <Page narrow testId="inbox-page">
      <PageTitle eyebrow="Send" title="Your inbox">Every drop and pool your Pocket made, with its live state. A friend waiting for you appears at the top, and confirming is one tap.</PageTitle>
      <SendTabs />
      {!a.root ? (
        <div className="space-y-4" data-testid="inbox-signin">
          <Notice tone="info">{focus ? `Someone is waiting for you to confirm ${focus}. ` : ''}Open your Pocket on this device to see your links and confirm. If you made them on another device, restore with its backup key.</Notice>
          <div className="rounded-3xl border border-zinc-200 bg-white/90 p-5 shadow-sm sm:p-6"><ConnectChoices /></div>
        </div>
      ) : (
        <div className="space-y-6">
          {loading && <p className="text-sm text-zinc-500">Reading your links from the chain…</p>}
          {needs.length > 0 && (
            <section className="space-y-4" data-testid="needs-you">
              <div className="flex items-center gap-2"><h2 className="font-serif text-2xl text-zinc-900">Needs your confirmation</h2><Pill tone="warn">{needs.length}</Pill></div>
              {needs.map((m) => <ConfirmCard key={m.created.id.toString()} m={m} onTx={onTx} />)}
            </section>
          )}
          <section className="space-y-3">
            <div className="flex items-center justify-between"><h2 className="font-serif text-2xl text-zinc-900">Waiting</h2><span className="flex items-center gap-2"><SourceBadge kind="LIVE" /><Button variant="ghost" className="!min-h-[32px] !px-3" onClick={() => void refetch()}>Refresh</Button></span></div>
            {waiting.length === 0 && <Empty text="Nothing in flight. Drops and pools you create show up here until they are claimed." />}
            {waiting.map((m) => <LinkRow key={`${m.created.kind}${m.created.id}`} m={m} tx={txs[`${m.created.kind}:${m.created.id}`]} onTx={onTx} />)}
          </section>
          <section className="space-y-3">
            <h2 className="font-serif text-2xl text-zinc-900">Finished</h2>
            {done.length === 0 && <Empty text="Claimed, cancelled, refunded and closed links collect here." />}
            {done.map((m) => <LinkRow key={`${m.created.kind}${m.created.id}`} m={m} tx={txs[`${m.created.kind}:${m.created.id}`]} onTx={onTx} />)}
          </section>
          <p className="text-center text-xs text-zinc-500">Pocket <Mono>{a.activePocket ?? ''}</Mono></p>
        </div>
      )}
    </Page>
  );
}

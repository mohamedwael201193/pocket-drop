import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock, Inbox as InboxIcon } from 'lucide-react';
import { Button, Fingerprint, Mono, Notice, Page, PageTitle, Pill, SourceBadge, TxLink, cx } from '../components/ui';
import { ConnectChoices } from '../components/account';
import { ShareCard } from '../components/share';
import { SendTabs } from './SendPage';
import { useAccount } from '../lib/account';
import { scanSenderLinks } from '../lib/inbox';
import { fetchLink, type ApiLink } from '../lib/api';
import { addrUrl } from '../lib/config';
import { fmtQor } from '../lib/chain';
import { fingerprint } from '../lib/protocol';
import { cancelLink, confirmRecipient, refundLink, type StoredLink } from '../lib/sender';
import type { Hex } from 'viem';

const TERMINAL = ['Claimed', 'Cancelled', 'Refunded'];

export default function InboxPage() {
  const { sender, links } = useAccount();
  const [params] = useSearchParams();
  const focus = params.get('link');
  const scan = useQuery({ queryKey: ['inbox', sender?.address], enabled: !!sender, queryFn: () => scanSenderLinks(sender!.address), refetchInterval: 20_000 });

  const rows = useMemo(() => {
    const m = new Map<string, { id: string; mode: 'Confirmed' | 'Open'; amountWei: string; stored?: StoredLink }>();
    for (const c of scan.data ?? []) m.set(c.id, { id: c.id, mode: c.mode, amountWei: c.amountWei });
    for (const l of links) if (l.id && (m.has(l.id) || !scan.data)) m.set(l.id, { id: l.id, mode: l.mode, amountWei: l.amountWei, stored: l.seed ? l : undefined });
    if (focus && /^\d+$/.test(focus) && !m.has(focus)) m.set(focus, { id: focus, mode: 'Confirmed', amountWei: '0' });
    return [...m.values()].sort((a, b) => Number(BigInt(b.id) - BigInt(a.id)));
  }, [scan.data, links, focus]);

  const results = useQueries({ queries: rows.map((r) => ({
    queryKey: ['link', r.id], queryFn: () => fetchLink(r.id),
    refetchInterval: (q: { state: { data?: ApiLink } }) => (q.state.data && TERMINAL.includes(q.state.data.state) ? false : 3000) as number | false,
  })) });
  const live = rows.map((r, i) => ({ ...r, link: results[i]?.data }));
  const mine = live.filter((r) => !r.link || !sender || r.link.sender.toLowerCase() === sender.address.toLowerCase());
  const foreign = live.find((r) => r.link && sender && r.link.sender.toLowerCase() !== sender.address.toLowerCase() && r.id === focus);
  const needs = mine.filter((r) => r.link?.state === 'Bound' && r.link.mode === 'Confirmed' && r.link.recipientKeyHash);
  const waiting = mine.filter((r) => r.link && !needs.includes(r) && !TERMINAL.includes(r.link.state));
  const done = mine.filter((r) => r.link && TERMINAL.includes(r.link.state));

  return (
    <Page narrow testId="inbox-page">
      <PageTitle eyebrow="Send" title="Your inbox">Every link you made, with its live state. A friend waiting for you appears at the top.</PageTitle>
      <SendTabs />
      {!sender ? (
        <div className="space-y-4" data-testid="inbox-signin">
          <Notice tone="info">{focus ? `Someone is waiting for you to confirm link #${focus}. ` : ''}Open your sender account on this device to see your links and confirm. If you made them on another device, restore with its backup key.</Notice>
          <div className="rounded-3xl border border-zinc-200 bg-white/90 p-5 shadow-sm sm:p-6"><ConnectChoices /></div>
        </div>
      ) : (
        <div className="space-y-6">
          {foreign && <Notice tone="warn" testId="foreign-link">Link #{focus} was created by a different account (<Mono>{foreign.link!.sender}</Mono>). Restore that account's backup key to confirm it.</Notice>}
          {scan.isLoading && <p className="text-sm text-zinc-500">Reading your links from the chain…</p>}

          {needs.length > 0 && (
            <section className="space-y-4" data-testid="needs-you">
              <div className="flex items-center gap-2"><h2 className="font-serif text-2xl text-zinc-900">Needs your confirmation</h2><Pill tone="warn">{needs.length}</Pill></div>
              {needs.map((r) => <ConfirmCard key={r.id} id={r.id} link={r.link!} highlight={r.id === focus} />)}
            </section>
          )}

          <section className="space-y-3">
            <div className="flex items-center justify-between"><h2 className="font-serif text-2xl text-zinc-900">Waiting</h2><SourceBadge kind="LIVE" /></div>
            {waiting.length === 0 && <Empty text="Nothing in flight. Links you create show up here until they are claimed." />}
            {waiting.map((r) => <Row key={r.id} r={r} />)}
          </section>

          <section className="space-y-3">
            <h2 className="font-serif text-2xl text-zinc-900">Finished</h2>
            {done.length === 0 && <Empty text="Claimed, cancelled and refunded links collect here." />}
            {done.map((r) => <Row key={r.id} r={r} />)}
          </section>
          <p className="text-center text-xs text-zinc-500">Account <Mono>{sender.address}</Mono></p>
        </div>
      )}
    </Page>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="flex items-center gap-3 rounded-2xl border border-dashed border-zinc-300 p-4 text-sm text-zinc-500"><InboxIcon className="h-5 w-5 shrink-0" aria-hidden />{text}</div>;
}

function ConfirmCard({ id, link, highlight }: { id: string; link: ApiLink; highlight: boolean }) {
  const { sender } = useAccount();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tx, setTx] = useState<{ what: string; hash: string } | null>(null);
  const words = fingerprint(link.recipientKeyHash!);
  async function run(what: 'confirm' | 'cancel') {
    if (!sender) return;
    setBusy(what); setErr(null);
    try {
      const r = what === 'confirm' ? await confirmRecipient(sender, id, link.recipientKeyHash as Hex) : await cancelLink(sender, id);
      setTx({ what, hash: r.hash });
      await qc.invalidateQueries({ queryKey: ['link', id] }); await qc.invalidateQueries({ queryKey: ['balance'] });
    } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  }
  return (
    <div className={cx('space-y-3 rounded-3xl border p-5 shadow-sm sm:p-6', highlight ? 'border-zinc-900 bg-white' : 'border-amber-300 bg-amber-50/60')} data-testid={`confirm-panel-${id}`}>
      <p className="text-sm text-zinc-800"><strong>Someone opened link #{id} ({fmtQor(BigInt(link.amount))} QOR).</strong> Ask them for the 4 words on their screen. Confirm only if they are exactly these:</p>
      <Fingerprint words={words} testId={`fp-${id}`} />
      <Button block onClick={() => void run('confirm')} busy={busy === 'confirm'} disabled={!!busy} data-testid={`confirm-${id}`} className="min-h-[52px] text-base"><Lock className="h-4 w-4" aria-hidden />The words match: Confirm</Button>
      <Button block variant="ghost" onClick={() => void run('cancel')} busy={busy === 'cancel'} disabled={!!busy} data-testid={`cancel-bound-${id}`}>They differ: cancel and refund me</Button>
      <p className="text-xs text-zinc-600">Confirming sends one transaction naming exactly this recipient key. After that you cannot cancel.</p>
      {err && <Notice tone="error">{err}</Notice>}
      {tx && <p className="font-mono text-xs text-emerald-700" data-testid="confirm-status-msg">{tx.what} mined: <TxLink hash={tx.hash} testId={`tx-${tx.what}-${id}`} /></p>}
    </div>
  );
}

function Row({ r }: { r: { id: string; mode: 'Confirmed' | 'Open'; amountWei: string; stored?: StoredLink; link?: ApiLink } }) {
  const { sender } = useAccount();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tx, setTx] = useState<{ what: string; hash: string } | null>(null);
  const [show, setShow] = useState(false);
  const l = r.link;
  const expired = l ? Number(l.expiry) * 1000 < Date.now() : false;
  async function run(what: string, fn: () => Promise<{ hash: string }>) {
    setBusy(what); setErr(null);
    try { const x = await fn(); setTx({ what, hash: x.hash }); await qc.invalidateQueries({ queryKey: ['link', r.id] }); await qc.invalidateQueries({ queryKey: ['balance'] }); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  }
  const amount = l ? l.amount : r.amountWei;
  const note = !l ? 'Reading…'
    : l.state === 'Open' ? 'Waiting for someone to open the link.'
    : l.state === 'Bound' ? (l.mode === 'Open' ? 'Opened. The receiver is setting up and will claim by themselves.' : 'Opened.')
    : l.state === 'Confirmed' ? 'You confirmed. They can claim now.'
    : l.state === 'Claimed' ? 'Delivered.' : 'The money went back to you.';
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white/90 p-4 shadow-sm" data-testid={`link-${r.id}`} data-state={l?.state ?? 'loading'}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-zinc-900">#{r.id} · {fmtQor(BigInt(amount))} QOR · {(l?.mode ?? r.mode) === 'Open' ? 'Giveaway' : 'Confirmed'}</span>
        <Pill tone={l?.state === 'Claimed' ? 'ok' : l && TERMINAL.includes(l.state) ? 'neutral' : 'warn'} testId={`state-${r.id}`}>{l?.state ?? '…'}</Pill>
      </div>
      <p className="mt-1 text-sm text-zinc-600">{note}{l?.state === 'Claimed' && l.recipient && <> To <a className="underline" href={addrUrl(l.recipient)} target="_blank" rel="noopener noreferrer" data-testid={`claimed-${r.id}`}>{l.recipient.slice(0, 10)}…</a></>}</p>
      {l?.state === 'Open' && sender && (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap gap-2">
            {r.stored && <Button variant="secondary" onClick={() => setShow(!show)}>{show ? 'Hide link' : 'Show link'}</Button>}
            <Button variant="danger" busy={busy === 'cancel'} onClick={() => void run('cancel', () => cancelLink(sender, r.id))} data-testid={`cancel-${r.id}`}>Cancel and refund</Button>
          </div>
          {show && r.stored && <ShareCard link={r.stored} headline="Your link" />}
          {!r.stored && <p className="text-xs text-zinc-500">The link itself is only stored on the device that created it.</p>}
        </div>
      )}
      {l && expired && !TERMINAL.includes(l.state) && sender && <div className="mt-3"><Button variant="secondary" busy={busy === 'refund'} onClick={() => void run('refund', () => refundLink(sender, r.id))}>This link expired: refund to my account</Button></div>}
      {tx && <p className="mt-2 font-mono text-xs text-zinc-600">{tx.what}: <TxLink hash={tx.hash} testId={`tx-${tx.what}-${r.id}-row`} /></p>}
      {err && <div className="mt-2"><Notice tone="error">{err}</Notice></div>}
    </div>
  );
}


import { useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Inbox } from '../components/icons';
import { Button, Notice, Page, PageTitle, Pill } from '../components/ui';
import { PocketCard } from '../components/account';
import { SamplePoolCard } from '../components/samplePool';
import { useAccount } from '../lib/account';
import { useLink } from '../lib/queries';
import { parseLinkId, readDrop } from '../lib/claim4';
import { fmtQor } from '../lib/chain';
import { LINK_PREFIX, type Env } from '../lib/v4';
import { OpenInQorex } from '../components/openInQorex';

/** Accepts a full link or a bare path: "/c/17#k=<64 hex>" (v3), "/c/s12#k=…" (v5.2 drop; r/m = v5.1, q/k = v5, p/l = v4) or "/pool/s3#k=…" (v5.2 pool). Returns the in-app path. */
export function parseClaimInput(raw: string): string | null {
  const m = /\/(c|pool)\/([plqkrmsn]?\d+)#k=([0-9a-fA-F]{64})\s*$/.exec(raw.trim());
  if (!m || (m[1] === 'pool' && !/^[plqkrmsn]/.test(m[2]))) return null;
  return `/${m[1]}/${m[2]}#k=${m[3].toLowerCase()}`;
}

/** Why a pasted text is not a link, in plain words (UX-7). */
export function claimInputProblem(raw: string): string {
  const t = raw.trim();
  if (!t) return 'Paste the link you were sent first.';
  if (!/\/(c|pool)\//.test(t)) return 'That is not a Pocket Drop link. Paste the whole link from your message, starting with https://.';
  if (!t.includes('#k=')) return 'The link is cut short: the secret part after # is missing. Copy the whole link again, all the way to the end.';
  return 'The link looks damaged: its secret part is incomplete. Copy the whole link again, all the way to the end.';
}

/** Links already opened in this browser (their keys are stored locally under pd.recv.<id> for v3 and pd.recv4.<env>.<id> for v4). */
function openedHere(): string[] {
  try {
    const ids: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      const m = k && /^pd\.recv\.(\d+)$/.exec(k);
      if (m) ids.push(m[1]);
      const m4 = k && /^pd\.recv4\.(prod|lab|prodV51|labV51|prodV5|labV5|prodV4|labV4)\.(\d+)$/.exec(k);
      if (m4) ids.push(`${LINK_PREFIX[m4[1] as Env]}${m4[2]}`);
    }
    return ids.sort();
  } catch { return []; }
}

function OpenedRow({ id }: { id: string }) {
  const p = parseLinkId(id);
  const { data: l3 } = useLink(p?.v === 3 ? id : undefined, 5000);
  const { data: l4 } = useQuery({
    queryKey: ['drop4', p?.v === 4 ? p.env : '', id], enabled: p?.v === 4, refetchInterval: 5000,
    queryFn: () => readDrop((p as { env: Env }).env, (p as { id: bigint }).id),
  });
  const l = l3 ? { state: l3.state, amount: BigInt(l3.amount) } : l4 ? { state: l4.state, amount: l4.amount } : undefined;
  return (
    <li>
      <Link to={`/c/${id}`} data-testid={`opened-${id}`} className="flex items-center justify-between gap-3 rounded-2xl border border-zinc-200 bg-white/90 p-4 shadow-sm hover:bg-stoneBg">
        <span className="text-sm font-medium text-zinc-900">Link {p?.v === 3 ? `#${id}` : id}{l && ` · ${fmtQor(l.amount)} QOR`}</span>
        <Pill tone={l?.state === 'Claimed' ? 'ok' : 'warn'}>{l?.state ?? '…'}</Pill>
      </Link>
    </li>
  );
}

export default function ReceivePage() {
  const nav = useNavigate();
  const a = useAccount();
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const ids = useMemo(openedHere, []);
  const badLink = (useLocation().state as { badLink?: string } | null)?.badLink;
  function open() {
    const p = parseClaimInput(text);
    if (!p) { setErr(claimInputProblem(text)); return; }
    setErr(null); nav(p);
  }
  return (
    <Page narrow testId="receive-page">
      <PageTitle eyebrow="Receive" title="Open a link you were sent">Normally you just tap the link in your chat and land on the claim screen. If it did not open, paste it here. What you receive is paid into Your Pocket.</PageTitle>
      <div className="space-y-5">
        {badLink && <Notice tone="warn" testId="bad-link">The address <code className="break-all font-mono text-xs">{badLink}</code> is not a Pocket Drop link. Paste the whole link you were sent below.</Notice>}
        <section className="rounded-3xl border border-zinc-200 bg-white/90 p-5 shadow-sm sm:p-6" data-testid="claim-entry">
          <label htmlFor="claim-input" className="text-sm font-semibold text-zinc-900">Paste your link</label>
          <div className="mt-2 flex gap-2">
            <input id="claim-input" value={text} onChange={(e) => { setText(e.target.value); setErr(null); }} placeholder="https://…/c/s12#k=…" aria-invalid={!!err} aria-describedby="claim-input-error" data-testid="claim-input" className="min-w-0 flex-1 rounded-xl border border-zinc-300 bg-white px-3 py-3 font-mono text-xs" />
            <Button onClick={open} data-testid="claim-open">Open</Button>
          </div>
          {err && <p id="claim-input-error" role="alert" className="mt-2 text-sm font-medium text-red-700" data-testid="claim-input-error">{err}</p>}
          <p className="mt-3 text-xs text-zinc-500">Links from WhatsApp, Telegram, SMS or email all work. You need no wallet.</p>
          <div className="mt-2"><OpenInQorex testId="open-in-qorex-receive" /></div>
        </section>
        <SamplePoolCard />
        {a.root && <section className="rounded-3xl border border-zinc-200 bg-white/90 p-5 shadow-sm sm:p-6"><PocketCard compact /></section>}
        <section className="space-y-3">
          <h2 className="font-serif text-2xl text-zinc-900">Opened in this browser</h2>
          {ids.length === 0
            ? <div className="flex items-center gap-3 rounded-2xl border border-dashed border-zinc-300 p-4 text-sm text-zinc-500"><Inbox className="h-5 w-5 shrink-0" aria-hidden />Nothing yet. Links you open here are listed so you can come back to them.</div>
            : <ul className="space-y-2">{ids.map((id) => <OpenedRow key={id} id={id} />)}</ul>}
        </section>
      </div>
    </Page>
  );
}

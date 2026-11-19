import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Inbox } from 'lucide-react';
import { Button, Notice, Page, PageTitle, Pill } from '../components/ui';
import { useLink } from '../lib/queries';
import { fmtQor } from '../lib/chain';

/** Accepts a full link, or "/c/17#k=<64 hex>", and returns the in-app path. */
export function parseClaimInput(raw: string): string | null {
  const m = /\/c\/(\d+)#k=([0-9a-fA-F]{64})\s*$/.exec(raw.trim());
  return m ? `/c/${m[1]}#k=${m[2].toLowerCase()}` : null;
}

/** Links already opened in this browser (the key for each is stored locally under pd.recv.<id>). */
function openedHere(): string[] {
  try {
    const ids: string[] = [];
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); const m = k && /^pd\.recv\.(\d+)$/.exec(k); if (m) ids.push(m[1]); }
    return ids.sort((a, b) => Number(b) - Number(a));
  } catch { return []; }
}

function OpenedRow({ id }: { id: string }) {
  const { data: l } = useLink(id, 5000);
  return (
    <li>
      <Link to={`/c/${id}`} data-testid={`opened-${id}`} className="flex items-center justify-between gap-3 rounded-2xl border border-zinc-200 bg-white/90 p-4 shadow-sm hover:bg-stoneBg">
        <span className="text-sm font-medium text-zinc-900">Link #{id}{l && ` · ${fmtQor(BigInt(l.amount))} QOR`}</span>
        <Pill tone={l?.state === 'Claimed' ? 'ok' : 'warn'}>{l?.state ?? '…'}</Pill>
      </Link>
    </li>
  );
}

export default function ReceivePage() {
  const nav = useNavigate();
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const ids = useMemo(openedHere, []);
  function open() {
    const p = parseClaimInput(text);
    if (!p) { setErr('That does not look like a Pocket Drop link. It ends with /c/NUMBER#k= and 64 characters.'); return; }
    setErr(null); nav(p);
  }
  return (
    <Page narrow testId="receive-page">
      <PageTitle eyebrow="Receive" title="Open a link you were sent">Normally you just tap the link in your chat and land on the claim screen. If it did not open, paste it here.</PageTitle>
      <div className="space-y-5">
        <section className="rounded-3xl border border-zinc-200 bg-white/90 p-5 shadow-sm sm:p-6" data-testid="claim-entry">
          <label htmlFor="claim-input" className="text-sm font-semibold text-zinc-900">Paste your link</label>
          <div className="mt-2 flex gap-2">
            <input id="claim-input" value={text} onChange={(e) => setText(e.target.value)} placeholder="https://…/c/17#k=…" data-testid="claim-input" className="min-w-0 flex-1 rounded-xl border border-zinc-300 bg-white px-3 py-3 font-mono text-xs" />
            <Button onClick={open} data-testid="claim-open">Open</Button>
          </div>
          {err && <div className="mt-3"><Notice tone="error" testId="claim-input-error">{err}</Notice></div>}
          <p className="mt-3 text-xs text-zinc-500">Links from WhatsApp, Telegram, SMS or email all work. You need no wallet.</p>
        </section>
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

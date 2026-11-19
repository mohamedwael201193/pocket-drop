import { useEffect } from 'react';
import { Check, Minus, X } from 'lucide-react';
import { BackupPanel, ConnectChoices, PocketStatus } from '../components/account';
import { Card, Mono, Notice, Page, PageTitle, Pill, SourceBadge } from '../components/ui';
import { useAccount, useQorexBalance } from '../lib/account';
import { fmtQor } from '../lib/chain';


function Row({ ok, label, why }: { ok: boolean | null; label: string; why: string }) {
  return (
    <li className="flex items-start gap-3 py-2.5">
      <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${ok === null ? 'bg-zinc-200 text-zinc-600' : ok ? 'bg-emerald-600 text-white' : 'bg-zinc-200 text-zinc-500'}`}>{ok === null ? <Minus className="h-3 w-3" aria-hidden /> : ok ? <Check className="h-3 w-3" aria-hidden /> : <X className="h-3 w-3" aria-hidden />}</span>
      <span className="text-sm"><span className="font-medium text-zinc-900">{label}</span><span className="block text-xs text-zinc-600">{why}</span></span>
    </li>
  );
}

export default function PocketPage() {
  const a = useAccount();
  const { data: qBal } = useQorexBalance();

  // Device-transfer link: /pocket#restore=<64 hex>. Import, then remove the key from the address bar.
  useEffect(() => {
    const m = /^#restore=([0-9a-fA-F]{64})$/.exec(window.location.hash);
    if (m) { try { a.restore(m[1]); } catch { /* shown by the restore field */ } history.replaceState(null, '', '/pocket'); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Page narrow testId="pocket-page">
      <PageTitle eyebrow="Pocket" title="Your account">The account that sends your drops: balance, backup, and what QoreX adds.</PageTitle>
      <div className="space-y-5">
        <Card>
          <div className="mb-4 flex items-center justify-between"><h2 className="font-serif text-2xl text-zinc-900">Pocket</h2>{a.sender && <Pill tone="ok">This browser</Pill>}</div>
          {a.sender ? <PocketStatus /> : <ConnectChoices />}
        </Card>

        {a.sender && (
          <Card>
            <h2 className="mb-4 font-serif text-2xl text-zinc-900">Backup and restore</h2>
            <BackupPanel />
          </Card>
        )}

        {a.qorexState !== 'missing' && a.qorexState !== 'checking' && (
          <Card data-testid="qorex-card">
            <div className="mb-3 flex items-center justify-between"><h2 className="font-serif text-2xl text-zinc-900">QoreX</h2>{a.identity ? <SourceBadge kind="LIVE" /> : <Pill>optional</Pill>}</div>
            {a.identity ? (
              <>
                <p className="text-sm text-zinc-700">Connected: <Mono>{a.identity.cosmos}</Mono></p>
                <p className="mt-1 text-sm text-zinc-700">QoreX balance: <span className="font-mono">{qBal === undefined ? '…' : `${fmtQor(qBal)} QOR`}</span></p>
                <ul className="mt-3 divide-y divide-zinc-100">
                  <Row ok label="Identity" why="Your QoreX address names your account and keeps one Pocket per person in this browser." />
                  <Row ok label="Balance" why="Read live from the chain." />
                  <Row ok={a.identity.canFund} label="Top up your Pocket" why={a.identity.canFund ? 'A normal QoreX send to your Pocket address, approved in QoreX.' : 'This QoreX build does not offer web-page sends.'} />
                  <Row ok={false} label="Signing Pocket Drop transactions" why="QoreX does not answer eth_sendTransaction yet, so the contract calls are signed by your Pocket key in this browser." />
                  <Row ok={a.identity.canSignMessage ? null : false} label="Message signing" why={a.identity.canSignMessage ? 'Advertised by this QoreX build. Pocket Drop does not use it yet (planned for the next contract version); nothing is signed today.' : 'Not advertised by this QoreX build.'} />
                </ul>
                <button type="button" onClick={a.disconnect} className="mt-3 text-xs text-zinc-600 underline">Disconnect QoreX</button>
              </>
            ) : (
              <>
                <p className="text-sm text-zinc-600">QoreX was found in this browser. Connect it to see your QoreX identity and top up your Pocket. Not required to send or receive.</p>
                <button type="button" data-testid="connect-qorex" onClick={() => void a.connect()} disabled={a.qorexState === 'connecting'} className="mt-3 inline-flex min-h-[44px] items-center rounded-full border border-zinc-300 bg-white px-5 text-sm font-medium hover:bg-stoneCard">{a.qorexState === 'connecting' ? 'Waiting for QoreX…' : 'Connect QoreX'}</button>
                {a.qorexError && <div className="mt-3"><Notice tone="warn">{a.qorexError}</Notice></div>}
              </>
            )}
          </Card>
        )}
      </div>
    </Page>
  );
}

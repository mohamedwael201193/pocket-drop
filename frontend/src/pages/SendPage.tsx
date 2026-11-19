import { useMemo, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { ArrowRight, MessageCircle, ShieldCheck, Gift } from 'lucide-react';
import { Button, Mono, Notice, Page, PageTitle, Pill, StepCard, TxLink, cx } from '../components/ui';
import { ConnectChoices, PocketStatus } from '../components/account';
import { ShareCard } from '../components/share';
import { useAccount, usePocket } from '../lib/account';
import { LIMITS } from '../lib/config';
import { fmtQor, parseQor } from '../lib/chain';
import { createLink } from '../lib/sender';

const RELAYER_FEE = '0.01';
const MIN_DRIP = '0.2';
const CHIPS = ['0.1', '0.3', '1', '5'];
const TTLS = [{ label: '1 hour', s: 3600 }, { label: '24 hours', s: 86_400 }, { label: '7 days', s: 604_800 }];

export function SendTabs() {
  const cls = ({ isActive }: { isActive: boolean }) => cx('flex-1 rounded-full px-4 py-2 text-center text-sm font-medium', isActive ? 'bg-zinc-900 text-stone-100' : 'text-zinc-600');
  return (
    <div className="mb-6 flex gap-1 rounded-full border border-zinc-200 bg-white/80 p-1" role="tablist" aria-label="Send views">
      <NavLink to="/send" end className={cls} data-testid="send-new">New drop</NavLink>
      <NavLink to="/send/inbox" className={cls} data-testid="send-inbox">Inbox</NavLink>
    </div>
  );
}

export default function SendPage() {
  const { sender, refreshLinks, links } = useAccount();
  const pocket = usePocket();
  const [mode, setMode] = useState<'Confirmed' | 'Open'>('Confirmed');
  const [amount, setAmount] = useState('0.3');
  const [drip, setDrip] = useState('0.25');
  const [ttl, setTtl] = useState(86_400);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [freshId, setFreshId] = useState<string | null>(null);

  const a = parseQor(amount); const d = parseQor(drip); const fee = parseQor(RELAYER_FEE)!;
  const ready = !!sender && pocket.funded && pocket.active;
  const problem = useMemo(() => {
    if (a === null) return 'Enter an amount like 0.3';
    if (a < parseQor(String(LIMITS.minEscrowQor))!) return `Minimum is ${LIMITS.minEscrowQor} QOR`;
    if (a > parseQor(String(LIMITS.maxAmountQor))!) return `Maximum is ${LIMITS.maxAmountQor} QOR`;
    if (d === null) return 'Enter a gas drip like 0.25';
    if (d < parseQor(MIN_DRIP)!) return `The gas drip must be at least ${MIN_DRIP} QOR so the recipient can register their key`;
    if (d > parseQor(String(LIMITS.maxDripQor))!) return `The gas drip is capped at ${LIMITS.maxDripQor} QOR`;
    if (!sender) return 'Set up your account in step 1.';
    if (pocket.balance === undefined) return 'Reading your balance…';
    if (!pocket.active) return 'Finish step 1: fund and activate your account.';
    if (pocket.remainingUqor !== undefined && pocket.remainingUqor * 10n ** 12n < a + d + fee + 10_000_000_000_000_000n) return 'Your authorisation window is too small for this amount. Activate the account again to refresh it.';
    if (pocket.balance < a + d + fee + 20_000_000_000_000_000n) return 'Balance too low for this amount plus fees. Add QOR in step 1.';
    return null;
  }, [a, d, fee, sender, pocket.balance, pocket.active, pocket.remainingUqor]);

  async function submit() {
    if (problem || a === null || d === null || !sender) return;
    setBusy(true); setErr(null); setTxHash(null);
    try {
      const l = await createLink(sender, { mode, amount: a, drip: d, relayerFee: fee, ttlSeconds: ttl });
      setTxHash(l.txHash); setFreshId(l.id); refreshLinks();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  const fresh = freshId ? links.find((l) => l.id === freshId) : undefined;

  return (
    <Page narrow testId="send-page">
      <PageTitle eyebrow="Send" title="Send QOR through a link">Pick an amount, share one link. Your friend needs no wallet.</PageTitle>
      <SendTabs />
      <div className="space-y-5">
        <StepCard n={1} title="Your account" done={ready} testId="step-account">
          {sender ? <PocketStatus compact /> : <ConnectChoices />}
          {sender && <p className="mt-3 text-xs text-zinc-500">Backup, restore and QoreX live in the <Link to="/pocket" className="underline">Pocket tab</Link>.</p>}
        </StepCard>

        <StepCard n={2} title="Amount and mode" done={!problem && ready} locked={!ready}>
          <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Mode">
            {([['Confirmed', 'Confirmed', ShieldCheck, 'You check 4 words before any money moves. Safest, for someone you know.'], ['Open', 'Giveaway', Gift, 'First person to open the link gets it, with no check.']] as const).map(([m, t, Icon, line]) => (
              <button key={m} type="button" role="radio" aria-checked={mode === m} data-testid={`mode-${m}`} onClick={() => setMode(m)}
                className={cx('rounded-2xl border p-4 text-left transition', mode === m ? 'border-zinc-900 bg-stoneBg ring-1 ring-zinc-900' : 'border-zinc-200 bg-white hover:bg-stoneBg')}>
                <span className="flex items-center gap-2 text-sm font-semibold text-zinc-900"><Icon className="h-4 w-4" aria-hidden />{t}{m === 'Confirmed' && <Pill tone="dark">default</Pill>}</span>
                <span className="mt-1 block text-xs leading-snug text-zinc-600">{line}</span>
              </button>
            ))}
          </div>
          <div className="mt-5">
            <label htmlFor="amount" className="text-xs font-medium text-zinc-600">Amount (QOR)</label>
            <input id="amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="amount" className="mt-1 w-full rounded-2xl border border-zinc-300 bg-white px-4 py-3 font-serif text-3xl text-zinc-900" />
            <div className="mt-2 flex flex-wrap gap-2">{CHIPS.map((c) => <button key={c} type="button" onClick={() => setAmount(c)} className={cx('rounded-full border px-3 py-1 font-mono text-xs', amount === c ? 'border-zinc-900 bg-zinc-900 text-stone-100' : 'border-zinc-300 bg-white text-zinc-700')}>{c}</button>)}</div>
          </div>
          <details className="mt-4 text-sm">
            <summary className="cursor-pointer text-zinc-600">Gas drip and expiry</summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="text-xs text-zinc-600">Gas drip for the receiver (QOR)
                <input inputMode="decimal" value={drip} onChange={(e) => setDrip(e.target.value)} data-testid="drip" className="mt-1 w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 font-mono text-sm" /></label>
              <label className="text-xs text-zinc-600">Link valid for
                <select value={ttl} onChange={(e) => setTtl(Number(e.target.value))} className="mt-1 w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm">{TTLS.map((t) => <option key={t.s} value={t.s}>{t.label}</option>)}</select></label>
            </div>
            <p className="mt-2 text-xs text-zinc-500">The drip pays the receiver's first transactions and is spent when they open the link.</p>
          </details>
        </StepCard>

        <StepCard n={3} title="Create the link" done={!!txHash} locked={!ready}>
          <div className="rounded-2xl bg-stoneBg p-4 text-sm" data-testid="total">
            <div className="flex justify-between"><span className="text-zinc-600">You deposit</span><span className="font-mono font-semibold" data-testid="deposit">{a !== null && d !== null ? fmtQor(a + d + fee) : '–'} QOR</span></div>
            <div className="mt-1 text-xs text-zinc-500">{a !== null ? fmtQor(a) : '–'} for them + {d !== null ? fmtQor(d) : '–'} gas drip + {RELAYER_FEE} relayer fee. Unclaimed money returns to you.</div>
          </div>
          <Button block className="mt-4" busy={busy} disabled={!!problem} onClick={submit} data-testid="create-link"><MessageCircle className="h-4 w-4" aria-hidden />{busy ? 'Creating on-chain…' : 'Create link'}</Button>
          {problem && ready && <p className="mt-3 text-sm text-amber-800" data-testid="create-problem">{problem}</p>}
          {err && <div className="mt-3"><Notice tone="error" testId="create-error">{err}</Notice></div>}
        </StepCard>

        <StepCard n={4} title="Share" done={!!fresh} locked={!fresh}>
          {fresh ? (
            <div className="space-y-4">
              <p className="text-sm text-zinc-700">Created on-chain: {txHash && <TxLink hash={txHash} testId="tx-create" />}</p>
              <ShareCard link={fresh} headline="Your link is ready" />
              <Notice tone="info">{mode === 'Confirmed' ? 'When your friend opens it, their 4 words appear in your inbox. Compare and tap Confirm.' : 'Nothing more to do: the first person to open it receives the QOR.'}</Notice>
              <Link to={`/send/inbox?link=${fresh.id}`} data-testid="go-inbox" className="inline-flex items-center gap-1 text-sm font-medium text-zinc-900 underline">Track it in your inbox <ArrowRight className="h-4 w-4" aria-hidden /></Link>
            </div>
          ) : <p className="text-sm text-zinc-500">Your link and the WhatsApp button appear here once it is created.</p>}
        </StepCard>
      </div>
      {sender && <p className="mt-6 text-center text-xs text-zinc-500">Sending from <Mono>{sender.address}</Mono></p>}
    </Page>
  );
}

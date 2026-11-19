import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Eye, EyeOff, KeyRound, MessageCircle, Share2, Wallet, ShieldCheck, Link2, Users } from 'lucide-react';
import { Button, Card, CopyButton, Eyebrow, Fingerprint, Mono, Notice, SourceBadge, TxLink, cx } from '../components/ui';
import { FAUCET_URL, LIMITS, addrUrl } from '../lib/config';
import { fmtQor, parseQor } from '../lib/chain';
import { useBalance, useLink } from '../lib/queries';
import {
  cancelLink, confirmRecipient, createLink, createSender, exportSenderKey, forgetSender, importSender, loadLinks, loadSender, refundLink, saveLink,
  type SenderAccount, type StoredLink,
} from '../lib/sender';
import { buildClaimUrl, fingerprint, hexToBytes, shareMessage, whatsappUrl } from '../lib/protocol';
import { fetchLink, type ApiLink } from '../lib/api';
import type { Hex } from 'viem';

const RELAYER_FEE = '0.01';
const MIN_DRIP = '0.2';
const TTLS = [
  { label: '1 hour', s: 3600 },
  { label: '24 hours', s: 86_400 },
  { label: '7 days', s: 604_800 },
];

export function SendPage() {
  const [sender, setSender] = useState<SenderAccount | null>(() => loadSender());
  const [links, setLinks] = useState<StoredLink[]>(() => loadLinks());
  const [fresh, setFresh] = useState<string | null>(null);
  const { data: balance } = useBalance(sender?.address);
  const { data: win, refetch: refetchWin } = useQuery({
    queryKey: ['swin', sender?.address], enabled: !!sender, refetchInterval: 10_000,
    queryFn: async () => (await import('../lib/recipient')).senderWindow(hexToBytes(exportSenderKey()!)),
  });
  const needUqor = 700_000n; // room for one create (value is checked against the form in CreateCard)
  const active = !!win && win.live && win.remainingTxs > 0n && win.remainingValue > needUqor;

  return (
    <div className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-[1.05fr_1fr]">
      <div className="space-y-5">
        <header>
          <Eyebrow>Send QOR with a link</Eyebrow>
          <h1 className="mt-1.5 font-serif text-[2.35rem] leading-[1.02] tracking-tight text-zinc-900 sm:text-6xl">Send QOR to a friend who has no wallet.</h1>
          <p className="mt-3 text-sm leading-relaxed text-zinc-600 sm:text-base">
            They tap your link and a quantum-safe QoreChain account is created inside their browser. A relayer pays their first gas. No extension, no seed phrase.
          </p>
          <ul className="mt-4 grid gap-2 text-sm text-zinc-700 sm:grid-cols-3">
            {[[Link2, 'Link carries a key only in its #fragment'], [ShieldCheck, 'ML-DSA-87 checked on-chain'], [Users, 'Recipient needs no wallet']].map(([I, t], i) => {
              const Icon = I as typeof Link2;
              return <li key={i} className="flex items-start gap-2 rounded-xl border border-zinc-200 bg-white/70 px-3 py-2"><Icon className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500" aria-hidden />{t as string}</li>;
            })}
          </ul>
        </header>

        <SenderCard sender={sender} setSender={setSender} balance={balance} active={active} winKnown={win !== undefined} onActivated={() => void refetchWin()} />
      </div>

      <div className="space-y-5">
        {sender && (
          <CreateCard
            sender={sender}
            balance={balance}
            active={active}
            remainingUqor={win?.remainingValue}
            onCreated={(l) => { setLinks(loadLinks()); setFresh(l.id); }}
          />
        )}
        {fresh && links.find((l) => l.id === fresh) && (
          <ShareCard link={links.find((l) => l.id === fresh)!} headline="Link created. Send it now." />
        )}
        {sender && <MyLinks sender={sender} links={links} onAdded={() => setLinks(loadLinks())} />}
        {!sender && (
          <Card className="text-sm text-zinc-600">
            <Eyebrow>How it works</Eyebrow>
            <ol className="mt-3 list-decimal space-y-2 pl-5">
              <li>Create a sender account in this browser and fund it with testnet QOR.</li>
              <li>Pick an amount. We lock it in the PocketDrop contract and make your link.</li>
              <li>Share by WhatsApp. They open it, get an account and a few cents of gas.</li>
              <li>You confirm four words they read to you, then they claim. Giveaway mode skips the check.</li>
            </ol>
          </Card>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ sender account */

function SenderCard({ sender, setSender, balance, active, winKnown, onActivated }: { sender: SenderAccount | null; setSender: (s: SenderAccount | null) => void; balance?: bigint; active: boolean; winKnown: boolean; onActivated: () => void }) {
  const [actBusy, setActBusy] = useState<string | null>(null);
  const [actErr, setActErr] = useState<string | null>(null);
  const [actTx, setActTx] = useState<string[]>([]);
  async function activate() {
    setActBusy('Starting'); setActErr(null);
    try {
      const m = await import('../lib/recipient');
      const r = await m.activateSender(hexToBytes(exportSenderKey()!), balance ?? 0n, setActBusy);
      setActTx([r.register, r.window].filter(Boolean) as string[]);
      onActivated();
    } catch (e) { setActErr((e as Error).message); } finally { setActBusy(null); }
  }
  const [showKey, setShowKey] = useState(false);
  const [restore, setRestore] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [confirmForget, setConfirmForget] = useState(false);

  if (!sender) {
    return (
      <Card>
        <div className="flex items-center gap-2"><Wallet className="h-5 w-5 text-zinc-500" aria-hidden /><h2 className="font-serif text-2xl">Your sender account</h2></div>
        <p className="mt-2 text-sm text-zinc-600">A QoreChain account is created in this browser and kept on this device. You fund it with QOR you already have.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button data-testid="create-sender" onClick={() => setSender(createSender())}>Create sender account</Button>
        </div>
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer text-zinc-600">I already have a backup key</summary>
          <div className="mt-2 flex gap-2">
            <input value={restore} onChange={(e) => setRestore(e.target.value)} placeholder="0x… 64 hex" aria-label="Backup key" className="min-w-0 flex-1 rounded-xl border border-zinc-300 bg-white px-3 py-2 font-mono text-xs" />
            <Button variant="secondary" onClick={() => { try { setSender(importSender(restore)); setErr(null); } catch (e) { setErr((e as Error).message); } }}>Restore</Button>
          </div>
          {err && <p className="mt-1 text-xs text-red-700">{err}</p>}
        </details>
      </Card>
    );
  }

  const funded = (balance ?? 0n) >= 400_000_000_000_000_000n;
  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2"><Wallet className="h-5 w-5 text-zinc-500" aria-hidden /><h2 className="font-serif text-2xl">Your sender account</h2></div>
          <p className="mt-1 text-xs text-zinc-500">Created in this browser. Not a custodial account.</p>
        </div>
        <SourceBadge kind="LIVE" />
      </div>
      <div className="mt-4 rounded-xl bg-stone2 p-3">
        <div className="text-xs text-zinc-500">Balance</div>
        <div className="font-serif text-4xl leading-tight" data-testid="sender-balance" data-wei={balance?.toString() ?? ''}>{balance === undefined ? '…' : fmtQor(balance)} <span className="text-lg text-zinc-500">QOR</span></div>
      </div>
      <dl className="mt-3 space-y-2 text-xs">
        <div><dt className="text-zinc-500">EVM address (for QoreX or any EVM send)</dt><dd className="mt-0.5 flex flex-wrap items-center gap-2"><Mono className="min-w-0" ><span data-testid="sender-evm">{sender.address}</span></Mono><CopyButton text={sender.address} testId="copy-evm" /></dd></div>
        <div><dt className="text-zinc-500">QoreChain address (for the official faucet)</dt><dd className="mt-0.5 flex flex-wrap items-center gap-2"><Mono><span data-testid="sender-cosmos">{sender.cosmos}</span></Mono><CopyButton text={sender.cosmos} /></dd></div>
      </dl>
      {!funded && (
        <div className="mt-4"><Notice tone="warn" testId="fund-help">
          <strong>Fund this account first.</strong> Paste the QoreChain address into the <a className="underline" href={FAUCET_URL} target="_blank" rel="noopener noreferrer">official faucet</a>, or send QOR you already have to the EVM address (for example from QoreX). This page updates by itself when the QOR lands.
        </Notice></div>
      )}
      {funded && winKnown && !active && (
        <div className="mt-4 space-y-2" data-testid="activate-panel">
          <Notice tone="info"><strong>One-time activation.</strong> QoreChain requires every account to hold a registered quantum-safe key and an open authorisation window before it can send. This registers your key and opens a window limited to PocketDrop. It costs about 0.16 QOR in fees.</Notice>
          <Button block busy={!!actBusy} onClick={activate} data-testid="activate-sender">{actBusy ?? 'Activate account'}</Button>
          {actErr && <Notice tone="error" testId="activate-error">{actErr}</Notice>}
        </div>
      )}
      {active && <p className="mt-3 text-xs text-emerald-800" data-testid="sender-active">Account active. {actTx.map((h, i) => <TxLink key={h} hash={h} testId={`tx-activate-${i}`} />)}</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => setShowKey((v) => !v)}>{showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}{showKey ? 'Hide backup key' : 'Back up key'}</Button>
        <Button variant="ghost" onClick={() => setConfirmForget(true)}>Forget this account</Button>
      </div>
      {showKey && (
        <div className="mt-3"><Notice tone="warn">
          <div className="mb-1 flex items-center gap-1 font-medium"><KeyRound className="h-4 w-4" /> Backup key. Anyone with it controls this account.</div>
          <Mono>{exportSenderKey()}</Mono>
          <div className="mt-2"><CopyButton text={exportSenderKey() ?? ''} label="Copy backup key" /></div>
        </Notice></div>
      )}
      {confirmForget && (
        <div className="mt-3"><Notice tone="error">
          This removes the key from this browser. Any QOR left in the account is lost unless you backed up the key.
          <div className="mt-2 flex gap-2"><Button variant="danger" onClick={() => { forgetSender(); setSender(null); setConfirmForget(false); }}>Forget account</Button><Button variant="ghost" onClick={() => setConfirmForget(false)}>Keep it</Button></div>
        </Notice></div>
      )}
      <p className="mt-3 text-[11px] text-zinc-500"><a className="underline" href={addrUrl(sender.address)} target="_blank" rel="noopener noreferrer">View on explorer</a></p>
    </Card>
  );
}

/* ------------------------------------------------------------------ create */

function CreateCard({ sender, balance, active, remainingUqor, onCreated }: { sender: SenderAccount; balance?: bigint; active: boolean; remainingUqor?: bigint; onCreated: (l: StoredLink) => void }) {
  const [mode, setMode] = useState<'Confirmed' | 'Open'>('Confirmed');
  const [amount, setAmount] = useState('0.3');
  const [drip, setDrip] = useState('0.25');
  const [ttl, setTtl] = useState(86_400);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const a = parseQor(amount); const d = parseQor(drip); const fee = parseQor(RELAYER_FEE)!;
  const problem = useMemo(() => {
    if (a === null) return 'Enter an amount like 0.3';
    if (a < parseQor(String(LIMITS.minEscrowQor))!) return `Minimum is ${LIMITS.minEscrowQor} QOR`;
    if (a > parseQor(String(LIMITS.maxAmountQor))!) return `Maximum is ${LIMITS.maxAmountQor} QOR`;
    if (d === null) return 'Enter a gas drip like 0.25';
    if (d < parseQor(MIN_DRIP)!) return `The gas drip must be at least ${MIN_DRIP} QOR so the recipient can register their key`;
    if (d > parseQor(String(LIMITS.maxDripQor))!) return `The gas drip is capped at ${LIMITS.maxDripQor} QOR`;
    if (balance === undefined) return 'Reading your balance…';
    if (!active) return 'Activate your account first (see the panel on the left).';
    if (remainingUqor !== undefined && remainingUqor * 10n ** 12n < a + d + fee + 10_000_000_000_000_000n) return 'Your authorisation window is too small for this amount. Activate the account again to refresh it.';
    if (balance < a + d + fee + 20_000_000_000_000_000n) return 'Balance too low for this amount plus fees. Fund the account first.';
    return null;
  }, [a, d, fee, balance, active, remainingUqor]);

  async function submit() {
    if (problem || a === null || d === null) return;
    setBusy(true); setErr(null); setTxHash(null);
    try {
      const l = await createLink(sender, { mode, amount: a, drip: d, relayerFee: fee, ttlSeconds: ttl });
      setTxHash(l.txHash);
      onCreated(l);
    } catch (e) {
      setErr((e as Error).message);
    } finally { setBusy(false); }
  }

  return (
    <Card>
      <h2 className="font-serif text-2xl">Create a link</h2>
      <div className="mt-3 grid grid-cols-2 gap-2" role="radiogroup" aria-label="Mode">
        {([['Confirmed', 'Confirmed', 'You check 4 words before money moves. Safest.'], ['Open', 'Giveaway', 'First person to open it gets it. No check.']] as const).map(([m, t, sub]) => (
          <button key={m} type="button" role="radio" aria-checked={mode === m} data-testid={`mode-${m}`} onClick={() => setMode(m)}
            className={cx('rounded-xl border p-3 text-left transition', mode === m ? 'border-zinc-900 bg-zinc-900 text-stone-50' : 'border-zinc-300 bg-white hover:bg-stone2')}>
            <div className="text-sm font-semibold">{t}</div>
            <div className={cx('mt-0.5 text-xs leading-snug', mode === m ? 'text-stone-300' : 'text-zinc-500')}>{sub}</div>
          </button>
        ))}
      </div>

      <label className="mt-4 block text-sm font-medium text-zinc-800">Amount (QOR)
        <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="amount" className="mt-1 w-full rounded-xl border border-zinc-300 bg-white px-3 py-3 font-mono" />
      </label>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <label className="block text-sm font-medium text-zinc-800">Gas drip (QOR)
          <input inputMode="decimal" value={drip} onChange={(e) => setDrip(e.target.value)} data-testid="drip" className="mt-1 w-full rounded-xl border border-zinc-300 bg-white px-3 py-3 font-mono" />
        </label>
        <label className="block text-sm font-medium text-zinc-800">Link valid for
          <select value={ttl} onChange={(e) => setTtl(Number(e.target.value))} className="mt-1 w-full rounded-xl border border-zinc-300 bg-white px-3 py-3">
            {TTLS.map((t) => <option key={t.s} value={t.s}>{t.label}</option>)}
          </select>
        </label>
      </div>
      <dl className="mt-4 space-y-1 rounded-xl bg-stone2 p-3 text-xs text-zinc-700">
        <div className="flex justify-between"><dt>Goes to your friend</dt><dd className="font-mono">{a !== null ? fmtQor(a) : '–'} QOR</dd></div>
        <div className="flex justify-between"><dt>Gas drip for their account</dt><dd className="font-mono">{d !== null ? fmtQor(d) : '–'} QOR</dd></div>
        <div className="flex justify-between"><dt>Relayer fee</dt><dd className="font-mono">{RELAYER_FEE} QOR</dd></div>
        <div className="flex justify-between border-t border-zinc-300 pt-1 font-medium"><dt>Locked in the contract</dt><dd className="font-mono" data-testid="total">{a !== null && d !== null ? fmtQor(a + d + fee) : '–'} QOR</dd></div>
      </dl>
      <p className="mt-2 text-xs text-zinc-500">Unclaimed money returns to you after the link expires, or any time before the recipient confirms. The drip is spent when they open the link.</p>
      {problem && <p className="mt-3 text-sm text-amber-800" data-testid="create-problem">{problem}</p>}
      {err && <div className="mt-3"><Notice tone="error" testId="create-error">{err}</Notice></div>}
      <div className="mt-4"><Button block busy={busy} disabled={!!problem} onClick={submit} data-testid="create-link">{busy ? 'Creating on-chain…' : 'Create link'}</Button></div>
      {txHash && <p className="mt-2 text-xs text-zinc-600">Created in <TxLink hash={txHash} testId="tx-create" /></p>}
    </Card>
  );
}

/* ------------------------------------------------------------------ share */

export function ShareCard({ link, headline }: { link: StoredLink; headline: string }) {
  const url = buildClaimUrl(window.location.origin, link.id, hexToBytes(link.seed));
  const msg = shareMessage(fmtQor(BigInt(link.amountWei)));
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
      <Card dark>
        <div className="flex items-center gap-2"><Share2 className="h-4 w-4" aria-hidden /><h2 className="font-serif text-2xl">{headline}</h2></div>
        <p className="mt-1 text-xs text-stone-300">Link #{link.id}. Treat it like cash: whoever opens it first becomes the recipient. The key is after the # and never reaches a server.</p>
        <div className="mt-3 break-all rounded-xl bg-black/30 p-3 font-mono text-[11px] leading-relaxed text-stone-100" data-testid="claim-link" data-url={url}>{url}</div>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <a href={whatsappUrl(msg, url)} target="_blank" rel="noopener noreferrer" data-testid="whatsapp"
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full bg-[#25D366] px-4 text-sm font-semibold text-zinc-950 transition active:scale-[0.98]">
            <MessageCircle className="h-4 w-4" aria-hidden /> Send on WhatsApp
          </a>
          {canShare && (
            <Button variant="secondary" data-testid="web-share" onClick={() => navigator.share({ title: 'Pocket Drop', text: msg, url }).catch(() => undefined)}>
              <Share2 className="h-4 w-4" /> Share…
            </Button>
          )}
          <CopyButton text={url} label="Copy link" testId="copy-link" className="min-h-[44px]" />
        </div>
      </Card>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ my links */

function TrackLink({ sender, onAdded }: { sender: SenderAccount; onAdded: () => void }) {
  const [id, setId] = useState('');
  const [err, setErr] = useState<string | null>(null);
  async function add() {
    setErr(null);
    try {
      if (!/^\d+$/.test(id.trim())) throw new Error('Enter the link number, like 12.');
      const l = await fetchLink(id.trim());
      if (l.sender.toLowerCase() !== sender.address.toLowerCase()) throw new Error('That link was not created by this account.');
      saveLink({ id: l.id, seed: '', mode: l.mode, amountWei: l.amount, createdAt: Date.now(), txHash: '' });
      setId(''); onAdded();
    } catch (e) { setErr((e as Error).message); }
  }
  return (
    <details className="mt-3 text-sm">
      <summary className="cursor-pointer text-zinc-600">Track a link made with this account elsewhere</summary>
      <div className="mt-2 flex gap-2">
        <input value={id} onChange={(e) => setId(e.target.value)} inputMode="numeric" placeholder="Link number" aria-label="Link number" data-testid="track-id" className="min-w-0 flex-1 rounded-xl border border-zinc-300 bg-white px-3 py-2 font-mono text-sm" />
        <Button variant="secondary" onClick={add} data-testid="track-add">Track</Button>
      </div>
      {err && <p className="mt-1 text-xs text-red-700">{err}</p>}
    </details>
  );
}

function MyLinks({ sender, links, onAdded }: { sender: SenderAccount; links: StoredLink[]; onAdded: () => void }) {
  return (
    <Card>
      <div className="flex items-center justify-between"><h2 className="font-serif text-2xl">Your links</h2><SourceBadge kind="LIVE" /></div>
      <ul className="mt-3 divide-y divide-zinc-200">
        {links.map((l) => <LinkRow key={l.id} sender={sender} stored={l} />)}
      </ul>
      {links.length === 0 && <p className="mt-2 text-sm text-zinc-500">No links yet.</p>}
      <TrackLink sender={sender} onAdded={onAdded} />
    </Card>
  );
}

const TERMINAL = ['Claimed', 'Cancelled', 'Refunded'];

function LinkRow({ sender, stored }: { sender: SenderAccount; stored: StoredLink }) {
  const { data: link, error } = useLink(stored.id, 3000);
  const [showShare, setShowShare] = useState(false);
  return (
    <li className="py-3" data-testid={`link-${stored.id}`} data-state={link?.state ?? 'loading'}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-medium">#{stored.id} · {fmtQor(BigInt(stored.amountWei))} QOR · {stored.mode === 'Open' ? 'Giveaway' : 'Confirmed'}</div>
        <span className={cx('rounded-full border px-2 py-0.5 font-mono text-[11px]', link && TERMINAL.includes(link.state) ? 'border-zinc-300 bg-stone2' : 'border-emerald-300 bg-emerald-50 text-emerald-900')} data-testid={`state-${stored.id}`}>{link?.state ?? (error ? 'unavailable' : '…')}</span>
      </div>
      {link && <LinkActions sender={sender} stored={stored} link={link} showShare={showShare} setShowShare={setShowShare} />}
    </li>
  );
}

function LinkActions({ sender, stored, link, showShare, setShowShare }: { sender: SenderAccount; stored: StoredLink; link: ApiLink; showShare: boolean; setShowShare: (v: boolean) => void }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ what: string; hash: string } | null>(null);
  const expired = Number(link.expiry) * 1000 < Date.now();

  async function run(what: string, fn: () => Promise<{ hash: string }>) {
    setBusy(what); setErr(null);
    try { const r = await fn(); setDone({ what, hash: r.hash }); await qc.invalidateQueries({ queryKey: ['link', stored.id] }); await qc.invalidateQueries({ queryKey: ['balance'] }); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  }

  const words = link.recipientKeyHash ? fingerprint(link.recipientKeyHash) : null;
  return (
    <div className="mt-2 space-y-2 text-sm">
      {link.state === 'Open' && (
        <>
          <p className="text-zinc-600">Waiting for someone to open the link.</p>
          <div className="flex flex-wrap gap-2">
            {stored.seed && <Button variant="secondary" onClick={() => setShowShare(!showShare)}>{showShare ? 'Hide link' : 'Show link'}</Button>}
            <Button variant="danger" busy={busy === 'cancel'} onClick={() => run('cancel', () => cancelLink(sender, stored.id))} data-testid={`cancel-${stored.id}`}>Cancel and refund</Button>
          </div>
          {showShare && <ShareCard link={stored} headline="Your link" />}
        </>
      )}
      {link.state === 'Bound' && link.mode === 'Confirmed' && words && (
        <div className="space-y-3" data-testid={`confirm-panel-${stored.id}`}>
          <Notice tone="warn"><strong>Someone opened your link.</strong> Ask them for the 4 words on their screen. Only confirm if they are exactly these:</Notice>
          <Fingerprint words={words} testId={`fp-${stored.id}`} />
          <div className="grid gap-2 sm:grid-cols-2">
            <Button busy={busy === 'confirm'} onClick={() => run('confirm', () => confirmRecipient(sender, stored.id, link.recipientKeyHash as Hex))} data-testid={`confirm-${stored.id}`}>The words match, confirm</Button>
            <Button variant="danger" busy={busy === 'cancel'} onClick={() => run('cancel', () => cancelLink(sender, stored.id))}>They differ, cancel link</Button>
          </div>
          <p className="text-xs text-zinc-500">Confirming sends a transaction from your account naming this exact recipient key. After that you cannot cancel.</p>
        </div>
      )}
      {link.state === 'Bound' && link.mode === 'Open' && <p className="text-zinc-600">Opened. The recipient is setting up their account and will claim by themselves.</p>}
      {link.state === 'Confirmed' && <p className="text-zinc-600">You confirmed the recipient. They can claim now.</p>}
      {link.state === 'Claimed' && link.recipient && (
        <p className="text-emerald-800" data-testid={`claimed-${stored.id}`}>Delivered {fmtQor(BigInt(link.amount))} QOR to <a className="underline" href={addrUrl(link.recipient)} target="_blank" rel="noopener noreferrer">{link.recipient.slice(0, 10)}…</a></p>
      )}
      {(link.state === 'Cancelled' || link.state === 'Refunded') && <p className="text-zinc-600">{link.state}. The money went back to you.</p>}
      {expired && !TERMINAL.includes(link.state) && (
        <div><p className="text-amber-800">This link expired unclaimed.</p><Button variant="secondary" busy={busy === 'refund'} onClick={() => run('refund', () => refundLink(sender, stored.id))}>Refund to my account</Button></div>
      )}
      {done && <p className="text-xs text-zinc-600">{done.what} sent: <TxLink hash={done.hash} testId={`tx-${done.what}-${stored.id}`} /></p>}
      {err && <Notice tone="error">{err}</Notice>}
    </div>
  );
}

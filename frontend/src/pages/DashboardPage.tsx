import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueries, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Eye, EyeOff, FlaskConical, Home, KeyRound, LayoutDashboard, Link2, Lock, MessageCircle, Plus, Radio, Share2, Users, Wallet } from 'lucide-react';
import { Button, Card, CopyButton, Fingerprint, Mono, Notice, SourceBadge, TxLink, cx } from '../components/ui';
import { Dash } from '../components/bits';
import { FAUCET_URL, LIMITS, addrUrl } from '../lib/config';
import { fmtQor, parseQor } from '../lib/chain';
import { useBalance, useHealth, useLink, useStats } from '../lib/queries';
import {
  cancelLink, confirmRecipient, createLink, createSender, exportSenderKey, forgetSender, importSender, loadLinks, loadSender, refundLink, saveLink,
  type SenderAccount, type StoredLink,
} from '../lib/sender';
import { buildClaimUrl, fingerprint, hexToBytes, shareMessage, whatsappUrl } from '../lib/protocol';
import { fetchLink, type ApiLink } from '../lib/api';
import { PHONE, WINDOW_MAX_BLOCKS } from '../data/proofs';
import type { Hex } from 'viem';

const RELAYER_FEE = '0.01';
const MIN_DRIP = '0.2';
const TTLS = [
  { label: '1 hour', s: 3600 },
  { label: '24 hours', s: 86_400 },
  { label: '7 days', s: 604_800 },
];
type Done = Record<string, { what: string; hash: string }>;

export default function DashboardPage() {
  const [sender, setSender] = useState<SenderAccount | null>(() => loadSender());
  const [links, setLinks] = useState<StoredLink[]>(() => loadLinks());
  const [fresh, setFresh] = useState<string | null>(null);
  const [done, setDone] = useState<Done>({});
  const { data: balance } = useBalance(sender?.address);
  const { data: win, refetch: refetchWin } = useQuery({
    queryKey: ['swin', sender?.address], enabled: !!sender, refetchInterval: 10_000,
    queryFn: async () => (await import('../lib/recipient')).senderWindow(hexToBytes(exportSenderKey()!)),
  });
  const needUqor = 700_000n; // room for one create (value is checked against the form in the builder)
  const active = !!win && win.live && win.remainingTxs > 0n && win.remainingValue > needUqor;
  const freshLink = fresh ? links.find((l) => l.id === fresh) : undefined;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8" data-testid="dashboard">
      <div className="grid gap-6 md:grid-cols-12">
        <aside className="hidden min-h-[680px] flex-col justify-between rounded-3xl border border-zinc-200 bg-white/90 p-4 lg:col-span-2 lg:flex">
          <div className="space-y-1">
            <div className="mb-3 px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-zinc-400">Workspace</div>
            {[[Home, 'Overview', '/'], [LayoutDashboard, 'Dashboard', '/dashboard'], [Link2, 'Claim Link', '/claim'], [FlaskConical, '/lab', '/lab'], [Radio, '/radar', '/radar'], [Users, '/judges', '/judges']].map(([I, label, to]) => {
              const Icon = I as typeof Home;
              return (
                <Link key={to as string} to={to as string} className={cx('flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-medium', to === '/dashboard' ? 'bg-stoneCard text-zinc-900' : 'text-zinc-600 hover:bg-stoneBg')}>
                  <Icon className="h-4 w-4" /> {label as string}
                </Link>
              );
            })}
          </div>
          <div className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-stoneBg px-3 py-2 font-mono text-[11px] text-zinc-600"><span className="h-2 w-2 rounded-full bg-emerald-500" /> Diana 9800</div>
        </aside>

        <div className="space-y-6 md:col-span-12 lg:col-span-10">
          <Header />
          <Kpis />

          <div className="grid gap-6 md:grid-cols-12">
            <div className="md:col-span-7">
              <Builder sender={sender} balance={balance} active={active} remainingUqor={win?.remainingValue}
                onCreated={(l) => { setLinks(loadLinks()); setFresh(l.id); }} fresh={freshLink} />
            </div>
            <div className="space-y-5 md:col-span-5">
              <ConfirmConsole sender={sender} links={links} done={done} setDone={setDone} />
              <WindowGauge />
            </div>
          </div>

          <SenderCard sender={sender} setSender={setSender} balance={balance} active={active} winKnown={win !== undefined} onActivated={() => void refetchWin()} />
          {sender && <MyLinks sender={sender} links={links} done={done} setDone={setDone} onAdded={() => setLinks(loadLinks())} />}
          <Ledger />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ header + KPIs (LIVE) */

function Header() {
  const { data: h } = useHealth();
  const ok = h?.window.live;
  return (
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
      <div>
        <h1 className="font-serif text-3xl text-zinc-900 sm:text-4xl">Drops &amp; Escrow Control</h1>
        <p className="mt-0.5 text-xs text-zinc-500">QoreChain Diana testnet · Zero-Wallet Onboarding</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-3.5 py-2 font-mono text-xs text-zinc-700" data-testid="relayer-pill" title="Relayer gas float, read from /api/health">
          <span className={cx('h-2 w-2 rounded-full', h ? (ok ? 'bg-emerald-500' : 'bg-red-500') : 'bg-zinc-300')} />
          <span>Relayer: {h?.relayer?.balance ? `${Number(h.relayer.balance).toFixed(2)} QOR` : '…'}</span>
          <SourceBadge kind="LIVE" />
        </div>
        <button type="button" onClick={() => document.getElementById('create-drop-panel')?.scrollIntoView({ behavior: 'smooth' })}
          className="inline-flex items-center gap-1.5 rounded-full bg-zinc-900 px-4 py-2 text-xs font-medium text-stone-100 hover:bg-zinc-800"><Plus className="h-3.5 w-3.5" /> New Drop</button>
      </div>
    </div>
  );
}

function Kpis() {
  const { data: s } = useStats();
  const claimed = s?.counts.claimed ?? 0, created = s?.counts.created ?? 0;
  const filled = created > 0 ? Math.round((claimed / created) * 4) : 0;
  const accounts = s ? s.addresses.own + s.addresses.external : undefined;
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <div className="rounded-2xl border border-zinc-200 bg-white/90 p-5 shadow-sm">
        <div className="mb-1 flex items-center justify-between text-xs text-zinc-500"><span>Escrow Volume</span><SourceBadge kind="LIVE" /></div>
        <div className="font-serif text-3xl text-zinc-900" data-testid="kpi-volume">{s ? `${s.volume.created} QOR` : <Dash />}</div>
        <div className="mt-1 text-[11px] text-zinc-500">locked in links, all time</div>
      </div>
      <div className="rounded-2xl border border-zinc-200 bg-white/90 p-5 shadow-sm">
        <div className="mb-1 flex items-center justify-between text-xs text-zinc-500"><span>Links Claimed</span><SourceBadge kind="LIVE" /></div>
        <div className="flex items-end justify-between">
          <div className="font-serif text-3xl text-zinc-900" data-testid="kpi-claimed">{s ? `${claimed} / ${created}` : <Dash />}</div>
          <div className="mb-1.5 flex gap-1" aria-hidden>{[0, 1, 2, 3].map((i) => <span key={i} className={cx('h-1.5 w-1.5 rounded-full', i < filled ? 'bg-zinc-900' : 'bg-zinc-300')} />)}</div>
        </div>
        <div className="mt-1 text-[11px] text-zinc-500">claimed / created</div>
      </div>
      <div className="rounded-2xl border border-zinc-200 bg-white/90 p-5 shadow-sm">
        <div className="mb-1 flex items-center justify-between text-xs text-zinc-500"><span>Accounts seen</span><SourceBadge kind="LIVE" /></div>
        <div className="font-serif text-3xl text-zinc-900" data-testid="kpi-accounts">{accounts ?? <Dash />}</div>
        <div className="mt-2 flex h-1.5 w-full overflow-hidden rounded-full bg-stoneCard" aria-hidden>
          {s && accounts! > 0 && <><div className="bg-zinc-700" style={{ width: `${(s.addresses.own / accounts!) * 100}%` }} /><div className="bg-emerald-600" style={{ width: `${(s.addresses.external / accounts!) * 100}%` }} /></>}
        </div>
        <div className="mt-1 text-[11px] text-zinc-500">{s ? `${s.addresses.own} own · ${s.addresses.external} other (addresses, not users)` : ''}</div>
      </div>
      <div className="rounded-2xl border border-zinc-200 bg-white/90 p-5 shadow-sm">
        <div className="mb-1 flex items-center justify-between text-xs text-zinc-500"><span>On-chain steps, real phones</span><SourceBadge kind="RECORDED" title={`Source: ${PHONE.source}. ${PHONE.note}`} /></div>
        <div className="font-serif text-3xl text-zinc-900" data-testid="kpi-phone">≈11–13 s</div>
        <div className="mt-1 text-[11px] text-zinc-500">Android Chrome · iPhone Safari {PHONE.iphoneLabel}</div>
      </div>
    </div>
  );
}

function WindowGauge() {
  const { data: h } = useHealth();
  const left = Number(h?.window.remainingBlocks ?? 0);
  const pct = h ? Math.max(0, Math.min(100, Math.round((left / WINDOW_MAX_BLOCKS) * 100))) : 0;
  return (
    <Card className="flex items-center gap-5" >
      <div className="relative flex h-16 w-16 shrink-0 items-center justify-center">
        <svg className="h-16 w-16 -rotate-90" viewBox="0 0 36 36" aria-hidden>
          <circle cx="18" cy="18" r="15.5" fill="none" stroke="#E4E4E7" strokeWidth="3" />
          <circle cx="18" cy="18" r="15.5" fill="none" stroke={h?.window.live ? '#18181B' : '#B91C1C'} strokeWidth="3" strokeDasharray={`${pct} 100`} pathLength={100} strokeLinecap="round" />
        </svg>
        <span className="absolute font-mono text-[11px] font-semibold text-zinc-900" data-testid="window-pct">{h ? `${pct}%` : '…'}</span>
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-2"><h3 className="font-serif text-xl text-zinc-900">Relayer Scoped Window</h3><SourceBadge kind="LIVE" /></div>
        <div className="mt-0.5 font-mono text-xs text-zinc-700">[PocketDrop] Only · ML-DSA key not on the server</div>
        <div className="mt-0.5 text-[11px] text-zinc-500" data-testid="window-status">
          {!h ? 'Reading…' : h.window.live ? `Status: live · ${left.toLocaleString()} of ${WINDOW_MAX_BLOCKS.toLocaleString()} blocks left · ${h.window.remainingTxs ?? '–'} txs left` : 'Status: expired. Claims and opens are paused until the renewer runs. Escrow is safe.'}
        </div>
        {h?.warning && <div className="mt-1 text-[11px] text-amber-800">{h.warning.message}</div>}
      </div>
    </Card>
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
        <div className="flex items-center gap-2"><Wallet className="h-5 w-5 text-zinc-500" aria-hidden /><h2 className="font-serif text-2xl text-zinc-900">Your sender account</h2></div>
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
          <div className="flex items-center gap-2"><Wallet className="h-5 w-5 text-zinc-500" aria-hidden /><h2 className="font-serif text-2xl text-zinc-900">Your sender account</h2></div>
          <p className="mt-1 text-xs text-zinc-500">Created in this browser. Not a custodial account.</p>
        </div>
        <SourceBadge kind="LIVE" />
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,15rem)_1fr]">
        <div className="rounded-2xl border border-zinc-200 bg-stoneBg p-4">
          <div className="text-xs text-zinc-500">Balance</div>
          <div className="font-serif text-4xl leading-tight" data-testid="sender-balance" data-wei={balance?.toString() ?? ''}>{balance === undefined ? '…' : fmtQor(balance)} <span className="text-lg text-zinc-500">QOR</span></div>
        </div>
        <dl className="space-y-2 text-xs">
          <div><dt className="text-zinc-500">EVM address (for QoreX or any EVM send)</dt><dd className="mt-0.5 flex flex-wrap items-center gap-2"><Mono className="min-w-0"><span data-testid="sender-evm">{sender.address}</span></Mono><CopyButton text={sender.address} testId="copy-evm" /></dd></div>
          <div><dt className="text-zinc-500">QoreChain address (for the official faucet)</dt><dd className="mt-0.5 flex flex-wrap items-center gap-2"><Mono><span data-testid="sender-cosmos">{sender.cosmos}</span></Mono><CopyButton text={sender.cosmos} /></dd></div>
        </dl>
      </div>
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

/* ------------------------------------------------------------------ builder */

function Builder({ sender, balance, active, remainingUqor, onCreated, fresh }: { sender: SenderAccount | null; balance?: bigint; active: boolean; remainingUqor?: bigint; onCreated: (l: StoredLink) => void; fresh?: StoredLink }) {
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
    if (!sender) return 'Create your sender account below first (one tap), then fund and activate it.';
    if (balance === undefined) return 'Reading your balance…';
    if (!active) return 'Activate your account first (see the sender account panel below).';
    if (remainingUqor !== undefined && remainingUqor * 10n ** 12n < a + d + fee + 10_000_000_000_000_000n) return 'Your authorisation window is too small for this amount. Activate the account again to refresh it.';
    if (balance < a + d + fee + 20_000_000_000_000_000n) return 'Balance too low for this amount plus fees. Fund the account first.';
    return null;
  }, [a, d, fee, balance, active, remainingUqor, sender]);

  async function submit() {
    if (problem || a === null || d === null || !sender) return;
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
    <Card id="create-drop-panel">
      <h2 className="mb-4 font-serif text-2xl text-zinc-900">Drop Builder</h2>
      <div className="grid items-center gap-5 sm:grid-cols-12">
        <div className="space-y-4 sm:col-span-6">
          <div className="grid grid-cols-2 gap-1 rounded-xl border border-zinc-200 bg-stoneBg p-1" role="radiogroup" aria-label="Mode">
            {([['Confirmed', 'Confirmed'], ['Open', 'Giveaway']] as const).map(([m, t]) => (
              <button key={m} type="button" role="radio" aria-checked={mode === m} data-testid={`mode-${m}`} onClick={() => setMode(m)}
                className={cx('rounded-lg px-3 py-1.5 text-xs font-medium', mode === m ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-600')}>{t}</button>
            ))}
          </div>
          <p className="-mt-2 text-[11px] leading-snug text-zinc-500">{mode === 'Confirmed' ? 'You check 4 words before money moves. Safest.' : 'First person to open it gets it. No check.'}</p>
          <div>
            <div className="mb-1 flex items-center justify-between text-xs"><span className="text-zinc-600">Amount (QOR)</span>
              <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="amount" aria-label="Amount in QOR" className="w-20 rounded-lg border border-zinc-300 bg-white px-2 py-1 text-right font-mono text-xs font-semibold text-zinc-900" /></div>
            <input type="range" min={LIMITS.minEscrowQor} max={LIMITS.maxAmountQor} step="0.1" value={Number(amount) || LIMITS.minEscrowQor} onChange={(e) => setAmount(e.target.value)} aria-label="Amount slider" className="w-full" />
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between text-xs"><span className="text-zinc-600">Gas Drip (QOR)</span>
              <input inputMode="decimal" value={drip} onChange={(e) => setDrip(e.target.value)} data-testid="drip" aria-label="Gas drip in QOR" className="w-20 rounded-lg border border-zinc-300 bg-white px-2 py-1 text-right font-mono text-xs font-semibold text-zinc-900" /></div>
            <input type="range" min={MIN_DRIP} max={LIMITS.maxDripQor} step="0.05" value={Number(drip) || Number(MIN_DRIP)} onChange={(e) => setDrip(e.target.value)} aria-label="Gas drip slider" className="w-full" />
          </div>
          <label className="block text-xs text-zinc-600">Link valid for
            <select value={ttl} onChange={(e) => setTtl(Number(e.target.value))} className="mt-1 w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm">
              {TTLS.map((t) => <option key={t.s} value={t.s}>{t.label}</option>)}
            </select>
          </label>
          <button type="button" disabled={!!problem || busy} onClick={submit} data-testid="create-link"
            className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-emerald-600 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50">
            <MessageCircle className="h-4 w-4" /><span>{busy ? 'Creating on-chain…' : 'Create link'}</span>
          </button>
        </div>

        <div className="sm:col-span-6">
          <div className="capsule-bezel">
            <div className="rounded-[19px] capsule-obsidian p-5 text-stone-100">
              <div className="mb-3 flex items-center justify-between">
                <span className="font-mono text-[10px] tracking-widest text-zinc-300">POCKET DROP</span>
                <span className="rounded-full bg-emerald-500 px-2 py-0.5 text-[9.5px] font-semibold text-zinc-950" data-testid="preview-mode">{mode === 'Open' ? 'Giveaway' : 'Confirmed'}</span>
              </div>
              <div className="my-2 text-center font-serif text-3xl text-white" data-testid="preview-amount">{a !== null ? fmtQor(a) : '–'} QOR</div>
              <div className="mb-2 rounded-lg bg-white/10 px-2 py-1 text-center font-mono text-[9.5px] uppercase tracking-widest text-stone-200">{mode === 'Confirmed' ? '4 words appear when they open it' : 'no word check · first open wins'}</div>
              <div className="text-center font-mono text-[9.5px] text-zinc-400" data-testid="total">Deposit: {a !== null && d !== null ? fmtQor(a + d + fee) : '–'} QOR</div>
              <div className="mt-1 text-center font-mono text-[9px] text-zinc-500">amount + {d !== null ? fmtQor(d) : '–'} drip + {RELAYER_FEE} relayer fee</div>
            </div>
          </div>
        </div>
      </div>
      <p className="mt-3 text-xs text-zinc-500">Unclaimed money returns to you after the link expires, or any time before the recipient confirms. The drip is spent when they open the link.</p>
      {problem && <p className="mt-3 text-sm text-amber-800" data-testid="create-problem">{problem}</p>}
      {err && <div className="mt-3"><Notice tone="error" testId="create-error">{err}</Notice></div>}
      {txHash && <p className="mt-2 text-xs text-zinc-600">Created in <TxLink hash={txHash} testId="tx-create" /></p>}
      {fresh && <div className="mt-5"><ShareCard link={fresh} headline="Drop Capsule Ready" /></div>}
    </Card>
  );
}

/* ------------------------------------------------------------------ share */

export function ShareCard({ link, headline }: { link: StoredLink; headline: string }) {
  const url = buildClaimUrl(window.location.origin, link.id, hexToBytes(link.seed));
  const msg = shareMessage(fmtQor(BigInt(link.amountWei)));
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-2.5 rounded-2xl border border-zinc-300 bg-stoneBg p-4" data-testid="share-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-zinc-900"><Share2 className="h-3.5 w-3.5" aria-hidden />{headline}</span>
        <div className="flex flex-wrap gap-2">
          <a href={whatsappUrl(msg, url)} target="_blank" rel="noopener noreferrer" data-testid="whatsapp"
            className="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-3 py-1.5 text-[11px] font-medium text-white"><MessageCircle className="h-3.5 w-3.5" aria-hidden />Send on WhatsApp ↗</a>
          {canShare && <button type="button" data-testid="web-share" onClick={() => navigator.share({ title: 'Pocket Drop', text: msg, url }).catch(() => undefined)} className="rounded-full border border-zinc-300 bg-white px-3 py-1.5 text-[11px] font-medium text-zinc-900">Share in any app…</button>}
          <CopyButton text={url} label="Copy link" testId="copy-link" className="!min-h-0 !px-3 !py-1.5 !text-[11px]" />
        </div>
      </div>
      <div className="break-all rounded-xl border border-zinc-200 bg-white p-2.5 font-mono text-xs text-zinc-800" data-testid="claim-link" data-url={url}>{url}</div>
      <p className="text-[11px] text-zinc-600">Link #{link.id}. Treat it like cash: whoever opens it first becomes the recipient. The key is after the # and never reaches a server. Works in any chat app (WhatsApp, Telegram, SMS, email).</p>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ 4-word console */

function ConfirmConsole({ sender, links, done, setDone }: { sender: SenderAccount | null; links: StoredLink[]; done: Done; setDone: (f: (d: Done) => Done) => void }) {
  const qc = useQueryClient();
  const results = useQueries({ queries: links.map((l) => ({ queryKey: ['link', l.id], queryFn: () => fetchLink(l.id), refetchInterval: 3000 })) });
  const idx = results.findIndex((r) => r.data?.state === 'Bound' && r.data.mode === 'Confirmed' && r.data.recipientKeyHash);
  const link = idx >= 0 ? results[idx].data! : null;
  const id = idx >= 0 ? links[idx].id : null;
  const words = link?.recipientKeyHash ? fingerprint(link.recipientKeyHash) : null;
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const recent = Object.entries(done).filter(([, v]) => v.what === 'confirm' || v.what === 'cancel').slice(-1)[0];

  async function run(what: 'confirm' | 'cancel') {
    if (!sender || !id || !link) return;
    setBusy(what); setErr(null);
    try {
      const r = what === 'confirm' ? await confirmRecipient(sender, id, link.recipientKeyHash as Hex) : await cancelLink(sender, id);
      setDone((d) => ({ ...d, [id]: { what, hash: r.hash } }));
      await qc.invalidateQueries({ queryKey: ['link', id] }); await qc.invalidateQueries({ queryKey: ['balance'] });
    } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  }

  return (
    <Card data-testid="confirm-console">
      <h3 className="mb-4 font-serif text-xl text-zinc-900">4-Word Confirmation Console</h3>
      {words && id ? (
        <div className="space-y-3" data-testid={`confirm-panel-${id}`}>
          <Notice tone="warn"><strong>Someone opened link #{id}.</strong> Ask them for the 4 words on their screen. Only confirm if they are exactly these:</Notice>
          <Fingerprint words={words} testId={`fp-${id}`} />
          <div className="flex gap-2">
            <button type="button" disabled={!!busy} onClick={() => void run('confirm')} data-testid={`confirm-${id}`}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-zinc-300 bg-stoneBg py-2.5 text-xs font-semibold text-zinc-900 hover:bg-white disabled:opacity-50"><Lock className="h-3.5 w-3.5" />{busy === 'confirm' ? 'Confirming…' : 'The words match, confirm on-chain'}</button>
            <button type="button" disabled={!!busy} onClick={() => void run('cancel')} data-testid={`cancel-bound-${id}`} className="rounded-xl border border-zinc-200 px-3.5 py-2.5 text-xs text-zinc-600 hover:bg-stoneBg disabled:opacity-50">{busy === 'cancel' ? '…' : 'They differ, cancel'}</button>
          </div>
          <p className="text-[11px] text-zinc-500">Confirming sends a transaction from your account naming this exact recipient key. After that you cannot cancel.</p>
        </div>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-4 gap-2" aria-hidden>
            {[0, 1, 2, 3].map((i) => <div key={i} className="word-tile rounded-xl py-2.5 text-center font-mono text-xs font-semibold text-zinc-400">· · ·</div>)}
          </div>
          <p className="text-xs leading-relaxed text-zinc-600" data-testid="console-idle">{sender ? 'No drop is waiting for you. When a friend opens a Confirmed link, their 4 words appear here for you to compare.' : 'Create a sender account to send Confirmed drops. The 4 words your friend reads out appear here.'}</p>
        </>
      )}
      {err && <div className="mt-3"><Notice tone="error">{err}</Notice></div>}
      {recent && <p className="mt-3 font-mono text-[11px] text-emerald-700" data-testid="confirm-status-msg">✓ {recent[1].what === 'confirm' ? `confirmRecipient(${recent[0]})` : `cancel(${recent[0]})`} mined: <TxLink hash={recent[1].hash} testId={`tx-${recent[1].what}-${recent[0]}`} /></p>}
    </Card>
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

function MyLinks({ sender, links, done, setDone, onAdded }: { sender: SenderAccount; links: StoredLink[]; done: Done; setDone: (f: (d: Done) => Done) => void; onAdded: () => void }) {
  return (
    <Card>
      <div className="flex items-center justify-between"><h2 className="font-serif text-2xl text-zinc-900">Your drops</h2><SourceBadge kind="LIVE" /></div>
      <ul className="mt-3 divide-y divide-zinc-200">
        {links.map((l) => <LinkRow key={l.id} sender={sender} stored={l} done={done} setDone={setDone} />)}
      </ul>
      {links.length === 0 && <p className="mt-2 text-sm text-zinc-500">No drops yet.</p>}
      <TrackLink sender={sender} onAdded={onAdded} />
    </Card>
  );
}

const TERMINAL = ['Claimed', 'Cancelled', 'Refunded'];

function LinkRow({ sender, stored, done, setDone }: { sender: SenderAccount; stored: StoredLink; done: Done; setDone: (f: (d: Done) => Done) => void }) {
  const { data: link, error } = useLink(stored.id, 3000);
  const [showShare, setShowShare] = useState(false);
  return (
    <li className="py-3" data-testid={`link-${stored.id}`} data-state={link?.state ?? 'loading'}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-medium">#{stored.id} · {fmtQor(BigInt(stored.amountWei))} QOR · {stored.mode === 'Open' ? 'Giveaway' : 'Confirmed'}</div>
        <span className={cx('rounded-full border px-2 py-0.5 font-mono text-[11px]', link && TERMINAL.includes(link.state) ? 'border-zinc-300 bg-stoneCard' : 'border-emerald-300 bg-emerald-50 text-emerald-900')} data-testid={`state-${stored.id}`}>{link?.state ?? (error ? 'unavailable' : '…')}</span>
      </div>
      {link && <LinkActions sender={sender} stored={stored} link={link} showShare={showShare} setShowShare={setShowShare} done={done} setDone={setDone} />}
    </li>
  );
}

function LinkActions({ sender, stored, link, showShare, setShowShare, done, setDone }: { sender: SenderAccount; stored: StoredLink; link: ApiLink; showShare: boolean; setShowShare: (v: boolean) => void; done: Done; setDone: (f: (d: Done) => Done) => void }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const expired = Number(link.expiry) * 1000 < Date.now();
  const mine = done[stored.id];

  async function run(what: string, fn: () => Promise<{ hash: string }>) {
    setBusy(what); setErr(null);
    try { const r = await fn(); setDone((d) => ({ ...d, [stored.id]: { what, hash: r.hash } })); await qc.invalidateQueries({ queryKey: ['link', stored.id] }); await qc.invalidateQueries({ queryKey: ['balance'] }); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  }

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
      {link.state === 'Bound' && link.mode === 'Confirmed' && <p className="text-zinc-600">Opened. Compare the 4 words in the confirmation console.</p>}
      {link.state === 'Bound' && link.mode === 'Open' && <p className="text-zinc-600">Opened. The recipient is setting up their account and will claim by themselves.</p>}
      {link.state === 'Confirmed' && <p className="text-zinc-600">You confirmed the recipient. They can claim now.</p>}
      {link.state === 'Claimed' && link.recipient && (
        <p className="text-emerald-800" data-testid={`claimed-${stored.id}`}>Delivered {fmtQor(BigInt(link.amount))} QOR to <a className="underline" href={addrUrl(link.recipient)} target="_blank" rel="noopener noreferrer">{link.recipient.slice(0, 10)}…</a></p>
      )}
      {(link.state === 'Cancelled' || link.state === 'Refunded') && <p className="text-zinc-600">{link.state}. The money went back to you.</p>}
      {expired && !TERMINAL.includes(link.state) && (
        <div><p className="text-amber-800">This link expired unclaimed.</p><Button variant="secondary" busy={busy === 'refund'} onClick={() => run('refund', () => refundLink(sender, stored.id))}>Refund to my account</Button></div>
      )}
      {mine && !(mine.what === 'confirm' || (mine.what === 'cancel' && link.state === 'Bound')) && <p className="text-xs text-zinc-600">{mine.what} sent: <TxLink hash={mine.hash} testId={`tx-${mine.what}-${stored.id}-row`} /></p>}
      {err && <Notice tone="error">{err}</Notice>}
    </div>
  );
}

/* ------------------------------------------------------------------ ledger (LIVE events) */

function Ledger() {
  const { data: s } = useStats();
  const [filter, setFilter] = useState<'all' | 'Confirmed' | 'Open'>('all');
  const [inspectId, setInspectId] = useState('1');
  const [inspect, setInspect] = useState<string | null>(null);
  const rows = (s?.recent ?? []).slice(0, 14);
  const ids = [...new Set(rows.map((r) => r.linkId).filter((x): x is string => !!x))];
  const modes = useQueries({ queries: ids.map((i) => ({ queryKey: ['link', i], queryFn: () => fetchLink(i), staleTime: 60_000 })) });
  const modeOf = (id: string | null) => (id ? modes[ids.indexOf(id)]?.data?.mode : undefined);
  const shown = rows.filter((r) => filter === 'all' || modeOf(r.linkId) === filter);

  async function doInspect() {
    setInspect(`Querying /api/link/${inspectId}…`);
    try { setInspect(JSON.stringify((await fetchLink(inspectId)), null, 2)); } catch (e) { setInspect((e as Error).message); }
  }

  return (
    <Card>
      <div className="mb-5 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <h2 className="flex items-center gap-2 font-serif text-2xl text-zinc-900">Verified Diana Ledger <SourceBadge kind="LIVE" title="Contract events indexed by /api/stats, refreshed every 30 s" /></h2>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1 rounded-full border border-zinc-200 bg-stoneBg p-1 text-xs">
            {([['all', 'All Drops'], ['Confirmed', 'Confirmed'], ['Open', 'Giveaway']] as const).map(([f, l]) => (
              <button key={f} type="button" onClick={() => setFilter(f)} className={cx('rounded-full px-2.5 py-1 font-medium', filter === f ? 'bg-zinc-900 text-white' : 'text-zinc-600')}>{l}</button>
            ))}
          </div>
          <input value={inspectId} onChange={(e) => setInspectId(e.target.value)} type="number" min={1} aria-label="Link number to inspect" className="w-16 rounded-full border border-zinc-300 px-2.5 py-1 font-mono text-xs" />
          <button type="button" onClick={() => void doInspect()} className="rounded-full bg-zinc-900 px-3.5 py-1 text-xs font-medium text-white">Inspect</button>
        </div>
      </div>
      {inspect && <pre className="mb-4 overflow-x-auto rounded-2xl border border-zinc-200 bg-stoneBg p-4 font-mono text-xs" data-testid="inspect-result">{inspect}</pre>}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead><tr className="border-b border-zinc-200 font-mono text-[11px] uppercase text-zinc-500"><th className="py-3 pr-4">Step / Drop</th><th className="py-3 pr-4">Mode</th><th className="py-3 pr-4">Status</th><th className="py-3 pr-4">Outcome</th><th className="py-3 text-right">Explorer</th></tr></thead>
          <tbody className="divide-y divide-zinc-100" data-testid="ledger-rows">
            {!s && <tr><td className="py-3 text-zinc-500" colSpan={5}>Loading events…</td></tr>}
            {shown.map((r, i) => (
              <tr key={i} className="transition-colors hover:bg-stoneBg/60">
                <td className="py-3 pr-4 font-medium text-zinc-900">{r.name.replace(/^Link/, '')}{r.linkId && <span className="ml-1.5 text-zinc-500">link #{r.linkId}</span>}</td>
                <td className="py-3 pr-4"><span className="rounded-full bg-stoneCard px-2 py-0.5 font-mono text-[11px] text-zinc-700">{modeOf(r.linkId) ?? '–'}</span></td>
                <td className="py-3 pr-4"><span className="inline-flex items-center gap-1 font-medium text-emerald-700"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />success</span></td>
                <td className="py-3 pr-4 font-mono text-zinc-600">{r.amount ? `${fmtQor(BigInt(r.amount))} QOR` : r.kind}</td>
                <td className="py-3 text-right"><TxLink hash={r.txHash} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[11px] text-zinc-500">Events are emitted only by transactions that succeeded. The reverted attack transactions are on <Link className="underline" to="/lab">/lab</Link>.</p>
    </Card>
  );
}

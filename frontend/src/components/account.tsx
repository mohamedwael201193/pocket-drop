import { useState } from 'react';
import { Check, Eye, EyeOff, KeyRound, Link2, Wallet, X } from 'lucide-react';
import { Button, CopyButton, Mono, Notice, Pill, SourceBadge, TxLink } from './ui';
import { useAccount, usePocket, useQorexBalance } from '../lib/account';
import { exportSenderKey } from '../lib/sender';
import { fundFromQorex } from '../lib/qorex';
import { fmtQor } from '../lib/chain';
import { FAUCET_URL, addrUrl } from '../lib/config';
import { hexToBytes } from '../lib/protocol';

/** Step "account": the two ways in. QoreX is the primary identity; the browser key is the working fallback. */
export function ConnectChoices() {
  const a = useAccount();
  const [restore, setRestore] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const connecting = a.qorexState === 'connecting';
  return (
    <div className="space-y-4" data-testid="connect-choices">
      {a.identity ? (
        <div className="space-y-3">
          <Notice tone="ok" testId="qorex-connected">Connected as QoreX <Mono>{a.identity.cosmos}</Mono></Notice>
          {a.canLinkExisting && (
            <Button block onClick={a.linkExisting} data-testid="link-existing"><Link2 className="h-4 w-4" aria-hidden />Link the account already in this browser to QoreX</Button>
          )}
          <Button block variant={a.canLinkExisting ? 'secondary' : 'primary'} onClick={a.createBrowser} data-testid="create-sender">Create my Pocket in this browser</Button>
          <p className="text-xs leading-relaxed text-zinc-600">QoreX cannot sign Pocket Drop's contract transactions yet, so the Pocket's signing key lives in this browser, filed under your QoreX identity. QoreX tops it up and proves who you are.</p>
        </div>
      ) : (
        <>
          <Button block onClick={a.createBrowser} data-testid="create-sender">Use this browser</Button>
          <p className="text-xs text-zinc-600">Creates a quantum-safe-ready account that stays on this device. Nothing to install. Back it up in the Pocket tab so you can open it on another device.</p>
          {(a.qorexState === 'ready' || a.qorexState === 'connecting') && (
            <div className="rounded-2xl border border-zinc-200 bg-stoneBg p-4">
              <Button block variant="secondary" onClick={() => void a.connect()} busy={connecting} data-testid="connect-qorex"><Wallet className="h-4 w-4" aria-hidden />{connecting ? 'Waiting for QoreX�' : 'Connect QoreX (optional)'}</Button>
              <p className="mt-2 text-xs text-zinc-600">QoreX was found. Connecting shows your QoreX identity and lets you top up your Pocket with a QoreX send. Not required.</p>
              {a.qorexError && <div className="mt-2"><Notice tone="warn" testId="qorex-error">{a.qorexError}</Notice></div>}
            </div>
          )}
        </>
      )}
      <div className="rounded-2xl border border-zinc-200 bg-stoneBg p-4">
        <label htmlFor="restore-key" className="text-sm font-semibold text-zinc-900">Already have an account? Restore it</label>
        <p className="mt-0.5 text-xs text-zinc-600">Paste the backup key from your other device. Your drops and their live state reappear.</p>
        <div className="mt-2 flex gap-2">
          <input id="restore-key" value={restore} onChange={(e) => setRestore(e.target.value)} placeholder="0x… 64 hex characters" data-testid="restore-input" className="min-w-0 flex-1 rounded-xl border border-zinc-300 bg-white px-3 py-2 font-mono text-xs" />
          <Button variant="secondary" data-testid="restore-btn" onClick={() => { try { a.restore(restore); setErr(null); setRestore(''); } catch (e) { setErr((e as Error).message); } }}>Restore</Button>
        </div>
        {err && <p className="mt-1 text-xs text-red-700">{err}</p>}
      </div>
    </div>
  );
}

/** Balance, funding and one-time activation of the Pocket signing account. */
export function PocketStatus({ compact }: { compact?: boolean }) {
  const a = useAccount();
  const p = usePocket();
  const { data: qBal } = useQorexBalance();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [txs, setTxs] = useState<string[]>([]);
  const [topup, setTopup] = useState('1');
  const [fundTx, setFundTx] = useState<string | null>(null);
  const s = a.sender;
  if (!s) return null;

  async function activate() {
    setBusy('Starting'); setErr(null);
    try {
      const m = await import('../lib/recipient');
      const r = await m.activateSender(hexToBytes(exportSenderKey()!), p.balance ?? 0n, setBusy);
      setTxs([r.register, r.window].filter(Boolean) as string[]);
      p.refetchWin();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  }
  async function fund() {
    if (!a.identity) return;
    setBusy('Waiting for QoreX'); setErr(null);
    try {
      const uqor = BigInt(Math.round(Number(topup) * 1e6));
      if (uqor <= 0n) throw new Error('Enter an amount like 1.');
      const r = await fundFromQorex(a.identity, s!.cosmos, uqor);
      setFundTx(r.txHash);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  }

  return (
    <div className="space-y-4" data-testid="pocket-status">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="mb-1 flex items-center gap-2 text-xs text-zinc-500">Pocket balance <SourceBadge kind="LIVE" /></div>
          <div className="font-serif text-4xl leading-none text-zinc-900" data-testid="sender-balance" data-wei={p.balance?.toString() ?? ''}>{p.balance === undefined ? '…' : fmtQor(p.balance)} <span className="text-lg text-zinc-500">QOR</span></div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Pill tone={p.funded ? 'ok' : 'warn'}>{p.funded ? <Check className="h-3 w-3" aria-hidden /> : <X className="h-3 w-3" aria-hidden />}Funded</Pill>
          <Pill tone={p.active ? 'ok' : 'warn'} testId={p.active ? 'sender-active' : 'sender-inactive'}>{p.active ? <Check className="h-3 w-3" aria-hidden /> : <X className="h-3 w-3" aria-hidden />}Active</Pill>
        </div>
      </div>

      {!compact && (
        <dl className="space-y-2 text-xs">
          <div><dt className="text-zinc-500">EVM address (any EVM send)</dt><dd className="mt-0.5 flex flex-wrap items-center gap-2"><Mono className="min-w-0"><span data-testid="sender-evm">{s.address}</span></Mono><CopyButton text={s.address} testId="copy-evm" /></dd></div>
          <div><dt className="text-zinc-500">QoreChain address (faucet, QoreX send)</dt><dd className="mt-0.5 flex flex-wrap items-center gap-2"><Mono><span data-testid="sender-cosmos">{s.cosmos}</span></Mono><CopyButton text={s.cosmos} /></dd></div>
        </dl>
      )}
      {compact && <span className="sr-only" data-testid="sender-evm">{s.address}</span>}

      {!p.funded && (
        <Notice tone="warn" testId="fund-help">
          <strong>Add QOR to your Pocket.</strong> {a.identity?.canFund ? 'Send some from QoreX below, or paste ' : 'Paste '}
          <button type="button" className="underline" onClick={() => void navigator.clipboard?.writeText(s.cosmos)}>this address</button> into the <a className="underline" href={FAUCET_URL} target="_blank" rel="noopener noreferrer">official faucet</a>. This page updates by itself when the QOR lands.
        </Notice>
      )}

      {a.identity?.canFund && (
        <div className="rounded-2xl border border-zinc-200 bg-stoneBg p-4" data-testid="qorex-fund">
          <div className="flex items-center justify-between text-sm"><span className="font-semibold text-zinc-900">Top up from QoreX</span><span className="font-mono text-xs text-zinc-600">QoreX balance {qBal === undefined ? '…' : `${fmtQor(qBal)} QOR`}</span></div>
          <div className="mt-2 flex gap-2">
            <input value={topup} onChange={(e) => setTopup(e.target.value)} inputMode="decimal" aria-label="QOR to send from QoreX" data-testid="topup-amount" className="w-24 rounded-xl border border-zinc-300 bg-white px-3 py-2 text-right font-mono text-sm" />
            <Button onClick={fund} busy={busy === 'Waiting for QoreX'} data-testid="topup-btn" className="flex-1">Send {topup || '…'} QOR from QoreX</Button>
          </div>
          <p className="mt-2 text-xs text-zinc-600">A normal QoreX send. You approve it inside QoreX. {fundTx && <>Sent: <TxLink hash={fundTx} testId="tx-topup" /></>}</p>
        </div>
      )}

      {p.funded && p.winKnown && !p.active && (
        <div className="space-y-2" data-testid="activate-panel">
          <Notice tone="info"><strong>One-time activation.</strong> QoreChain needs a registered quantum-safe key and an open authorisation window before an account can send. This registers your key and opens a window limited to Pocket Drop. About 0.16 QOR in fees.</Notice>
          <Button block busy={!!busy && busy !== 'Waiting for QoreX'} onClick={activate} data-testid="activate-sender">{busy && busy !== 'Waiting for QoreX' ? busy : 'Activate account'}</Button>
        </div>
      )}
      {p.active && txs.length > 0 && <p className="text-xs text-emerald-800">Activated: {txs.map((h, i) => <TxLink key={h} hash={h} testId={`tx-activate-${i}`} />)}</p>}
      {err && <Notice tone="error" testId="activate-error">{err}</Notice>}
      {!compact && <p className="text-xs text-zinc-500"><a className="underline" href={addrUrl(s.address)} target="_blank" rel="noopener noreferrer">View on explorer</a></p>}
    </div>
  );
}

/** Backup, device transfer and forget. Prominent on purpose: the key is the account. */
export function BackupPanel() {
  const a = useAccount();
  const [show, setShow] = useState(false);
  const [confirmForget, setConfirmForget] = useState(false);
  if (!a.sender) return null;
  const key = exportSenderKey() ?? '';
  const transfer = `${window.location.origin}/pocket#restore=${key.replace(/^0x/, '')}`;
  return (
    <div className="space-y-4" data-testid="backup-panel">
      <Notice tone="warn"><strong>This browser holds the key to your Pocket.</strong> Clearing site data without a backup loses the account and anything in it.</Notice>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setShow((v) => !v)} data-testid="show-backup">{show ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}{show ? 'Hide backup key' : 'Back up my key'}</Button>
        <CopyButton text={transfer} label="Copy device-transfer link" testId="copy-transfer" />
      </div>
      {show && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
          <div className="mb-1 flex items-center gap-1 font-medium"><KeyRound className="h-4 w-4" aria-hidden />Anyone with this key controls the account.</div>
          <Mono>{key}</Mono>
          <div className="mt-2"><CopyButton text={key} label="Copy backup key" /></div>
        </div>
      )}
      <p className="text-xs leading-relaxed text-zinc-600">To use this account on your phone: copy the device-transfer link, send it to yourself privately, open it on the phone. The key sits after the # and never reaches a server. Treat it like cash.</p>
      {confirmForget ? (
        <Notice tone="error">This removes the key from this browser. Any QOR left in the account is lost unless you backed up the key.
          <div className="mt-2 flex gap-2"><Button variant="danger" onClick={() => { a.forget(); setConfirmForget(false); }}>Forget account</Button><Button variant="ghost" onClick={() => setConfirmForget(false)}>Keep it</Button></div></Notice>
      ) : <Button variant="ghost" onClick={() => setConfirmForget(true)}>Forget this account</Button>}
    </div>
  );
}

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Eye, EyeOff, KeyRound, Wallet } from 'lucide-react';
import QRCode from 'qrcode';
import { Button, CopyButton, Mono, Notice, Pill, Skel, SourceBadge, TxLink } from './ui';
import { useAccount, useKeyAccount, usePocketView, useQorexBalance } from '../lib/account';
import { fundFromQorex } from '../lib/qorex';
import { fmtQor, cosmosAddressOf } from '../lib/chain';
import { FAUCET_URL, addrUrl } from '../lib/config';
import { REGISTRATION_FEE_WEI } from '../lib/v4';
import { loadRoot } from '../lib/identity';
import { explainError } from '../lib/api';
import type { Hex } from 'viem';

/** Step "key": the browser key path (the only signing path while QoreX is mainnet-only). */
export function ConnectChoices() {
  const a = useAccount();
  // never offer "Use this browser" over a key this browser already holds (for example one a claim page just created): adopt it (B-01)
  const { ensureKey } = a;
  useEffect(() => { if (loadRoot()) ensureKey(); }, [ensureKey]);
  const [restore, setRestore] = useState('');
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="space-y-4" data-testid="connect-choices">
      <Button block onClick={a.createKey} data-testid="create-key"><KeyRound className="h-4 w-4" aria-hidden />Use this browser</Button>
      <p className="text-xs leading-relaxed text-zinc-600">A quantum-safe key is created inside this tab and stays here. It owns your Pocket. Back it up on the Pocket page; guardians can recover it for you.</p>
      <details className="rounded-2xl border border-zinc-200 bg-white/70 p-4">
        <summary className="cursor-pointer text-sm font-medium text-zinc-900">Restore from a backup key</summary>
        <label htmlFor="restore-input" className="mt-3 block text-xs font-medium text-zinc-700">Backup key (64 characters)</label>
        <div className="mt-1 flex gap-2">
          <input id="restore-input" value={restore} onChange={(e) => { setRestore(e.target.value); setErr(null); }} placeholder="64-character backup key" autoComplete="off" spellCheck={false} data-testid="restore-input" className="min-w-0 flex-1 rounded-xl border border-zinc-300 bg-white px-3 py-3 font-mono text-xs" />
          <Button variant="secondary" data-testid="restore-key" onClick={() => { try { a.restoreKey(restore); setErr(null); } catch (e) { setErr((e as Error).message); } }}>Restore</Button>
        </div>
        {err && <div className="mt-2"><Notice tone="error">{err}</Notice></div>}
      </details>
      {a.qorexState === 'ready' && !a.identity && (
        <Button block variant="secondary" onClick={() => void a.connect()} data-testid="connect-qorex">Connect QoreX (top-ups only)</Button>
      )}
      {a.qorexError && <Notice tone="warn">{a.qorexError}</Notice>}
    </div>
  );
}

function Qr({ text, alt = 'QR code of the address', testId = 'address-qr' }: { text: string; alt?: string; testId?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => { void QRCode.toDataURL(text, { margin: 1, width: 220, errorCorrectionLevel: 'M' }).then(setUrl).catch(() => setUrl(null)); }, [text]);
  return url
    ? <img src={url} alt={alt} width={176} height={176} className="rounded-xl border border-zinc-200 bg-white p-2" data-testid={testId} />
    : <div className="h-[176px] w-[176px] rounded-xl border border-zinc-200" />;
}

/** The two ways to fund a Pocket: a QoreX native send (when QoreX runs on testnet) or any wallet / the faucet via address + QR. */
export function FundOptions({ target, label }: { target: Hex; label: string }) {
  const a = useAccount();
  const { data: qb } = useQorexBalance();
  const qc = useQueryClient();
  const [amt, setAmt] = useState('1');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error'; text: string; hash?: string } | null>(null);
  async function send() {
    if (!a.identity) return;
    setBusy(true); setMsg(null);
    try {
      const uqor = BigInt(Math.round(Number(amt) * 1e6));
      const r = await fundFromQorex(a.identity, cosmosAddressOf(target), uqor);
      setMsg({ tone: 'ok', text: 'Sent from QoreX.', hash: r.txHash });
      void qc.invalidateQueries();
    } catch (e) { setMsg({ tone: 'error', text: explainError(e) }); } finally { setBusy(false); }
  }
  return (
    <div className="space-y-4" data-testid="fund-options">
      <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
        <Qr text={target} />
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-sm font-semibold text-zinc-900">{label}</p>
          <div className="text-xs text-zinc-500">For EVM wallets</div>
          <Mono className="block break-all">{target}</Mono>
          <div className="text-xs text-zinc-500">Same address for the faucet and Cosmos wallets</div>
          <span data-testid="fund-address-qor1" className="block break-all"><Mono>{cosmosAddressOf(target)}</Mono></span>
          <div className="flex flex-wrap gap-2">
            <CopyButton text={target} label="Copy 0x address" testId="copy-fund-address" />
            <CopyButton text={cosmosAddressOf(target)} label="Copy qor1 address" testId="copy-fund-qor1" />
            <a href={FAUCET_URL} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-[40px] items-center rounded-full border border-zinc-300 bg-white px-4 text-sm font-medium text-zinc-900 hover:bg-stoneCard">Get free testnet QOR</a>
          </div>
          <p className="text-xs leading-relaxed text-zinc-600">Any wallet can send testnet QOR to this address, even before the Pocket exists on-chain. The funds are safe: the address is fixed by your key.</p>
        </div>
      </div>
      {a.identity ? (
        a.identity.canFund ? (
          <div className="rounded-2xl border border-zinc-200 bg-white/70 p-4">
            <p className="text-sm font-medium text-zinc-900">Top up from QoreX {qb !== undefined && <span className="font-mono text-xs text-zinc-500">(balance {fmtQor(qb)} QOR)</span>}</p>
            <div className="mt-2 flex gap-2">
              <input value={amt} onChange={(e) => setAmt(e.target.value)} inputMode="decimal" aria-label="Amount in QOR" className="w-28 rounded-xl border border-zinc-300 bg-white px-3 py-2 font-mono text-sm" />
              <Button busy={busy} onClick={() => void send()} data-testid="qorex-topup"><Wallet className="h-4 w-4" aria-hidden />Send with QoreX</Button>
            </div>
            {msg && <div className="mt-2"><Notice tone={msg.tone}>{msg.text} {msg.hash && <TxLink hash={msg.hash} />}</Notice></div>}
          </div>
        ) : <Notice tone="warn">Your QoreX build cannot send from a web page, so use the address above.</Notice>
      ) : (
        <p className="text-xs text-zinc-500">QoreX one-tap top-up appears here when QoreX is connected. QoreX is on mainnet today and this app runs on Diana testnet, so use the address or the faucet for now.</p>
      )}
    </div>
  );
}

/** "Your Pocket": the counterfactual vault address, its live balance and how to fund it. Shown the same way everywhere. */
export function PocketCard({ compact }: { compact?: boolean }) {
  const a = useAccount();
  const { data: pv } = usePocketView();
  if (!a.activePocket) return null;
  // after a recovery the vault belongs to another key: say so, and never offer to fund it
  const lost = !!pv && pv.deployed && !!pv.owner && !!a.acct && pv.owner.toLowerCase() !== a.acct.evm.toLowerCase();
  return (
    <div className="space-y-3" data-testid="pocket-card" data-lost={lost ? '1' : '0'}>
      {lost && (
        <Notice tone="error" testId="pocket-lost">
          <b>You no longer control this Pocket.</b> It was recovered to another key (<Mono>{pv!.owner!}</Mono>), so this browser&apos;s key cannot move its funds. Do not send QOR to it. If that was not you, ask your guardians now.
        </Notice>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-zinc-500">{lost ? 'Former Pocket' : 'Your Pocket'}</span>
        <span className="flex items-center gap-1.5"><SourceBadge kind="LIVE" /><Pill tone={a.env === 'lab' ? 'warn' : 'neutral'}>{a.env === 'lab' ? 'Lab · 60 s delays' : 'Production instance'}</Pill></span>
      </div>
      <div className="flex flex-wrap items-baseline gap-x-3">
        <span className="font-serif text-4xl text-zinc-900" data-testid="pocket-balance" data-wei={pv?.balance.toString() ?? ''}>{pv ? fmtQor(pv.balance) : <Skel w="5rem" h="2.25rem" label="Reading your balance" />}</span>
        <span className="text-sm text-zinc-600">QOR</span>
        <Pill tone={pv?.deployed ? 'ok' : 'neutral'} testId="pocket-deployed">{pv ? (pv.deployed ? 'deployed' : 'opens on first use') : 'reading…'}</Pill>
      </div>
      <a href={addrUrl(a.activePocket)} target="_blank" rel="noopener noreferrer" data-testid="pocket-address" data-address={a.activePocket} className="block break-all font-mono text-xs text-zinc-700 underline decoration-zinc-300 underline-offset-2">{a.activePocket}</a>
      {!compact && !lost && <FundOptions target={a.activePocket} label="Fund your Pocket" />}
    </div>
  );
}

/** Smallest key-account balance that lets "Register my key" run: the registration fee plus a little gas. One number for the copy and the button (P3). */
export const KEY_ACCOUNT_MIN_WEI = REGISTRATION_FEE_WEI + 10_000_000_000_000_000n;

/** One-time registration of the ML-DSA key, paid from the key account (not the Pocket). Needed before the Pocket can first be used.
 *  A claimer with no QOR gets everything needed to get some: the qor1 address the faucet asks for, the 0x address, a QR and the faucet link (P1). */
export function ActivationCard({ children }: { children?: ReactNode }) {
  const a = useAccount();
  const k = useKeyAccount();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [hash, setHash] = useState<string | null>(null);
  const btn = useRef<HTMLDivElement>(null);
  const enough = (k.balance ?? 0n) >= KEY_ACCOUNT_MIN_WEI;
  // when the funds arrive, bring the Register button into view above the phone tab bar (P6)
  useEffect(() => { if (enough && !k.ready) btn.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, [enough, k.ready]);
  if (!a.acct) return null;
  const qor1 = cosmosAddressOf(a.acct.evm);
  const need = fmtQor(KEY_ACCOUNT_MIN_WEI);
  async function register() {
    setBusy(true); setErr(null);
    try {
      const { registerKey } = await import('../lib/recipient');
      setHash(await registerKey(a.acct!));
      await k.refetch(); void qc.invalidateQueries();
    } catch (e) { setErr(explainError(e)); } finally { setBusy(false); }
  }
  if (k.ready) return <div data-testid="key-ready" className="flex items-center gap-2 text-sm text-emerald-900"><Check className="h-4 w-4" aria-hidden />Your quantum-safe key is registered.{hash && <TxLink hash={hash} />}</div>;
  return (
    <div className="space-y-3" data-testid="activation">
      <p className="text-sm leading-relaxed text-zinc-700" data-testid="activation-note">
        <b>One-time setup: your key account needs at least {need} QOR</b> (0.1 is a safe round amount). It pays about {fmtQor(REGISTRATION_FEE_WEI)} QOR in network fees to register your quantum-safe key on-chain, once. This is separate from your Pocket: the Pocket holds your money, the key account only pays this fee.
      </p>
      <div className="rounded-2xl border border-zinc-200 bg-white/70 p-3 text-xs" data-testid="key-funding">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <Qr text={qor1} alt="QR code of your key account (qor1 address)" testId="key-qr" />
          <div className="min-w-0 flex-1 space-y-2">
            <div>
              <div className="text-zinc-500">Key account, for the faucet and Cosmos wallets</div>
              <span data-testid="key-address-qor1" data-address={qor1} className="block break-all"><Mono>{qor1}</Mono></span>
            </div>
            <div>
              <div className="text-zinc-500">Same account, for EVM wallets</div>
              <span data-testid="key-address" data-address={a.acct.evm} className="block break-all"><Mono>{a.acct.evm}</Mono></span>
            </div>
            <div className="text-zinc-600">Balance: <span data-testid="key-balance" data-wei={k.balance?.toString() ?? ''}>{k.balance !== undefined ? fmtQor(k.balance) : '…'}</span> QOR <span className="text-zinc-500">(updates by itself)</span></div>
            <div className="flex flex-wrap gap-2">
              <CopyButton text={qor1} label="Copy qor1 address" testId="copy-key-qor1" />
              <CopyButton text={a.acct.evm} label="Copy 0x address" testId="copy-key-address" />
              <a href={FAUCET_URL} target="_blank" rel="noopener noreferrer" data-testid="key-faucet" className="inline-flex min-h-[40px] items-center rounded-full border border-zinc-300 bg-white px-4 text-sm font-medium text-zinc-900 hover:bg-stoneCard">Get free testnet QOR</a>
            </div>
          </div>
        </div>
      </div>
      <div ref={btn} className="scroll-mb-32">
        <Button block busy={busy} disabled={!enough} onClick={() => void register()} data-testid="register-key">Register my key</Button>
        {!enough && <p className="mt-2 text-xs text-zinc-600" data-testid="register-reason">Waiting for at least {need} QOR on the key account (now {k.balance !== undefined ? fmtQor(k.balance) : '…'} QOR). Send it from the faucet or any wallet; the button turns on when it arrives.</p>}
      </div>
      {err && <Notice tone="error">{err}</Notice>}
      {children}
    </div>
  );
}

/** Backup of the browser key. Hidden until asked for. */
export function BackupCard() {
  const a = useAccount();
  const [show, setShow] = useState(false);
  if (!a.root) return null;
  return (
    <div className="space-y-2" data-testid="backup-card">
      <p className="text-sm text-zinc-700">This 64-character key is your whole account. Anyone who has it controls your Pocket. Guardians (below) can replace it if you lose it.</p>
      <div className="flex gap-2">
        <Button variant="secondary" onClick={() => setShow((s) => !s)} data-testid="toggle-backup">{show ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}{show ? 'Hide' : 'Show'} backup key</Button>
        {show && <CopyButton text={a.root} label="Copy" testId="copy-backup" />}
      </div>
      {show && <Mono className="block rounded-xl border border-zinc-200 bg-white p-3">{a.root}</Mono>}
    </div>
  );
}

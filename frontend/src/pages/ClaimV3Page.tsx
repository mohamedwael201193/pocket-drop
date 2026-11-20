import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Check, CircleDashed, Loader2, TriangleAlert, SkipForward, KeyRound, Droplets, CheckCircle2, MessageCircle, ShieldCheck, Fingerprint as FpIcon, Lock } from '../components/icons';
import { Button, CopyButton, Fingerprint, Mono, Notice, Page, SourceBadge, TxLink, cx } from '../components/ui';

import { addrUrl } from '../lib/config';

import { explainError, fetchLink, postBind, postClaim, type ApiLink } from '../lib/api';
import { fmtQor } from '../lib/chain';
import { modeLine } from '../lib/copy';
import { useBalance, useLink } from '../lib/queries';
import { fingerprint, parseClaimFragment } from '../lib/protocol';
import { newV2Root } from '../lib/keyderive';
import type { Hex } from 'viem';

type StepId = 'key' | 'bind' | 'register' | 'window' | 'verify' | 'claim';
type Status = 'idle' | 'running' | 'done' | 'error' | 'skipped';
interface Step { status: Status; hash?: string; note?: string; error?: string; ms?: number }
type Steps = Record<StepId, Step>;

const LABELS: Record<StepId, [string, string]> = {
  key: ['Create your account here', 'A quantum-safe key is generated inside this tab. It never leaves it.'],
  bind: ['Link opens your account', 'The relayer pays gas and a small drip lands in your new account.'],
  register: ['Register your key on-chain', 'Proof of possession of your ML-DSA-87 key, paid from the drip.'],
  window: ['Open a scoped window', 'Lets your account talk to PocketDrop only. Optional for claiming.'],
  verify: ['Sender check', 'Confirmed links wait for the sender to compare 4 words.'],
  claim: ['Claim the QOR', 'You sign the claim in this tab; the relayer submits it.'],
};
const ORDER: StepId[] = ['key', 'bind', 'register', 'window', 'verify', 'claim'];
const blank = (): Steps => Object.fromEntries(ORDER.map((s) => [s, { status: 'idle' as Status }])) as Steps;

interface Saved { root: string; tx: Record<string, string> }
const sk = (id: string) => `pd.recv.${id}`;
const loadSaved = (id: string): Saved | null => { try { return JSON.parse(localStorage.getItem(sk(id)) || 'null'); } catch { return null; } };
const persist = (id: string, s: Saved) => { try { localStorage.setItem(sk(id), JSON.stringify(s)); } catch { /* ignore */ } };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function ClaimV3Page() {
  const { id = '' } = useParams();
  const { hash } = useLocation();
  const seed = useMemo(() => parseClaimFragment(hash), [hash]);
  const { data: link, error: linkErr } = useLink(/^\d+$/.test(id) ? id : undefined, 3000);

  const [steps, setSteps] = useState<Steps>(blank);
  const [fatal, setFatal] = useState<string | null>(null);
  const [address, setAddress] = useState<Hex | null>(null);
  const [words, setWords] = useState<string[] | null>(null);
  const [started, setStarted] = useState(false);
  const running = useRef(false);
  const t0s = useRef<Partial<Record<StepId, number>>>({});
  const { data: balance } = useBalance(address ?? undefined, 3000);

  const patch = useCallback((s: StepId, p: Partial<Step>) => setSteps((x) => ({ ...x, [s]: { ...x[s], ...p } })), []);

  const run = useCallback(async () => {
    if (running.current || (!seed && !loadSaved(id))) return;
    running.current = true; setStarted(true); setFatal(null);
    let current: StepId = 'key';
    const t0: Partial<Record<StepId, number>> = t0s.current;
    const mark = (s: StepId, st: Status, extra: Partial<Step> = {}) => {
      current = s;
      if (st === 'running') t0[s] = performance.now();
      const ms = st !== 'running' && t0[s] !== undefined ? Math.round(performance.now() - t0[s]!) : undefined;
      patch(s, { status: st, error: undefined, ...(ms !== undefined ? { ms } : {}), ...extra });
    };
    try {
      const rec = await import('../lib/recipient');
      const saved = loadSaved(id) ?? { root: newV2Root(), tx: {} };
      persist(id, saved);

      mark('key', 'running');
      const acct = await rec.deriveFromRoot(saved.root);
      const me = acct.evm as Hex;
      setAddress(me); mark('key', 'done');

      // ---- bind (relayer pays gas; the link key authorises exactly this recipient + key)
      mark('bind', 'running');
      let l: ApiLink = await fetchLink(id);
      const mine = l.recipient?.toLowerCase() === me.toLowerCase();
      if (mine) {
        mark('bind', 'done', { hash: saved.tx.bind, note: 'Already bound to this browser.' });
      } else if (l.state === 'Open' || (l.state === 'Bound' && Number(l.bindDeadline) < Date.now() / 1000)) {
        if (!seed) throw new Error('This link is missing its key. Open the full link the sender shared.');
        const s = rec.signBind(seed, BigInt(id), me, rec.recipientKeyHash(acct));
        if (s.linkKeyHash.toLowerCase() !== l.linkKeyHash.toLowerCase()) throw new Error('The key in this link does not belong to this drop. Ask the sender for a fresh link.');
        const r = await postBind({ linkId: id, recipient: me, recipientKeyHash: rec.recipientKeyHash(acct), linkPk: s.linkPk, linkSig: s.linkSig });
        saved.tx.bind = r.txHash; persist(id, saved);
        mark('bind', 'done', { hash: r.txHash });
      } else if (l.state === 'Claimed' || l.state === 'Cancelled' || l.state === 'Refunded') {
        throw new Error(`This link is ${l.state.toLowerCase()}.`);
      } else {
        throw new Error('This link was already opened on another device or browser, so it cannot be opened again here.');
      }
      // wait for the drip to be visible from our RPC node
      for (let i = 0; i < 25 && (await (await import('../lib/chain')).getBalance(me)) < 30_000_000_000_000_000n; i++) await sleep(1200);

      // ---- register PQ key (proof of possession)
      mark('register', 'running');
      const st = await rec.keyStatus(me);
      if (st.registered && st.possessionProven) mark('register', 'done', { hash: saved.tx.register, note: 'Key already registered.' });
      else { const h = await rec.registerKey(acct); saved.tx.register = h; persist(id, saved); mark('register', 'done', { hash: h }); }

      // ---- no EVM window: claiming is relayed, and a live window would let the classical key alone send inside its scope
      mark('window', 'skipped', { note: 'Not opened: claiming does not need one, and an open window would let the classical key alone send within its scope.' });

      // ---- sender check
      l = await fetchLink(id);
      if (l.mode === 'Open') {
        mark('verify', 'skipped', { note: 'Giveaway link: no sender check.' });
      } else {
        mark('verify', 'running');
        if (l.recipientKeyHash) setWords(fingerprint(l.recipientKeyHash));
        for (;;) {
          l = await fetchLink(id);
          if (l.state === 'Confirmed' || l.state === 'Claimed') break;
          if (l.state === 'Cancelled' || l.state === 'Refunded') throw new Error(`The sender ${l.state === 'Cancelled' ? 'cancelled' : 'refunded'} this link.`);
          await sleep(3000);
        }
        mark('verify', 'done', { note: 'The sender confirmed your fingerprint.' });
      }

      // ---- claim
      mark('claim', 'running');
      if (l.state !== 'Claimed') {
        const sig = rec.signClaim(acct, BigInt(id));
        const r = await postClaim({ linkId: id, recipientSig: sig });
        saved.tx.claim = r.txHash; persist(id, saved);
        mark('claim', 'done', { hash: r.txHash });
      } else mark('claim', 'done', { hash: saved.tx.claim, note: 'Already claimed.' });
    } catch (e) {
      const msg = explainError(e);
      patch(current, { status: 'error', error: msg }); setFatal(msg);
    } finally { running.current = false; }
  }, [id, seed, patch]);

  // Resume automatically if this browser already holds the key for this link (e.g. after a reload).
  const auto = useRef(false);
  useEffect(() => { if (!auto.current && !started && /^\d+$/.test(id) && loadSaved(id) && !running.current) { auto.current = true; void run(); } }, [id, seed, run, started]);


  /* ---------- guards */
  const guard = (testId: string, tone: 'error' | 'warn', msg: React.ReactNode) => (
    <Page narrow><div className="space-y-4"><h1 className="font-serif text-3xl text-zinc-900">{testId === 'no-key' ? 'This link is incomplete' : testId === 'bad-link' ? 'Not a Pocket Drop link' : 'Could not open this link'}</h1><Notice tone={tone} testId={testId}>{msg}</Notice></div></Page>
  );
  if (!/^\d+$/.test(id)) return guard('bad-link', 'error', 'This is not a Pocket Drop link.');
  if (!seed && !loadSaved(id)) return guard('no-key', 'error', 'This link is missing its key. The long part after the # is required, so open the full link the sender shared.');
  if (linkErr && !link) return guard('link-error', 'error', explainError(linkErr));

  const done = steps.claim.status === 'done';
  const dead = link && !started && ['Claimed', 'Cancelled', 'Refunded'].includes(link.state);
  const expired = link && !started && Number(link.expiry) * 1000 < Date.now() && !['Claimed', 'Cancelled', 'Refunded'].includes(link.state);
  const amount = link ? fmtQor(BigInt(link.amount)) : null;
  const drip = link ? fmtQor(BigInt(link.drip)) : null;
  const waiting = !done && !fatal && steps.verify.status === 'running' && !!words;
  const doneCount = ORDER.filter((k) => ['done', 'skipped'].includes(steps[k].status)).length;
  const currentId = ORDER.find((k) => steps[k].status === 'running') ?? ORDER.find((k) => steps[k].status === 'idle');
  const state: 'ready' | 'opening' | 'waiting' | 'yours' = done ? 'yours' : waiting ? 'waiting' : started ? 'opening' : 'ready';
  const sender = link?.sender;
  const inboxUrl = `${window.location.origin}/send/inbox?link=${id}`;
  const waText = words ? `Pocket Drop link #${id}: my 4 words are "${words.join(' ')}". Please open ${inboxUrl} and tap Confirm, then my ${amount ?? ''} QOR is released.` : '';

  return (
    <Page narrow testId="claim-page">
      <div data-done={done ? '1' : '0'} data-state={state} className="space-y-5" data-testid="claim-state">
        <div className="capsule-obsidian rounded-3xl p-6 text-stone-100">
          <div className="flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.2em] text-stone-400"><span>Pocket Drop · link #{id}</span><SourceBadge kind="LIVE" /></div>
          <div className="mt-3 text-sm text-stone-300">{state === 'yours' ? 'It is yours' : 'You received'}</div>
          <div className="font-serif text-5xl leading-none" data-testid="incoming-amount">{amount ?? '…'}<span className="ml-2 text-xl text-stone-400">QOR</span></div>
          <div className="mt-2 font-mono text-[11px] text-stone-400">{link ? `${modeLine(link.mode, link.state)}${drip ? ` · +${drip} QOR gas drip included` : ''} · Testnet` : 'Reading the link…'}</div>
        </div>

        {dead && <h1 className="font-serif text-3xl text-zinc-900">This link is already {link!.state.toLowerCase()}</h1>}
        {dead && <Notice tone="warn" testId="link-dead">This link is already <strong>{link!.state.toLowerCase()}</strong>. It cannot be claimed again.</Notice>}
        {expired && <Notice tone="warn" testId="link-expired">This link expired. The sender can take the money back.</Notice>}

        {state === 'ready' && !dead && !expired && (
          <div className="space-y-4 rounded-3xl border border-zinc-200 bg-white/90 p-5 shadow-sm sm:p-6">
            <h1 className="font-serif text-3xl text-zinc-900">Open your Pocket</h1>
            <p className="text-sm leading-relaxed text-zinc-600">One tap creates a quantum-safe account inside this browser. A relayer pays the gas. No wallet, no extension, no seed phrase. {link?.mode === 'Confirmed' && 'Because the sender wants to be sure it is you, you will read them four words.'}</p>
            <Button block onClick={run} data-testid="start-claim" className="min-h-[52px] text-base">Receive {amount ?? ''} QOR</Button>
          </div>
        )}

        {state === 'waiting' && words && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4 rounded-3xl border-2 border-zinc-900 bg-white p-5 shadow-sm sm:p-6" data-testid="waiting-confirm">
            <div className="flex items-center gap-2"><span className="h-2.5 w-2.5 animate-pulseDot rounded-full bg-emerald-500" /><h2 className="font-serif text-2xl text-zinc-900">Waiting for the sender to confirm</h2></div>
            <Notice tone="ok">Nothing is broken. Your money is safe in escrow; it moves when the sender taps Confirm.</Notice>
            <p className="text-sm text-zinc-700">Send these 4 words to the sender. They compare them in their inbox and tap Confirm.</p>
            <Fingerprint words={words} testId="fingerprint" />
            <CopyButton text={words.join(' ')} label="Copy the 4 words" testId="copy-words" className="!min-h-[52px] w-full !text-base" />
            <a href={`https://wa.me/?text=${encodeURIComponent(waText)}`} target="_blank" rel="noopener noreferrer" data-testid="whatsapp-sender"
              className="inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-full bg-emerald-600 px-5 text-base font-medium text-white hover:bg-emerald-700"><MessageCircle className="h-5 w-5" aria-hidden />Send the words to the sender</a>
            {typeof navigator !== 'undefined' && typeof navigator.share === 'function' && <Button block variant="secondary" onClick={() => navigator.share({ text: waText }).catch(() => undefined)}>Share in another app…</Button>}
            <p className="text-xs leading-relaxed text-zinc-500">This page checks the chain every few seconds and claims by itself the moment the sender confirms. You can close it: opening the same link again picks up where it stopped. {sender && <>Sender account <Mono>{sender.slice(0, 10)}…</Mono>.</>} <SourceBadge kind="LIVE" title="Link state read from the relayer API every 3 seconds" /></p>
          </motion.div>
        )}

        {(state === 'opening' || state === 'waiting' || state === 'yours') && (
          <div className="rounded-3xl border border-zinc-200 bg-white/90 p-5 shadow-sm sm:p-6" data-testid="progress">
            <div className="flex items-center justify-between text-sm"><span className="font-medium text-zinc-900">{state === 'opening' ? 'Opening your Pocket' : state === 'waiting' ? 'Your Pocket is open' : 'Pocket open and paid'}</span><span className="font-mono text-xs text-zinc-500">{doneCount} of {ORDER.length}</span></div>
            <div className="mt-3 flex gap-1.5" aria-hidden>{ORDER.map((k) => <span key={k} className={cx('h-1.5 flex-1 rounded-full', steps[k].status === 'done' || steps[k].status === 'skipped' ? 'bg-emerald-600' : steps[k].status === 'running' ? 'animate-pulseDot bg-zinc-900' : steps[k].status === 'error' ? 'bg-red-600' : 'bg-zinc-200')} />)}</div>
            {state === 'opening' && currentId && <p className="mt-2 text-sm text-zinc-600" data-testid="current-step">{LABELS[currentId][0]}: {steps[currentId].note ?? LABELS[currentId][1]}</p>}
            <details className="mt-3 text-sm"><summary className="cursor-pointer text-zinc-600">Show every step</summary>
              <ol className="mt-3 space-y-2 text-xs" data-testid="steps">{ORDER.map((k, i) => <StepRow key={k} id={k} n={i + 1} step={steps[k]} started={started} />)}</ol>
            </details>
          </div>
        )}

        {fatal && (
          <div className="space-y-3">
            <Notice tone="error" testId="claim-error">{fatal}</Notice>
            <Button variant="secondary" block onClick={run} data-testid="retry-claim">Try again</Button>
          </div>
        )}

        {state === 'yours' && address && (
          <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} className="rounded-3xl border border-emerald-300 bg-emerald-50 p-5 sm:p-6" data-testid="yours">
            <div className="flex items-center justify-between"><h1 className="font-serif text-3xl text-zinc-900">It is yours.</h1><SourceBadge kind="LIVE" /></div>
            <div className="mt-2 font-serif text-5xl text-zinc-900" data-testid="final-balance" data-wei={balance?.toString() ?? ''}>{balance === undefined ? '…' : fmtQor(balance)} <span className="text-xl text-zinc-500">QOR</span></div>
            <p className="mt-1 text-xs text-zinc-600">Balance of your new account, read from the chain.</p>
            <div className="mt-3 space-y-1 text-xs text-zinc-700">
              <div>Account: <a className="underline" href={addrUrl(address)} target="_blank" rel="noopener noreferrer"><Mono>{address}</Mono></a></div>
              {steps.claim.hash && <div>Claim transaction: <TxLink hash={steps.claim.hash} testId="tx-claim" /></div>}
            </div>
            <p className="mt-3 text-xs text-zinc-600">Your key lives in this browser only. Clearing site data loses access to this testnet account.</p>
            <Link to="/send" className="mt-3 inline-block text-sm font-medium text-zinc-900 underline">Send a drop of your own</Link>
          </motion.div>
        )}
      </div>
    </Page>
  );
}

const ICONS: Record<StepId, typeof KeyRound> = { key: KeyRound, bind: Droplets, register: ShieldCheck, window: Lock, verify: FpIcon, claim: CheckCircle2 };

function StepRow({ id, n, step, started }: { id: StepId; n: number; step: Step; started: boolean }) {
  const [title, sub] = LABELS[id];
  const Icon = ICONS[id];
  const badge = {
    idle: started ? 'Pending' : 'Ready after tap',
    running: 'Working…',
    done: step.ms !== undefined ? `Done ${(step.ms / 1000).toFixed(step.ms < 100 ? 3 : 1)} s` : 'Done',
    error: 'Error',
    skipped: 'Skipped',
  }[step.status];
  const stateIcon = {
    idle: <CircleDashed className="h-4 w-4 text-zinc-300" />,
    running: <Loader2 className="h-4 w-4 animate-spin text-zinc-900" />,
    done: <Check className="h-4 w-4 text-emerald-700" />,
    error: <TriangleAlert className="h-4 w-4 text-red-700" />,
    skipped: <SkipForward className="h-4 w-4 text-zinc-400" />,
  }[step.status];
  return (
    <li data-testid={`step-${id}`} data-status={step.status} data-ms={step.ms ?? ''}
      className={cx('rounded-xl border border-zinc-200 p-3', step.status === 'idle' ? 'bg-white/60 opacity-75' : 'bg-white')}>
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2 font-medium"><Icon className="h-4 w-4 shrink-0 text-zinc-600" aria-hidden />{n}. {title}</span>
        <span className="flex shrink-0 items-center gap-1 font-mono text-[10px] text-zinc-600">{badge}{stateIcon}</span>
      </div>
      <div className="mt-1 text-[11px] leading-snug text-zinc-500">{step.note ?? sub}</div>
      {step.hash && <div className="mt-0.5"><TxLink hash={step.hash} testId={`tx-${id}`} /></div>}
      {step.error && <div className="mt-0.5 text-[11px] text-red-700">{step.error}</div>}
    </li>
  );
}

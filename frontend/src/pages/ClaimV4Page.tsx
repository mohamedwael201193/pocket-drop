import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, CircleDashed, Loader2, MessageCircle, TriangleAlert } from 'lucide-react';
import type { Hex } from 'viem';
import { Button, CopyButton, Fingerprint, Mono, Notice, Page, SourceBadge, TxLink, cx } from '../components/ui';
import { bindDrop, claimDrop, keyStatus, readDrop, linkId4 } from '../lib/claim4';
import { deriveAccount, loadRoot, keyHashOfAccount, type KeyAccount } from '../lib/identity';
import { useAccount } from '../lib/account';
import { defaultCfg, predictPocket, REGISTRATION_FEE_WEI, type Env } from '../lib/v4';
import { explainError } from '../lib/api';
import { fmtQor, pub } from '../lib/chain';
import { addrUrl } from '../lib/config';
import { modeLine } from '../lib/copy';
import { fingerprint, parseClaimFragment } from '../lib/protocol';
import { useBalance } from '../lib/queries';

type StepId = 'key' | 'bind' | 'register' | 'verify' | 'claim';
type Status = 'idle' | 'running' | 'done' | 'error' | 'skipped';
interface Step { status: Status; hash?: string; note?: string; ms?: number }
const ORDER: StepId[] = ['key', 'bind', 'register', 'verify', 'claim'];
const LABELS: Record<StepId, [string, string]> = {
  key: ['Create your key here', 'A quantum-safe key is generated inside this tab. It never leaves it.'],
  bind: ['Link opens your account', 'The relayer pays gas and a small setup fee lands in your key account.'],
  register: ['Register your key on-chain', 'Proof of possession of your ML-DSA-87 key, paid from the setup fee.'],
  verify: ['Sender check', 'Confirmed mode waits for the sender to compare 4 words (nothing for a giveaway).'],
  claim: ['Claim into your Pocket', 'You sign the claim in this tab; the relayer submits it. The QOR lands in your Pocket.'],
};
const blank = (): Record<StepId, Step> => Object.fromEntries(ORDER.map((s) => [s, { status: 'idle' as Status }])) as Record<StepId, Step>;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const startedKey = (env: Env, id: bigint) => `pd.recv4.${env}.${id}`;

export default function ClaimV4Page({ env, id }: { env: Env; id: bigint }) {
  const { hash } = useLocation();
  const seed = useMemo(() => parseClaimFragment(hash), [hash]);
  const label = linkId4(env, id);
  const account = useAccount();
  const ensureKey = account.ensureKey;
  // read inside run() without re-creating it: the Pocket this key already uses (a custom or recovered one), if any
  const accountRef = useRef(account);
  accountRef.current = account;
  const qc = useQueryClient();
  const { data: link, error: linkErr } = useQuery({ queryKey: ['drop4', env, id.toString()], queryFn: () => readDrop(env, id), refetchInterval: 3000, retry: 1 });

  const [steps, setSteps] = useState(blank);
  const [fatal, setFatal] = useState<string | null>(null);
  const [acct, setAcct] = useState<KeyAccount | null>(null);
  const [pocket, setPocket] = useState<Hex | null>(null);
  const [words, setWords] = useState<string[] | null>(null);
  const [started, setStarted] = useState(false);
  const running = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const { data: pocketBal } = useBalance(pocket ?? undefined, 3000);

  const patch = useCallback((s: StepId, p: Partial<Step>) => setSteps((x) => ({ ...x, [s]: { ...x[s], ...p } })), []);

  const run = useCallback(async () => {
    if (running.current) return;
    running.current = true; setStarted(true); setFatal(null);
    try { localStorage.setItem(startedKey(env, id), '1'); } catch { /* ignore */ }
    let current: StepId = 'key';
    const t0: Partial<Record<StepId, number>> = {};
    const mark = (s: StepId, st: Status, extra: Partial<Step> = {}) => {
      current = s;
      if (st === 'running') t0[s] = performance.now();
      patch(s, { status: st, ...extra, ...(st === 'done' && t0[s] !== undefined ? { ms: performance.now() - t0[s]! } : {}) });
    };
    try {
      mark('key', 'running');
      const root = ensureKey(); // registers the key in the app's account state, never replaces an existing one
      const me = await deriveAccount(root);
      const defaultPocket = await predictPocket(env, defaultCfg(me.evm as Hex));
      // a returning user is paid into the Pocket they use in this app (for example one they took over by recovery), not always the default one
      const ctx = accountRef.current;
      const myPocket = ctx.acct && ctx.acct.evm.toLowerCase() === me.evm.toLowerCase() && ctx.activePocket ? ctx.activePocket : defaultPocket;
      if (!alive.current) return;
      setAcct(me); setPocket(myPocket);
      mark('key', 'done', { note: `Account ${me.evm.slice(0, 8)}…${me.evm.slice(-6)} · Pocket ${myPocket.slice(0, 8)}…${myPocket.slice(-6)}` });

      let l = await readDrop(env, id);
      if (!l) throw new Error('No such link.');
      if (l.payTo && /^0x[0-9a-fA-F]{40}$/.test(l.payTo) && !/^0x0{40}$/.test(l.payTo) && l.recipient.toLowerCase() === me.evm.toLowerCase()) setPocket(l.payTo as Hex);
      if (['Claimed', 'Cancelled', 'Refunded'].includes(l.state) && !(l.state === 'Claimed' && l.recipient.toLowerCase() === me.evm.toLowerCase())) throw new Error(`This link is already ${l.state.toLowerCase()}.`);
      const mine = l.recipient.toLowerCase() === me.evm.toLowerCase();
      const now = Math.floor(Date.now() / 1000);
      if (!mine && l.state === 'Bound' && l.bindDeadline >= now) throw new Error('This link was opened by another account and is still reserved for it for up to an hour. Ask the sender for a fresh link.');

      // 1) bind (signed by the link key from the URL fragment; the relayer pays gas; the drip lands in the key account)
      if (mine && (l.state === 'Bound' || l.state === 'Confirmed' || l.state === 'Claimed')) mark('bind', 'skipped', { note: 'Already opened by this browser.' });
      else {
        if (!seed) throw new Error('This link is missing its key. The long part after the # is required, so open the full link the sender shared.');
        mark('bind', 'running');
        const r = await bindDrop(env, id, seed, me, myPocket);
        mark('bind', 'done', { hash: r.txHash });
        l = (await readDrop(env, id)) ?? l;
      }
      setWords(fingerprint(keyHashOfAccount(me)));

      // 2) register the PQ key (fee paid from the drip)
      const ks0 = await keyStatus(me.evm as Hex);
      if (ks0.registered && ks0.possessionProven) mark('register', 'skipped', { note: 'Key already registered.' });
      else {
        mark('register', 'running');
        for (let i = 0; i < 20 && (await pub.getBalance({ address: me.evm as Hex })) < REGISTRATION_FEE_WEI + 5_000_000_000_000_000n; i++) await sleep(1500);
        const { registerKey } = await import('../lib/recipient');
        mark('register', 'running', { note: 'Signing the proof of possession…' });
        const hsh = await registerKey(me);
        mark('register', 'done', { hash: hsh });
      }

      // 3) Confirmed mode: wait (live) for the sender's one-tap confirmation
      l = (await readDrop(env, id)) ?? l;
      if (l.mode === 'Open') mark('verify', 'skipped', { note: 'Giveaway: no sender check.' });
      else {
        mark('verify', 'running', { note: 'Waiting for the sender to confirm.' });
        while (alive.current) {
          const cur = await readDrop(env, id);
          if (cur && (cur.state === 'Confirmed' || cur.state === 'Claimed')) break;
          if (!cur || ['Cancelled', 'Refunded'].includes(cur.state)) throw new Error(`The sender ${cur?.state === 'Cancelled' ? 'cancelled' : 'did not confirm in time'}; the money returned to them.`);
          await sleep(3000);
        }
        if (!alive.current) return;
        mark('verify', 'done', { note: 'The sender confirmed.' });
      }

      // 4) claim into the Pocket
      l = (await readDrop(env, id)) ?? l;
      if (l.state === 'Claimed') mark('claim', 'skipped', { note: 'Already claimed.' });
      else {
        mark('claim', 'running');
        const payTo = (l.payTo && !/^0x0{40}$/.test(l.payTo) ? l.payTo : myPocket) as Hex;
        const before = await pub.getBalance({ address: payTo }).catch(() => 0n);
        const r = await claimDrop(env, id, me, payTo); // the claim signs over the payTo fixed at bind
        // show the paid balance, not a stale 0: wait until the chain read includes the claim (B-04)
        mark('claim', 'running', { hash: r.txHash, note: 'Claim mined. Reading your new balance…' });
        let after = before;
        for (let i = 0; i < 20 && after < before + l.amount; i++) { await sleep(1500); after = await pub.getBalance({ address: payTo }).catch(() => after); }
        qc.setQueryData(['balance', payTo], after);
        setPocket(payTo);
        mark('claim', 'done', { hash: r.txHash, note: undefined });
      }
    } catch (e) {
      patch(current, { status: 'error' });
      setFatal(explainError(e));
    } finally { running.current = false; }
  }, [env, id, seed, patch, ensureKey, qc]);

  // resume where it stopped when the same link is opened again in this browser
  useEffect(() => {
    let was = false;
    try { was = localStorage.getItem(startedKey(env, id)) === '1'; } catch { /* ignore */ }
    if (was && loadRoot()) void run();
  }, [env, id, run]);

  if (link === null) return <DeadEnd title="Link not found" testId="link-error">There is no link {label} on this instance. Check that you opened the whole link the sender shared, or ask them for a new one.</DeadEnd>;
  if (linkErr && !link) return <DeadEnd title="Could not read this link" testId="link-error">{explainError(linkErr)} Reload the page to try again.</DeadEnd>;
  if (!seed && !started && !(() => { try { return localStorage.getItem(startedKey(env, id)) === '1'; } catch { return false; } })()) {
    if (link && ['Claimed', 'Cancelled', 'Refunded'].includes(link.state)) return <DeadEnd title={`This link is already ${link.state.toLowerCase()}`} testId="link-dead" tone="warn">It held {fmtQor(link.amount)} QOR and cannot be claimed again.</DeadEnd>;
    return <DeadEnd title="This link is incomplete" testId="no-key">The link is missing its key: the long part after the # is required. Open the full link exactly as the sender shared it.</DeadEnd>;
  }

  const done = steps.claim.status === 'done' || steps.claim.status === 'skipped';
  const dead = link && !started && ['Claimed', 'Cancelled', 'Refunded'].includes(link.state);
  const expired = link && !started && link.expiry * 1000 < Date.now() && !['Claimed', 'Cancelled', 'Refunded'].includes(link.state);
  const amount = link ? fmtQor(link.amount) : null;
  const drip = link ? fmtQor(link.drip) : null;
  const waiting = !done && !fatal && steps.verify.status === 'running' && !!words;
  const doneCount = ORDER.filter((k) => ['done', 'skipped'].includes(steps[k].status)).length;
  const currentId = ORDER.find((k) => steps[k].status === 'running') ?? ORDER.find((k) => steps[k].status === 'idle');
  const state: 'ready' | 'opening' | 'waiting' | 'yours' = done ? 'yours' : waiting ? 'waiting' : started ? 'opening' : 'ready';
  const inboxUrl = `${window.location.origin}/send/inbox?link=${label}`;
  const waText = words ? `Pocket Drop ${label}: my 4 words are "${words.join(' ')}". Please open ${inboxUrl} and tap Confirm, then my ${amount ?? ''} QOR is released.` : '';

  return (
    <Page narrow testId="claim-page">
      <div data-done={done ? '1' : '0'} data-state={state} className="space-y-5" data-testid="claim-state">
        <div className="capsule-obsidian rounded-3xl p-6 text-stone-100">
          <div className="flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.2em] text-stone-400"><span>Pocket Drop · {label}{env === 'lab' ? ' · lab' : ''}</span><SourceBadge kind="LIVE" /></div>
          <div className="mt-3 text-sm text-stone-300">{state === 'yours' ? 'It is yours' : dead ? 'This link held' : expired ? 'This link holds' : 'You received'}</div>
          <div className="font-serif text-5xl leading-none" data-testid="incoming-amount">{amount ?? '…'}<span className="ml-2 text-xl text-stone-400">QOR</span></div>
          <div className="mt-2 font-mono text-[11px] text-stone-400" data-testid="mode-line">{link ? `${modeLine(link.mode, link.state)}${drip ? ` · +${drip} QOR setup fee included` : ''} · Testnet` : 'Reading the link…'}</div>
        </div>

        {dead && <Notice tone="warn" testId="link-dead">This link is already <strong>{link!.state.toLowerCase()}</strong>. It cannot be claimed again.</Notice>}
        {expired && <Notice tone="warn" testId="link-expired">This link expired. The sender can take the money back.</Notice>}

        {state === 'ready' && !dead && !expired && (
          <div className="space-y-4 rounded-3xl border border-zinc-200 bg-white/90 p-5 shadow-sm sm:p-6">
            <h1 className="font-serif text-3xl text-zinc-900">Open your Pocket</h1>
            <p className="text-sm leading-relaxed text-zinc-600">One tap creates a quantum-safe key inside this browser and a Pocket address for it. A relayer pays the gas. No wallet, no extension, no seed phrase. {link?.mode === 'Confirmed' && 'Because the sender wants to be sure it is you, they compare 4 words with you first; you will see them here.'}</p>
            <Button block onClick={() => void run()} data-testid="start-claim" className="min-h-[52px] text-base">Receive {amount ?? ''} QOR into my Pocket</Button>
          </div>
        )}

        {state === 'waiting' && words && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4 rounded-3xl border-2 border-zinc-900 bg-white p-5 shadow-sm sm:p-6" data-testid="waiting-confirm">
            <div className="flex items-center gap-2"><span className="h-2.5 w-2.5 animate-pulseDot rounded-full bg-emerald-500" /><h2 className="font-serif text-2xl text-zinc-900">Waiting for the sender to confirm</h2></div>
            <Notice tone="ok">Nothing is broken. The money is safe in escrow; it moves when the sender taps Confirm.</Notice>
            <p className="text-sm text-zinc-700">Send these 4 words to the sender. They compare them in their inbox and tap Confirm once.</p>
            <Fingerprint words={words} testId="fingerprint" />
            <CopyButton text={words.join(' ')} label="Copy the 4 words" testId="copy-words" className="!min-h-[52px] w-full !text-base" />
            <a href={`https://wa.me/?text=${encodeURIComponent(waText)}`} target="_blank" rel="noopener noreferrer" data-testid="whatsapp-sender"
              className="inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-full bg-emerald-600 px-5 text-base font-medium text-white hover:bg-emerald-700"><MessageCircle className="h-5 w-5" aria-hidden />Nudge the sender</a>
            {typeof navigator !== 'undefined' && typeof navigator.share === 'function' && <Button block variant="secondary" onClick={() => navigator.share({ text: waText }).catch(() => undefined)}>Share in another app…</Button>}
            <p className="text-xs leading-relaxed text-zinc-500">This page checks the chain every few seconds and claims by itself the moment the sender confirms. You can close it: opening the same link again picks up where it stopped. Sender Pocket <a className="underline" href={addrUrl(link!.sender)} target="_blank" rel="noopener noreferrer"><Mono>{link!.sender}</Mono></a></p>
          </motion.div>
        )}

        {(state === 'opening' || state === 'waiting' || state === 'yours') && (
          <div className="rounded-3xl border border-zinc-200 bg-white/90 p-5 shadow-sm sm:p-6" data-testid="progress">
            <div className="flex items-center justify-between text-sm"><span className="font-medium text-zinc-900">{state === 'opening' ? 'Opening your Pocket' : state === 'waiting' ? 'Your Pocket is open' : 'Pocket open and paid'}</span><span className="font-mono text-xs text-zinc-500">{doneCount}/{ORDER.length}</span></div>
            <div className="mt-3 flex gap-1.5" aria-hidden>{ORDER.map((k) => <span key={k} className={cx('h-1.5 flex-1 rounded-full', steps[k].status === 'done' || steps[k].status === 'skipped' ? 'bg-emerald-600' : steps[k].status === 'running' ? 'animate-pulseDot bg-zinc-900' : 'bg-zinc-200')} />)}</div>
            {state === 'opening' && currentId && <p className="mt-2 text-sm text-zinc-600" data-testid="current-step">{LABELS[currentId][0]}: {steps[currentId].note ?? LABELS[currentId][1]}</p>}
            <details className="mt-3 text-sm" open><summary className="cursor-pointer text-zinc-600">Every step</summary>
              <ol className="mt-3 space-y-2 text-xs" data-testid="steps">{ORDER.map((k, i) => <StepRow key={k} id={k} n={i + 1} step={steps[k]} />)}</ol>
            </details>
          </div>
        )}

        {fatal && (
          <div className="space-y-3">
            <Notice tone="error" testId="claim-error">{fatal}</Notice>
            <Button variant="secondary" block onClick={() => void run()} data-testid="retry-claim">Try again</Button>
          </div>
        )}

        {state === 'yours' && pocket && (
          <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} className="rounded-3xl border border-emerald-300 bg-emerald-50 p-5 sm:p-6" data-testid="yours">
            <div className="flex items-center justify-between"><h1 className="font-serif text-3xl text-zinc-900">It is yours.</h1><SourceBadge kind="LIVE" /></div>
            <div className="mt-2 font-serif text-5xl text-zinc-900" data-testid="final-balance" data-wei={pocketBal?.toString() ?? ''}>{pocketBal === undefined ? <span className="inline-block h-10 w-32 animate-pulse rounded-xl bg-emerald-200/70 align-middle" aria-label="Reading your balance" /> : fmtQor(pocketBal)} <span className="text-xl text-zinc-500">QOR</span></div>
            <p className="mt-1 text-xs text-zinc-600">Balance of Your Pocket, read from the chain.</p>
            <div className="mt-3 space-y-1 text-xs text-zinc-700">
              <div>Your Pocket: <a className="underline" href={addrUrl(pocket)} target="_blank" rel="noopener noreferrer"><Mono>{pocket}</Mono></a></div>
              {acct && <div>Key account: <Mono>{acct.evm}</Mono></div>}
              {steps.claim.hash && <div>Claim transaction: <TxLink hash={steps.claim.hash} testId="tx-claim" /></div>}
            </div>
            <div className="mt-4 rounded-2xl border border-emerald-300 bg-white/70 p-3 text-sm text-zinc-800" data-testid="backup-cta">
              <b>Back up and add guardians.</b> Your key lives in this browser only. Save the backup key and name 2 to 5 guardians who can recover your Pocket if you lose it.
              <div className="mt-2"><Link to="/pocket" className="inline-flex min-h-[44px] items-center rounded-full bg-zinc-900 px-5 text-sm font-medium text-stone-50" data-testid="to-pocket">Open my Pocket</Link></div>
            </div>
          </motion.div>
        )}
      </div>
    </Page>
  );
}

function StepRow({ id, n, step }: { id: StepId; n: number; step: Step }) {
  const [title, sub] = LABELS[id];
  const badge = { idle: 'Pending', running: 'Working…', done: step.ms !== undefined ? `Done ${(step.ms / 1000).toFixed(1)} s` : 'Done', error: 'Error', skipped: 'Skipped' }[step.status];
  const icon = {
    idle: <CircleDashed className="h-4 w-4 text-zinc-300" />, running: <Loader2 className="h-4 w-4 animate-spin text-zinc-900" />, done: <Check className="h-4 w-4 text-emerald-700" />,
    error: <TriangleAlert className="h-4 w-4 text-red-700" />, skipped: <Check className="h-4 w-4 text-zinc-400" />,
  }[step.status];
  return (
    <li data-testid={`step-${id}`} data-status={step.status} className={cx('rounded-xl border border-zinc-200 p-3', step.status === 'idle' ? 'bg-white/60 opacity-75' : 'bg-white')}>
      <div className="flex items-center justify-between gap-2"><span className="font-medium">{n}. {title}</span><span className="flex shrink-0 items-center gap-1 font-mono text-[10px] text-zinc-600">{badge}{icon}</span></div>
      <div className="mt-1 text-[11px] leading-snug text-zinc-500">{step.note ?? sub}</div>
      {step.hash && <div className="mt-0.5"><TxLink hash={step.hash} testId={`tx-${id}`} /></div>}
    </li>
  );
}


/** A link that cannot be claimed: one heading, the reason, and where to go next. */
function DeadEnd({ title, testId, tone = 'error', children }: { title: string; testId: string; tone?: 'error' | 'warn'; children: ReactNode }) {
  return (
    <Page narrow testId="claim-page">
      <div className="space-y-4">
        <h1 className="font-serif text-3xl text-zinc-900">{title}</h1>
        <Notice tone={tone} testId={testId}>{children}</Notice>
        <div className="flex flex-wrap gap-2 text-sm">
          <Link to="/receive" className="inline-flex min-h-[44px] items-center rounded-full border border-zinc-300 bg-white px-5 font-medium text-zinc-900">Paste another link</Link>
          <Link to="/" className="inline-flex min-h-[44px] items-center rounded-full px-4 text-zinc-700 underline">What is Pocket Drop?</Link>
        </div>
      </div>
    </Page>
  );
}

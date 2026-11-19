import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Check, CircleDashed, Loader2, TriangleAlert, SkipForward } from 'lucide-react';
import { Button, Card, CopyButton, Eyebrow, Fingerprint, Mono, Notice, SourceBadge, TxLink, cx } from '../components/ui';
import { addrUrl, TESTNET_BADGE } from '../lib/config';
import { explainError, fetchLink, postBind, postClaim, type ApiLink } from '../lib/api';
import { fmtQor } from '../lib/chain';
import { useBalance, useLink } from '../lib/queries';
import { bytesToHex, fingerprint, hexToBytes, parseClaimFragment } from '../lib/protocol';
import type { Hex } from 'viem';

type StepId = 'key' | 'bind' | 'register' | 'window' | 'verify' | 'claim';
type Status = 'idle' | 'running' | 'done' | 'error' | 'skipped';
interface Step { status: Status; hash?: string; note?: string; error?: string }
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

export default function ClaimPage() {
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
  const { data: balance } = useBalance(address ?? undefined, 3000);

  const patch = useCallback((s: StepId, p: Partial<Step>) => setSteps((x) => ({ ...x, [s]: { ...x[s], ...p } })), []);

  const run = useCallback(async () => {
    if (running.current || !seed) return;
    running.current = true; setStarted(true); setFatal(null);
    let current: StepId = 'key';
    const mark = (s: StepId, st: Status, extra: Partial<Step> = {}) => { current = s; patch(s, { status: st, error: undefined, ...extra }); };
    try {
      const rec = await import('../lib/recipient');
      const saved = loadSaved(id) ?? { root: bytesToHex(crypto.getRandomValues(new Uint8Array(32))).slice(2), tx: {} };
      persist(id, saved);

      mark('key', 'running');
      const acct = await rec.deriveRecipient(hexToBytes(saved.root));
      const me = acct.evm as Hex;
      setAddress(me); mark('key', 'done');

      // ---- bind (relayer pays gas; the link key authorises exactly this recipient + key)
      mark('bind', 'running');
      let l: ApiLink = await fetchLink(id);
      const mine = l.recipient?.toLowerCase() === me.toLowerCase();
      if (mine) {
        mark('bind', 'done', { hash: saved.tx.bind, note: 'Already bound to this browser.' });
      } else if (l.state === 'Open' || (l.state === 'Bound' && Number(l.bindDeadline) < Date.now() / 1000)) {
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

      // ---- scoped window (optional for claiming)
      mark('window', 'running');
      try {
        if (await rec.windowLive(acct)) mark('window', 'done', { hash: saved.tx.window, note: 'Window already open.' });
        else { const h = await rec.openScopedWindow(acct); saved.tx.window = h; persist(id, saved); mark('window', 'done', { hash: h }); }
      } catch (e) {
        mark('window', 'skipped', { note: `Not needed to claim. Skipped: ${(e as Error).message.slice(0, 160)}` });
      }

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
  useEffect(() => { if (!auto.current && !started && seed && /^\d+$/.test(id) && loadSaved(id) && !running.current) { auto.current = true; void run(); } }, [id, seed, run, started]);

  /* ---------- guards */
  if (!/^\d+$/.test(id)) return <Card><Notice tone="error">This is not a Pocket Drop link.</Notice></Card>;
  if (!seed) return <Card><Notice tone="error" testId="no-key">This link is missing its key. The long part after the # is required, so open the full link the sender shared.</Notice></Card>;
  if (linkErr && !link) return <Card><Notice tone="error" testId="link-error">{explainError(linkErr)}</Notice></Card>;

  const done = steps.claim.status === 'done';
  const dead = link && !started && ['Claimed', 'Cancelled', 'Refunded'].includes(link.state);
  const expired = link && !started && Number(link.expiry) * 1000 < Date.now() && !['Claimed', 'Cancelled', 'Refunded'].includes(link.state);

  return (
    <div className="mx-auto max-w-md space-y-4" data-testid="claim-page" data-done={done ? '1' : '0'}>
      <header className="text-center">
        <Eyebrow>You received a Pocket Drop</Eyebrow>
        <div className="mt-2 font-serif text-6xl leading-none text-zinc-900" data-testid="incoming-amount">
          {link ? fmtQor(BigInt(link.amount)) : '…'}<span className="ml-2 text-2xl text-zinc-500">QOR</span>
        </div>
        <div className="mt-2 inline-flex items-center gap-2 text-xs text-zinc-500"><SourceBadge kind="LIVE" /> {TESTNET_BADGE}</div>
      </header>

      {dead && <Notice tone="warn" testId="link-dead">This link is already <strong>{link!.state.toLowerCase()}</strong>. It cannot be claimed again.</Notice>}
      {expired && <Notice tone="warn" testId="link-expired">This link expired. The sender can take the money back.</Notice>}

      {!started && !dead && !expired && (
        <Card>
          <p className="text-sm text-zinc-700">Tap once. This browser creates a quantum-safe QoreChain account for you, a relayer pays the gas, and the QOR lands in it. {link?.mode === 'Confirmed' && 'Because the sender wants to be sure it is you, you will read them four words.'}</p>
          <div className="mt-4"><Button block onClick={run} data-testid="start-claim">Receive {link ? fmtQor(BigInt(link.amount)) : ''} QOR</Button></div>
        </Card>
      )}

      {started && (
        <Card>
          <ol className="space-y-3" data-testid="steps">
            {ORDER.map((s) => <StepRow key={s} id={s} step={steps[s]} />)}
          </ol>
        </Card>
      )}

      {words && !done && steps.verify.status === 'running' && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
          <Fingerprint words={words} testId="fingerprint" />
          <Notice tone="info" testId="waiting-confirm">Read these four words to the sender (message, call or screenshot). Claiming starts by itself when they confirm.</Notice>
          <CopyButton text={words.join(' ')} label="Copy the 4 words" />
        </motion.div>
      )}

      {fatal && (
        <div className="space-y-2">
          <Notice tone="error" testId="claim-error">{fatal}</Notice>
          <Button variant="secondary" block onClick={run} data-testid="retry-claim">Try again</Button>
        </div>
      )}

      {done && address && (
        <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }}>
          <Card dark>
            <div className="flex items-center justify-between"><h2 className="font-serif text-2xl">It is yours.</h2><SourceBadge kind="LIVE" /></div>
            <div className="mt-2 font-serif text-5xl" data-testid="final-balance" data-wei={balance?.toString() ?? ''}>{balance === undefined ? '…' : fmtQor(balance)} <span className="text-xl text-stone-400">QOR</span></div>
            <p className="mt-1 text-xs text-stone-300">Balance of your new account, read from the chain.</p>
            <div className="mt-3 space-y-1 text-xs text-stone-300">
              <div>Account: <a className="underline" href={addrUrl(address)} target="_blank" rel="noopener noreferrer"><Mono className="!text-stone-100">{address}</Mono></a></div>
              {steps.claim.hash && <div>Claim transaction: <span className="text-stone-100"><TxLink hash={steps.claim.hash} testId="tx-claim" /></span></div>}
            </div>
            <p className="mt-3 text-[11px] text-stone-400">Your key lives in this browser only. Clearing site data loses access to this testnet account.</p>
          </Card>
        </motion.div>
      )}
    </div>
  );
}

function StepRow({ id, step }: { id: StepId; step: Step }) {
  const [title, sub] = LABELS[id];
  const icon = {
    idle: <CircleDashed className="h-5 w-5 text-zinc-300" />,
    running: <Loader2 className="h-5 w-5 animate-spin text-zinc-900" />,
    done: <Check className="h-5 w-5 text-emerald-700" />,
    error: <TriangleAlert className="h-5 w-5 text-red-700" />,
    skipped: <SkipForward className="h-5 w-5 text-zinc-400" />,
  }[step.status];
  return (
    <li className="flex gap-3" data-testid={`step-${id}`} data-status={step.status}>
      <span className="mt-0.5 shrink-0" aria-hidden>{icon}</span>
      <div className="min-w-0 flex-1">
        <div className={cx('text-sm font-medium', step.status === 'idle' ? 'text-zinc-400' : 'text-zinc-900')}>{title}</div>
        <div className="text-xs text-zinc-500">{step.note ?? sub}</div>
        {step.hash && <div className="mt-0.5"><TxLink hash={step.hash} testId={`tx-${id}`} /></div>}
        {step.error && <div className="mt-0.5 text-xs text-red-700">{step.error}</div>}
      </div>
    </li>
  );
}

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Lock, Inbox as InboxIcon } from './icons';
import type { Hex } from 'viem';
import { Button, Fingerprint, Notice, Pill, TxLink } from './ui';
import { ShareCard } from './share';
import { useAccount } from '../lib/account';
import { cancelDrop, closePool, confirmDrop, refundDrop } from '../lib/actions';
import { claimUrl4, linkId4 } from '../lib/claim4';
import { findSeed } from '../lib/links4';
import { isTerminal, type MyLink } from '../lib/hooks4';
import { explainError } from '../lib/api';
import { fmtQor } from '../lib/chain';
import { addrUrl } from '../lib/config';
import { fingerprint } from '../lib/protocol';

export function Empty({ text }: { text: string }) {
  return <div className="flex items-center gap-3 rounded-2xl border border-dashed border-zinc-300 p-4 text-sm text-zinc-500"><InboxIcon className="h-5 w-5 shrink-0" aria-hidden />{text}</div>;
}

export type OnTx = (key: string, t: { what: string; hash: string }) => void;

/** One-tap sender check: the 4 words of the recipient key; confirming is ONE ML-DSA intent from the Pocket (no second device). */
export function ConfirmCard({ m, onTx }: { m: MyLink; onTx: OnTx }) {
  const { actionCtx } = useAccount();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const d = m.drop!;
  const id = m.created.id;
  const words = fingerprint(d.recipientKeyHash);
  async function run(what: 'confirm' | 'cancel') {
    if (!actionCtx) return;
    setBusy(what); setErr(null);
    try {
      const r = what === 'confirm' ? await confirmDrop(actionCtx, id, d.recipientKeyHash) : await cancelDrop(actionCtx, id);
      onTx(`drop:${id}`, { what, hash: r.txHash });
      await qc.invalidateQueries({ queryKey: ['l4'] }); await qc.invalidateQueries({ queryKey: ['pocket'] });
    } catch (e) { setErr(explainError(e)); } finally { setBusy(null); }
  }
  return (
    <div className="space-y-3 rounded-3xl border border-amber-300 bg-amber-50/60 p-5 shadow-sm sm:p-6" data-testid={`confirm-panel-${id}`}>
      <p className="text-sm text-zinc-800"><strong>Someone opened link {linkId4(d.env, id)} ({fmtQor(d.amount)} QOR).</strong> Ask them for the 4 words on their screen. Confirm only if they are exactly these:</p>
      <Fingerprint words={words} testId={`fp-${id}`} />
      <Button block onClick={() => void run('confirm')} busy={busy === 'confirm'} disabled={!!busy || !actionCtx} data-testid={`confirm-${id}`} className="min-h-[52px] text-base"><Lock className="h-4 w-4" aria-hidden />The words match: Confirm</Button>
      <Button block variant="ghost" onClick={() => void run('cancel')} busy={busy === 'cancel'} disabled={!!busy || !actionCtx} data-testid={`cancel-bound-${id}`}>They differ: cancel and refund me</Button>
      <p className="text-xs text-zinc-600">Confirming signs one intent from your Pocket that names exactly this recipient key. After that you cannot cancel.</p>
      {err && <Notice tone="error">{err}</Notice>}
    </div>
  );
}

export function LinkRow({ m, tx, onTx }: { m: MyLink; tx?: { what: string; hash: string }; onTx: OnTx }) {
  const { actionCtx, root, env } = useAccount();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [share, setShare] = useState<string | null>(null);
  const c = m.created;
  const key = `${c.kind}:${c.id}`;
  const d = m.drop;
  const p = m.pool;
  const expiry = (d ?? p)?.expiry;
  const expired = expiry ? expiry * 1000 < Date.now() : false;
  async function run(what: string, fn: () => Promise<{ txHash: string }>) {
    setBusy(what); setErr(null);
    try { const x = await fn(); onTx(key, { what, hash: x.txHash }); await qc.invalidateQueries({ queryKey: ['l4'] }); await qc.invalidateQueries({ queryKey: ['pocket'] }); }
    catch (e) { setErr(explainError(e)); } finally { setBusy(null); }
  }
  async function showLink() {
    if (!root) return;
    setBusy('show'); setErr(null);
    try {
      const seed = await findSeed(root, env, c, 60);
      if (!seed) throw new Error('This link was not made with the key in this browser, so its link cannot be rebuilt here.');
      setShare(claimUrl4(window.location.origin, env, c.id, seed, c.kind === 'drop' ? 'c' : 'pool'));
    } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  }
  const state = d ? d.state : p ? (p.closed ? 'Closed' : p.taken >= p.slots ? 'Full' : 'Open') : '…';
  const note = c.kind === 'pool'
    ? (!p ? 'Reading from the chain…'
      : p.closed ? `${p.taken} of ${p.slots} slots taken (${fmtQor(BigInt(p.taken) * p.perSlot)} QOR paid out). ${p.taken < p.slots ? `The unclaimed ${fmtQor(BigInt(p.slots - p.taken) * p.perSlot)} QOR came back to your Pocket when the pool closed.` : 'Nothing was left to return.'}`
      : `${p.taken} of ${p.slots} slots taken, ${fmtQor(p.perSlot)} QOR each.`)
    : !d ? 'Reading from the chain…'
    : d.state === 'Open' ? 'Waiting for someone to open the link.'
    : d.state === 'Bound' ? (d.mode === 'Open' ? 'Opened. The receiver is setting up and will claim by themselves.' : 'Opened.')
    : d.state === 'Confirmed' ? 'You confirmed. They can claim now.'
    : d.state === 'Claimed' ? 'Delivered.' : 'The money went back to your Pocket.';
  const live = d ? !isTerminal(d.state) : p ? !p.closed : false;
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white/90 p-4 shadow-sm" data-testid={`link-${linkId4(env, c.id)}`} data-kind={c.kind} data-state={state}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-zinc-900">{c.kind === 'pool' ? 'Pool' : 'Drop'} {linkId4(env, c.id)} · {fmtQor(c.amountWei)} QOR{c.kind === 'drop' ? ` · ${c.mode === 'Open' ? 'Giveaway' : 'Confirmed'}` : ''}</span>
        <Pill tone={state === 'Claimed' || state === 'Full' ? 'ok' : isTerminal(state) || state === 'Closed' ? 'neutral' : 'warn'} testId={`state-${linkId4(env, c.id)}`}>{state}</Pill>
      </div>
      <p className="mt-1 text-sm text-zinc-600">{note}{d?.state === 'Claimed' && d.payTo && <> Paid into <a className="underline" href={addrUrl(d.payTo)} target="_blank" rel="noopener noreferrer" data-testid={`claimed-${linkId4(env, c.id)}`}>their Pocket</a>.</>}</p>
      {live && actionCtx && (
        <div className="mt-3 flex flex-wrap gap-2">
          {(d?.state === 'Open' || p) && <Button variant="secondary" busy={busy === 'show'} onClick={() => void showLink()} data-testid={`show-${linkId4(env, c.id)}`}>Show link</Button>}
          {d && (d.state === 'Open' || (d.state === 'Bound' && d.mode === 'Confirmed')) && <Button variant="danger" busy={busy === 'cancel'} onClick={() => void run('cancel', () => cancelDrop(actionCtx, c.id))} data-testid={`cancel-${linkId4(env, c.id)}`}>Cancel and refund</Button>}
          {p && !p.closed && <Button variant="danger" busy={busy === 'close'} onClick={() => void run('close', () => closePool(actionCtx, c.id))} data-testid={`close-${linkId4(env, c.id)}`}>Close pool and refund unclaimed</Button>}
        </div>
      )}
      {share && <div className="mt-3"><ShareCard url={share} id={linkId4(env, c.id)} kind={c.kind} amountText={fmtQor(p?.perSlot ?? c.amountWei)} headline="Your link" /></div>}
      {d && expired && live && <div className="mt-3"><Button variant="secondary" busy={busy === 'refund'} onClick={() => void run('refund', () => refundDrop(env, c.id))}>This link expired: refund it to my Pocket</Button></div>}
      {tx && <p className="mt-2 font-mono text-xs text-zinc-600">{tx.what} mined: <TxLink hash={tx.hash} testId={`tx-${tx.what}-${linkId4(env, c.id)}`} /></p>}
      {err && <div className="mt-2"><Notice tone="error">{err}</Notice></div>}
    </div>
  );
}

export const asHex = (x: string) => x as Hex;

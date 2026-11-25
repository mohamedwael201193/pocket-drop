import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Hex } from 'viem';
import { Button, Mono, Notice, Pill, TxLink } from './ui';
import { useAccount, usePocketView } from '../lib/account';
import { spend } from '../lib/actions';
import { genOf, predictPocket, previousOf, readPocket } from '../lib/v4';
import { fmtQor } from '../lib/chain';
import { addrUrl } from '../lib/config';
import { explainError } from '../lib/api';

/** What a move from the v4 Pocket sends now: everything up to today's allowance; the rest waits for the next day. */
export function planPreviousMove(balance: bigint, allowanceLeft: bigint): { now: bigint; later: bigint } {
  const now = balance < allowanceLeft ? balance : allowanceLeft;
  return { now, later: balance - now };
}

/**
 * The same key and settings give a different Pocket address on the v5 factory than on the v4 factory. If this key's v4
 * Pocket still holds QOR, say so and offer a one-tap move to the v5 Pocket (an ML-DSA-87 spend intent relayed through the
 * v4 router). Nothing is moved without the tap; the v4 Pocket stays usable either way.
 */
export function PreviousPocketCard() {
  const a = useAccount();
  const { data: pv } = usePocketView();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [tx, setTx] = useState<string | null>(null);
  const prevEnv = previousOf(a.env);
  const enabled = !!a.cfg && !!a.acct && genOf(a.env) === 'v5';
  const { data: old } = useQuery({
    queryKey: ['previous-pocket', prevEnv, a.cfg?.owner, a.cfg?.userSalt], enabled, refetchInterval: 30_000, retry: 1,
    queryFn: async () => {
      const address = await predictPocket(prevEnv, a.cfg!);
      return readPocket(prevEnv, address);
    },
  });
  if (!enabled || !old || old.balance === 0n || !pv) return null;
  const mine = !old.deployed || old.owner?.toLowerCase() === a.acct!.evm.toLowerCase();
  const plan = planPreviousMove(old.balance, old.deployed ? old.allowanceLeft : old.dailyLimit || old.balance);
  const move = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await spend({ env: prevEnv, cfg: a.cfg!, address: old.address as Hex, acct: a.acct! }, pv.address, plan.now);
      setTx(r.txHash ?? null);
      await qc.invalidateQueries();
    } catch (e) { setErr(explainError(e)); } finally { setBusy(false); }
  };
  return (
    <section className="rounded-3xl border border-amber-200 bg-amber-50/70 p-5" data-testid="previous-pocket">
      <div className="flex flex-wrap items-center gap-2"><h2 className="font-serif text-xl text-zinc-900">You have QOR on the previous contracts</h2><Pill tone="warn">v4</Pill></div>
      <p className="mt-2 text-sm text-zinc-700">Pocket Drop moved to the v5 contracts on 25 Nov 2026 (stricter signature checks). Your key&apos;s v4 Pocket <a className="underline" href={addrUrl(old.address)} target="_blank" rel="noopener noreferrer"><Mono>{old.address.slice(0, 10)}…{old.address.slice(-4)}</Mono></a> still holds <b>{fmtQor(old.balance)} QOR</b>. It keeps working, and you can move the QOR to your v5 Pocket <Mono>{pv.address.slice(0, 10)}…</Mono> with one signature.</p>
      {!mine ? <Notice tone="warn">That v4 Pocket now has a different owner (recovered or rotated), so this browser cannot move it.</Notice> : tx ? (
        <p className="mt-3 text-sm text-emerald-800" data-testid="previous-pocket-moved">Moved. <TxLink hash={tx} /></p>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button onClick={() => void move()} busy={busy} data-testid="previous-pocket-move" disabled={plan.now === 0n}>Move {fmtQor(plan.now)} QOR to v5</Button>
          {plan.later > 0n && <span className="text-xs text-zinc-600">{fmtQor(plan.later)} QOR is above today&apos;s limit and can be moved tomorrow.</span>}
        </div>
      )}
      {err && <Notice tone="error">{err}</Notice>}
    </section>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { Hex } from 'viem';
import { Button, Mono, Notice, Page, Pill, SourceBadge, TxLink } from '../components/ui';
import { ActivationCard } from '../components/account';
import { claimPoolSlot, linkId4, parseLinkId, poolClaimed, readPool } from '../lib/claim4';
import { useAccount, useKeyAccount } from '../lib/account';
import { defaultCfg, predictPocket } from '../lib/v4';
import { explainError } from '../lib/api';
import { fmtQor } from '../lib/chain';
import { addrUrl } from '../lib/config';
import { parseClaimFragment } from '../lib/protocol';
import { useBalance } from '../lib/queries';

/** /pool/:id#k=…  A Drop Pool slot goes to a distinct proof-of-possession ACCOUNT, not a person. The claimer needs a registered key. */
export default function PoolClaimPage() {
  const { id = '' } = useParams();
  const { hash } = useLocation();
  const p = parseLinkId(id);
  const seed = useMemo(() => parseClaimFragment(hash), [hash]);
  const a = useAccount();
  const key = useKeyAccount();
  const env = p && p.v === 4 ? p.env : 'prod';
  const pid = p && p.v === 4 ? p.id : 0n;
  const { data: pool, error } = useQuery({ queryKey: ['pool4', env, pid.toString()], enabled: !!p && p.v === 4, queryFn: () => readPool(env, pid), refetchInterval: 4000 });
  const [pocket, setPocket] = useState<Hex | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [tx, setTx] = useState<string | null>(null);
  useEffect(() => { let live = true; setPocket(null); if (a.acct) void predictPocket(env, defaultCfg(a.acct.evm as Hex)).then((x) => { if (live) setPocket(x); }); return () => { live = false; }; }, [a.acct, env]);
  const { data: bal } = useBalance(pocket ?? undefined, 3000);
  const { data: took } = useQuery({ queryKey: ['pool4-claimed', env, pid.toString(), a.acct?.evm], enabled: !!a.acct && !!p && p.v === 4, queryFn: () => poolClaimed(env, pid, a.acct!.evm as Hex), refetchInterval: 4000 });

  if (!p || p.v !== 4) return <Page narrow testId="pool-page"><Notice tone="error">This is not a Pocket Drop pool link.</Notice></Page>;
  if (!seed) return <Page narrow testId="pool-page"><Notice tone="error" testId="no-key">This link is missing its key. The long part after the # is required, so open the full link the sender shared.</Notice></Page>;
  if (error) return <Page narrow testId="pool-page"><Notice tone="error">{explainError(error)}</Notice></Page>;

  const open = !!pool && !pool.closed && pool.taken < pool.slots && pool.expiry * 1000 > Date.now();
  async function claim() {
    if (!a.acct || !pocket) return;
    setBusy(true); setErr(null);
    try { setTx((await claimPoolSlot(env, pid, seed!, a.acct, pocket)).txHash); }
    catch (e) { setErr(explainError(e)); } finally { setBusy(false); }
  }
  return (
    <Page narrow testId="pool-page">
      <div className="space-y-5">
        <div className="capsule-obsidian rounded-3xl p-6 text-stone-100">
          <div className="flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.2em] text-stone-400"><span>Drop Pool · {linkId4(env, pid)}{env === 'lab' ? ' · lab' : ''}</span><SourceBadge kind="LIVE" /></div>
          <div className="mt-3 text-sm text-stone-300">One slot is worth</div>
          <div className="font-serif text-5xl leading-none" data-testid="slot-amount">{pool ? fmtQor(pool.perSlot) : '…'}<span className="ml-2 text-xl text-stone-400">QOR</span></div>
          <div className="mt-2 font-mono text-[11px] text-stone-400" data-testid="pool-slots-left">{pool ? `${pool.slots - pool.taken} of ${pool.slots} slots left · self-funded by the host · Testnet` : 'Reading the pool…'}</div>
        </div>
        <Notice tone="info">Each slot goes to a <b>distinct proof-of-possession account, not a person</b>. One person can hold several accounts, so this is a way to share a little testnet QOR, not a count of people.</Notice>
        {pool && !open && <Notice tone="warn" testId="pool-closed">{pool.closed ? 'This pool is closed.' : pool.taken >= pool.slots ? 'Every slot is taken.' : 'This pool has expired.'}</Notice>}

        {!a.root && open && (
          <div className="space-y-3 rounded-3xl border border-zinc-200 bg-white/90 p-5 shadow-sm sm:p-6">
            <h1 className="font-serif text-3xl text-zinc-900">Take a slot</h1>
            <p className="text-sm text-zinc-600">A quantum-safe key is created in this browser. Your slot is paid into Your Pocket.</p>
            <Button block onClick={a.createKey} data-testid="pool-start" className="min-h-[52px] text-base">Create my key and Pocket</Button>
          </div>
        )}
        {a.root && open && !took && !tx && (
          <div className="space-y-4 rounded-3xl border border-zinc-200 bg-white/90 p-5 shadow-sm sm:p-6">
            <h1 className="font-serif text-3xl text-zinc-900">Take a slot</h1>
            <ActivationCard />
            {key.ready && <Button block busy={busy} disabled={!pocket} onClick={() => void claim()} data-testid="pool-claim" className="min-h-[52px] text-base">Take my slot ({pool ? fmtQor(pool.perSlot) : ''} QOR)</Button>}
            {err && <Notice tone="error" testId="pool-claim-error">{err}</Notice>}
          </div>
        )}
        {(took || tx) && pocket && (
          <div className="rounded-3xl border border-emerald-300 bg-emerald-50 p-5 sm:p-6" data-testid="pool-yours">
            <div className="flex items-center justify-between"><h1 className="font-serif text-3xl text-zinc-900">Slot taken.</h1><Pill tone="ok">paid</Pill></div>
            <div className="mt-2 font-serif text-5xl text-zinc-900" data-testid="pool-balance" data-wei={bal?.toString() ?? ''}>{bal === undefined ? '…' : fmtQor(bal)} <span className="text-xl text-zinc-500">QOR</span></div>
            <p className="mt-1 text-xs text-zinc-600">Balance of Your Pocket, read from the chain.</p>
            <div className="mt-3 space-y-1 text-xs text-zinc-700">
              <div>Your Pocket: <a className="underline" href={addrUrl(pocket)} target="_blank" rel="noopener noreferrer"><Mono>{pocket}</Mono></a></div>
              {tx && <div>Claim transaction: <TxLink hash={tx} testId="tx-pool-claim" /></div>}
            </div>
            <Link to="/pocket" className="mt-3 inline-flex min-h-[44px] items-center rounded-full bg-zinc-900 px-5 text-sm font-medium text-stone-50">Open my Pocket</Link>
          </div>
        )}
      </div>
    </Page>
  );
}

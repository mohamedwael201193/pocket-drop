import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Hex } from 'viem';
import { Button, Mono, Notice, Page, Pill, SourceBadge, TxLink } from '../components/ui';
import { Celebrate } from '../components/alive';
import { ActivationCard, KEY_ACCOUNT_MIN_WEI } from '../components/account';
import { claimPoolSlot, linkId4, parseLinkId, poolClaimed, readPool } from '../lib/claim4';
import { useAccount, useKeyAccount } from '../lib/account';
import { defaultCfg, predictPocket } from '../lib/v4';
import { explainError } from '../lib/api';
import { fmtQor, pub } from '../lib/chain';
import { addrUrl } from '../lib/config';
import { parseClaimFragment } from '../lib/protocol';
import { useBalance } from '../lib/queries';
import { useSponsorStatus } from '../lib/sponsor';

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
  const qc = useQueryClient();
  const { data: sponsor } = useSponsorStatus();
  // the slot is paid into the Pocket this key uses in the app (a custom or recovered one), else its default Pocket (P5)
  useEffect(() => {
    let live = true; setPocket(null);
    if (a.acct) {
      if (a.env === env && a.activePocket) setPocket(a.activePocket);
      else void predictPocket(env, defaultCfg(a.acct.evm as Hex)).then((x) => { if (live) setPocket(x); }).catch(() => undefined);
    }
    return () => { live = false; };
  }, [a.acct, a.env, a.activePocket, env]);
  const { data: bal } = useBalance(pocket ?? undefined, 3000);
  const { data: took } = useQuery({ queryKey: ['pool4-claimed', env, pid.toString(), a.acct?.evm], enabled: !!a.acct && !!p && p.v === 4, queryFn: () => poolClaimed(env, pid, a.acct!.evm as Hex), refetchInterval: 4000 });

  if (!p || p.v !== 4) return <PoolDeadEnd title="Not a pool link" testId="pool-invalid">This is not a Pocket Drop pool link. Pool links look like /pool/p12#k=…</PoolDeadEnd>;
  if (error) return <PoolDeadEnd title="Could not read this pool" testId="pool-error">{explainError(error)} Reload the page to try again.</PoolDeadEnd>;
  if (pool === null) return <PoolDeadEnd title="Pool not found" testId="pool-missing">There is no pool {linkId4(env, pid)} on this instance. Check that you opened the whole link, or ask the host for a new one.</PoolDeadEnd>;
  if (!seed) return <PoolDeadEnd title="This link is incomplete" testId="no-key">The link is missing its key: the long part after the # is required. Open the full link exactly as the host shared it.</PoolDeadEnd>;

  const open = !!pool && !pool.closed && pool.taken < pool.slots && pool.expiry * 1000 > Date.now();
  async function claim() {
    if (!a.acct || !pocket) return;
    setBusy(true); setErr(null);
    try {
      const before = await pub.getBalance({ address: pocket }).catch(() => 0n);
      const r = await claimPoolSlot(env, pid, seed!, a.acct, pocket);
      // show the paid balance, not a stale 0 (B-04)
      let after = before;
      for (let i = 0; i < 20 && pool && after < before + pool.perSlot; i++) { await new Promise((ok) => setTimeout(ok, 1500)); after = await pub.getBalance({ address: pocket }).catch(() => after); }
      qc.setQueryData(['balance', pocket], after);
      setTx(r.txHash);
    }
    catch (e) { setErr(explainError(e)); } finally { setBusy(false); }
  }
  return (
    <Page narrow testId="pool-page">
      <div className="space-y-5">
        <div className="capsule-obsidian rounded-3xl p-6 text-stone-100">
          <div className="flex items-center justify-between text-sm font-medium text-stone-300"><span>Drop Pool · {linkId4(env, pid)}{env === 'lab' ? ' · lab' : ''}</span><SourceBadge kind="LIVE" /></div>
          <div className="mt-3 text-sm text-stone-300">One slot is worth</div>
          <div className="font-money text-6xl sm:text-7xl leading-none" data-testid="slot-amount">{pool ? fmtQor(pool.perSlot) : <span className="inline-block h-10 w-28 animate-pulse rounded-xl bg-stone-700/70 align-middle" aria-label="Loading the pool" />}<span className="ml-2 text-xl text-stone-400">QOR</span></div>
          <div className="mt-2 font-mono text-xs text-stone-400" data-testid="pool-slots-left">{pool ? `${pool.slots - pool.taken} of ${pool.slots} slots left · self-funded by the host · Testnet` : <span className="inline-block h-3 w-48 animate-pulse rounded bg-stone-700/70 align-middle" aria-hidden />}</div>
        </div>
        <Notice tone="info">Each slot goes to a <b>distinct proof-of-possession account, not a person</b>. One person can hold several accounts, so this is a way to share a little testnet QOR, not a count of people.</Notice>
        {pool && !open && !took && !tx && <h1 className="font-serif text-3xl text-zinc-900">{pool.closed ? 'This pool is closed' : pool.taken >= pool.slots ? 'No slots left' : 'This pool has expired'}</h1>}
        {pool && !open && <Notice tone="warn" testId="pool-closed">{pool.closed ? 'This pool is closed.' : pool.taken >= pool.slots ? 'Every slot is taken.' : 'This pool has expired.'}</Notice>}

        {!a.root && open && (
          <div className="space-y-3 rounded-3xl border border-zinc-200 bg-white/90 p-5 shadow-sm sm:p-6">
            <h1 className="font-serif text-3xl text-zinc-900">Take a slot</h1>
            <p className="text-sm text-zinc-600">A quantum-safe key is created in this browser and your slot is paid into Your Pocket. Before the slot you register your key once. {sponsor?.enabled
              ? <span data-testid="pool-sponsored-note">Pocket Drop covers that one-time fee ({fmtQor(sponsor.amountWei)} QOR) for new accounts, so you need no QOR at all.</span>
              : <>That needs about {fmtQor(KEY_ACCOUNT_MIN_WEI)} QOR, free from the testnet faucet (the next step shows the address and a QR).</>}</p>
            <Button block onClick={a.createKey} data-testid="pool-start" className="min-h-[52px] text-base">Create my key and Pocket</Button>
          </div>
        )}
        {a.root && open && !took && !tx && (
          <div className="space-y-4 rounded-3xl border border-zinc-200 bg-white/90 p-5 shadow-sm sm:p-6">
            <h1 className="font-serif text-3xl text-zinc-900">Take a slot</h1>
            <ActivationCard pool={{ env, id: pid, seed: seed!, payTo: pocket }} />
            {key.ready && <Button block busy={busy} disabled={!pocket} onClick={() => void claim()} data-testid="pool-claim" className="min-h-[52px] text-base">Take my slot ({pool ? fmtQor(pool.perSlot) : ''} QOR)</Button>}
            {err && <Notice tone="error" testId="pool-claim-error">{err}</Notice>}
          </div>
        )}
        {(took || tx) && pocket && (
          <div className="rounded-3xl border border-emerald-300 bg-emerald-50 p-5 sm:p-6" data-testid="pool-yours">
            <Celebrate once={`pool-${env}-${pid}`} />
            <div className="flex items-center justify-between"><h1 className="font-serif text-3xl text-zinc-900">Slot taken.</h1><Pill tone="ok">paid</Pill></div>
            <div className="mt-2 font-money text-5xl text-zinc-900" data-testid="pool-balance" data-wei={bal?.toString() ?? ''}>{bal === undefined ? <span className="inline-block h-10 w-28 animate-pulse rounded-xl bg-emerald-200/70 align-middle" aria-label="Reading your balance" /> : fmtQor(bal)} <span className="text-xl text-zinc-500">QOR</span></div>
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

/** A pool link that cannot be used: one heading, the reason, and where to go next (P2, B-10). */
function PoolDeadEnd({ title, testId, children }: { title: string; testId: string; children: ReactNode }) {
  return (
    <Page narrow testId="pool-page">
      <div className="space-y-4">
        <h1 className="font-serif text-3xl text-zinc-900">{title}</h1>
        <Notice tone="error" testId={testId}>{children}</Notice>
        <div className="flex flex-wrap gap-2 text-sm">
          <Link to="/receive" className="inline-flex min-h-[44px] items-center rounded-full border border-zinc-300 bg-white px-5 font-medium text-zinc-900">Paste another link</Link>
          <Link to="/" className="inline-flex min-h-[44px] items-center rounded-full px-4 text-zinc-700 underline">What is Pocket Drop?</Link>
        </div>
      </div>
    </Page>
  );
}

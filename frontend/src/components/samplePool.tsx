import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Gift } from './icons';
import { Pill, SourceBadge } from './ui';
import sample from '../data/sample-pool.json';
import { readPool } from '../lib/claim4';
import { samplePoolShare } from '../lib/share';
import { SharePanel } from './sharePanel';

export const SAMPLE_POOL_ID = BigInt(sample.poolId);
// The sample pool was created on the v4 (previous) production contracts; its link id keeps the v4 prefix p.
export const SAMPLE_ENV = 'prodV4' as const;
export const isSamplePool = (env: string, id: bigint) => env === SAMPLE_ENV && id === SAMPLE_POOL_ID;

/** "No link yet?": a standing pool the team funded from its own test Pocket, so a visitor can try receiving without a friend. */
export function SamplePoolCard({ compact }: { compact?: boolean }) {
  const { data: pool } = useQuery({ queryKey: ['pool4', SAMPLE_ENV, sample.poolId.toString()], queryFn: () => readPool(SAMPLE_ENV, SAMPLE_POOL_ID), refetchInterval: 15_000 });
  const left = pool ? pool.slots - pool.taken : null;
  const open = !!pool && !pool.closed && left! > 0 && pool.expiry * 1000 > Date.now();
  return (
    <section className="rounded-3xl border border-dashed border-zinc-300 bg-white/80 p-5 sm:p-6" data-testid="sample-pool">
      <div className="flex flex-wrap items-center gap-2"><Gift className="h-5 w-5 text-zinc-700" aria-hidden /><h2 className="font-serif text-xl text-zinc-900">No link yet? Try a sample</h2><Pill tone="dark" testId="sample-pool-label">TEAM-HOSTED sample</Pill></div>
      <p className="mt-2 text-sm leading-relaxed text-zinc-700">
        The PocketDrop team put {sample.slots} slots of {sample.perSlotQor} testnet QOR in a Drop Pool from its own test Pocket, so you can try receiving without waiting for a friend. Opening it creates your quantum-safe key and your Pocket{compact ? '' : '; the first key setup is paid by our sponsor while its balance lasts'}.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Link to={sample.path} className="btn-b inline-flex min-h-[44px] items-center rounded-full bg-zinc-900 px-5 text-sm font-medium text-white" data-testid="sample-pool-open">Open the sample pool</Link>
        <span className="font-mono text-xs text-zinc-600" data-testid="sample-pool-left">
          {pool ? (open ? `${left} of ${pool.slots} slots left` : 'all slots used or the pool has ended') : 'reading the pool…'} <SourceBadge kind="LIVE" />
        </span>
      </div>
      {open && <SharePanel spec={samplePoolShare(window.location.origin, left)} testId="sample-share" label="Share the sample with someone" />}
      {!compact && <p className="mt-2 text-xs text-zinc-500">Pool p{sample.poolId}, funded {sample.totalQor} QOR, open until {new Date(sample.expiresAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}. Testnet QOR has no monetary value.</p>}
    </section>
  );
}

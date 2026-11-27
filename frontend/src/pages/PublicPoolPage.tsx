import { Link, Navigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Notice, Page, PageTitle } from '../components/ui';
import { parseClaimFragment } from '../lib/protocol';
import { parseLinkId, readPool } from '../lib/claim4';
import { PUBLIC_POOL } from '../lib/publicPool';

/** /pool (no id): resolve the current public pool and open its claim page, or show a clear empty state. Never a 404. */
export default function PublicPoolPage() {
  const raw = PUBLIC_POOL.path ?? '';
  const hashIdx = raw.indexOf('#');
  const pathname = hashIdx >= 0 ? raw.slice(0, hashIdx) : raw;
  const hash = hashIdx >= 0 ? raw.slice(hashIdx) : '';
  const id = pathname.split('/').filter(Boolean).pop() ?? '';
  const parsed = parseLinkId(id);
  const seed = parseClaimFragment(hash);
  const ready = !!parsed && parsed.v === 4 && !!seed;
  const env = ready && parsed.v === 4 ? parsed.env : 'prod';
  const pid = ready && parsed.v === 4 ? parsed.id : 0n;
  const { data: pool, isLoading, isFetched } = useQuery({
    queryKey: ['pool4', env, pid.toString()],
    enabled: ready,
    queryFn: () => readPool(env, pid),
    refetchInterval: 15_000,
  });
  const open = !!pool && !pool.closed && pool.taken < pool.slots && pool.expiry * 1000 > Date.now();

  if (!ready || (isFetched && !open)) return <PublicPoolEmpty />;
  if (isLoading || !pool) {
    return (
      <Page narrow testId="pool-page">
        <p className="text-sm text-zinc-600" data-testid="public-pool-loading">Reading the public pool…</p>
      </Page>
    );
  }
  return <Navigate to={raw} replace />;
}

function PublicPoolEmpty() {
  return (
    <Page narrow testId="pool-page">
      <div className="space-y-4">
        <PageTitle eyebrow="Receive" title="This pool is empty, new one soon" />
        <Notice tone="info" testId="public-pool-empty">This public pool has no slots left, or a new one is being prepared. You can still receive QOR with a link someone sends you.</Notice>
        <Link to="/receive" className="inline-flex min-h-[44px] items-center rounded-full border border-zinc-300 bg-white px-5 text-sm font-medium text-zinc-900">Paste a link on Receive</Link>
      </div>
    </Page>
  );
}

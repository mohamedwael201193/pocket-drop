import { useQueries, useQuery } from '@tanstack/react-query';
import type { Hex } from 'viem';
import { useAccount } from './account';
import { readDrop, readPool, type DropLink4, type Pool4 } from './claim4';
import { scanCreated, type Created } from './links4';

export type MyLink = { created: Created; drop?: DropLink4 | null; pool?: Pool4 | null };
const TERMINAL = ['Claimed', 'Cancelled', 'Refunded'];
export const isTerminal = (s?: string) => !!s && TERMINAL.includes(s);

/** The active Pocket's drops and pools with their live on-chain state. */
export function useMyLinks() {
  const { env, activePocket } = useAccount();
  const scan = useQuery({ queryKey: ['mylinks', env, activePocket], enabled: !!activePocket, refetchInterval: 20_000, queryFn: () => scanCreated(env, activePocket as Hex) });
  const created = scan.data ?? [];
  const states = useQueries({
    queries: created.map((c) => ({
      queryKey: ['l4', env, c.kind, c.id.toString()],
      queryFn: () => (c.kind === 'drop' ? readDrop(env, c.id) : readPool(env, c.id)),
      refetchInterval: (q: { state: { data?: DropLink4 | Pool4 | null } }) => {
        const d = q.state.data as DropLink4 | Pool4 | null | undefined;
        if (c.kind === 'drop') return isTerminal((d as DropLink4 | null | undefined)?.state) ? false : 4000;
        return d && (d as Pool4).closed ? false : 6000;
      },
    })),
  });
  const links: MyLink[] = created.map((c, i) => ({ created: c, drop: c.kind === 'drop' ? (states[i]?.data as DropLink4 | null | undefined) : undefined, pool: c.kind === 'pool' ? (states[i]?.data as Pool4 | null | undefined) : undefined }));
  return { links, loading: scan.isLoading, refetch: scan.refetch };
}

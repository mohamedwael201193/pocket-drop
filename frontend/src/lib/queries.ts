import { useQuery } from '@tanstack/react-query';
import type { Hex } from 'viem';
import { fetchHealth, fetchLink, fetchStats } from './api';
import { getBalance } from './chain';

export const useBalance = (address?: Hex, every = 4000) =>
  useQuery({ queryKey: ['balance', address], queryFn: () => getBalance(address!), enabled: !!address, refetchInterval: every });

export const useLink = (id?: string, every: number | false = 4000) =>
  useQuery({ queryKey: ['link', id], queryFn: () => fetchLink(id!), enabled: !!id, refetchInterval: every, retry: 1 });

export const useStats = () => useQuery({ queryKey: ['stats'], queryFn: fetchStats, refetchInterval: 30_000 });
export const useHealth = () => useQuery({ queryKey: ['health'], queryFn: fetchHealth, refetchInterval: 30_000 });

/** The most recent claimed link, read from the API: real amount, drip, mode and the 4 words derived from its on-chain recipient key hash. */
export const useLatestDrop = () => {
  const { data: s } = useStats();
  const ev = s?.recent.find((e) => e.kind === 'claimed' && e.linkId);
  const id = ev?.linkId ?? undefined;
  const { data: link } = useQuery({ queryKey: ['latest-drop', id], queryFn: () => fetchLink(id!), enabled: !!id, staleTime: 60_000 });
  return { id, link, txHash: ev?.txHash };
};

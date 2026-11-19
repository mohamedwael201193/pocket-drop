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

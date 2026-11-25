import { createContext, useContext, useEffect, useState } from 'react';
import snapshot from './data/snapshot.json';
import { API_BASE } from './links';

type Inst = { pockets: number; drops: { claimed: number; created: number }; pools: { created: number; slotsClaimed: number }; hybridRelayEvents?: number };
export type Bait = { id: string; description: string; pocket: string; pocketWei: string; deployed: boolean; alarm: unknown[]; classicalKey?: string };
export type Row = { tx: string; height: number; bait: string; call: string; failed: boolean; lane?: string; time?: string };
export interface LiveState {
  /** 'live' once every call answered on this visit; 'snapshot' while waiting or when the API is down (values we captured earlier). */
  source: 'live' | 'snapshot';
  capturedAt: string;
  headBlock: number | null;
  relayHybrid: boolean; classicalOpen: boolean;
  pockets: number; linksClaimed: number; slotsClaimed: number; hybridEvents: number;
  baits: Bait[]; refused: Row[]; alarm: boolean;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- API payloads are read defensively field by field */
export const derive = (h: any, s: any, q: any, source: LiveState['source'], capturedAt: string): LiveState => {
  const inst = Object.values(s?.v4 ?? {}).filter((x: any) => x && typeof x === 'object' && 'pockets' in x) as Inst[];
  const sum = (f: (i: Inst) => number) => inst.reduce((n, i) => n + (f(i) || 0), 0);
  return {
    source, capturedAt,
    headBlock: h?.headBlock ? Number(h.headBlock) : null,
    relayHybrid: h?.relay?.mode === 'hybrid', classicalOpen: !!h?.relay?.classicalPathOpen,
    pockets: sum((i) => i.pockets), linksClaimed: sum((i) => i.drops?.claimed), slotsClaimed: sum((i) => i.pools?.slotsClaimed), hybridEvents: sum((i) => i.hybridRelayEvents ?? 0),
    baits: Array.isArray(q?.baits) ? q.baits : [], refused: (q?.log?.onChain?.rows ?? []).filter((r: Row) => r.failed), alarm: !!q?.alarm?.raised,
  };
};
/* eslint-enable @typescript-eslint/no-explicit-any */

export const SNAPSHOT: LiveState = derive(snapshot.health, snapshot.stats, snapshot.qday, 'snapshot', snapshot.capturedAt);
const get = (p: string, signal: AbortSignal) => fetch(API_BASE + p, { signal }).then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); });

/** Reads /api/health, /api/stats and /api/qday once on load and every 60 s. Until all three answer, the snapshot stays (labelled). */
export function useLive(): LiveState {
  const [st, setSt] = useState<LiveState>(SNAPSHOT);
  useEffect(() => {
    const ac = new AbortController();
    const run = async () => {
      try {
        const [h, s, q] = await Promise.all([get('/api/health', ac.signal), get('/api/stats', ac.signal), get('/api/qday', ac.signal)]);
        if (h?.ok) setSt(derive(h, s, q, 'live', h.time ?? new Date().toISOString()));
      } catch { /* API down or slow: keep the labelled snapshot */ }
    };
    void run();
    const t = setInterval(run, 60_000);
    return () => { ac.abort(); clearInterval(t); };
  }, []);
  return st;
}
export const qor = (wei: string) => (Number(BigInt(wei) / 10n ** 14n) / 1e4).toFixed(2);

export const LiveCtx = createContext<LiveState>(SNAPSHOT);
export const useLiveData = () => useContext(LiveCtx);

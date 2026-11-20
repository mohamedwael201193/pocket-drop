// Sponsored onboarding (client side). A brand-new key account asks /api/sponsor for exactly the one-time registration fee:
// a pool claimer proves the pool link, a new sender proves a funded fresh Pocket. When the sponsor is off, capped or
// refuses, the activation card falls back to the faucet / QR flow. Logic only: no styling here.
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Hex } from 'viem';
import { z } from 'zod';
import { API_BASE } from './config';
import { useAccount, useKeyAccount } from './account';
import { useBalance } from './queries';
import { poolLinkProof } from './claim4';
import type { Env } from './v4';

const statusSchema = z.object({
  ok: z.literal(true), enabled: z.boolean(), reason: z.string().optional(), remainingToday: z.number().optional(),
  amountWei: z.string(), senderMinPocketWei: z.string(), sponsor: z.string().optional(),
}).passthrough();
export type SponsorStatus = { enabled: boolean; reason?: string; remainingToday?: number; amountWei: bigint; senderMinPocketWei: bigint };

export async function fetchSponsorStatus(): Promise<SponsorStatus> {
  const r = await fetch(`${API_BASE}/api/sponsor`);
  const j = statusSchema.parse(await r.json());
  return { enabled: j.enabled, reason: j.reason, remainingToday: j.remainingToday, amountWei: BigInt(j.amountWei), senderMinPocketWei: BigInt(j.senderMinPocketWei) };
}
export const useSponsorStatus = () => useQuery({ queryKey: ['sponsor-status'], queryFn: fetchSponsorStatus, staleTime: 60_000, retry: 1 });

export type SponsorBody =
  | { kind: 'pool'; env: Env; poolId: string; recipient: Hex; payTo: Hex; linkPk: Hex; linkSig: Hex }
  | { kind: 'sender'; env: Env; owner: Hex; guardians: Hex[]; threshold: number; dailyLimit: string; userSalt: Hex };
export type SponsorReply = { ok: true; txHash: string; amountWei: string } | { ok: false; name: string; message: string };

export async function requestSponsor(body: SponsorBody): Promise<SponsorReply> {
  try {
    const r = await fetch(`${API_BASE}/api/sponsor`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => null);
    if (r.ok && j?.ok && j.txHash) return { ok: true, txHash: String(j.txHash), amountWei: String(j.amountWei) };
    return { ok: false, name: j?.error?.name ?? `HTTP ${r.status}`, message: j?.error?.message ?? 'The sponsor did not answer.' };
  } catch {
    return { ok: false, name: 'Network', message: 'Could not reach the sponsor.' };
  }
}

/** A key account holding less than this counts as brand new (same rule as the API). */
export const SPONSOR_DUST_WEI = 1_000_000_000_000_000n;

export type SponsorPhase = 'off' | 'not-needed' | 'waiting-pocket' | 'asking' | 'sent' | 'refused';
export interface PoolProofInput { env: Env; id: bigint; seed: Uint8Array; payTo: Hex | null }

/**
 * Decides whether this key account can be sponsored and asks once per account and browser session.
 * - pool: as soon as the claimer's key exists and the payout Pocket is known;
 * - sender (no `pool`): once the app's default Pocket holds `senderMinPocketWei` and was never used.
 */
export function useSponsoredSetup(pool?: PoolProofInput | null) {
  const a = useAccount();
  const k = useKeyAccount();
  const { data: st } = useSponsorStatus();
  const usesDefault = !!a.pocket && a.activePocket === a.pocket;
  const { data: pocketBal } = useBalance(!pool && usesDefault ? (a.pocket ?? undefined) : undefined, 4000);
  const [phase, setPhase] = useState<SponsorPhase>('off');
  const [txHash, setTx] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const asked = useRef<string | null>(null);

  const evm = a.acct?.evm as Hex | undefined;
  const fresh = !!evm && !!k.status && !k.status.registered && k.balance !== undefined && k.balance < SPONSOR_DUST_WEI;
  const kind: 'pool' | 'sender' | null = pool ? (pool.payTo ? 'pool' : null) : (a.cfg && usesDefault ? 'sender' : null);
  const pocketReady = kind === 'sender' && st ? (pocketBal ?? 0n) >= st.senderMinPocketWei : false;
  const flag = evm ? `pd.sponsor.asked.${evm.toLowerCase()}` : '';
  const triedBefore = () => { try { return !!flag && sessionStorage.getItem(flag) === '1'; } catch { return false; } };

  useEffect(() => {
    if (phase === 'asking' || phase === 'sent' || phase === 'refused') return;
    if (k.ready || !st) { setPhase(k.ready ? 'not-needed' : 'off'); return; }
    if (!st.enabled || !kind || !evm) { setPhase('off'); return; }
    if (!fresh) { setPhase(k.status && k.balance !== undefined ? 'not-needed' : 'off'); return; }
    if (kind === 'sender' && !pocketReady) { setPhase('waiting-pocket'); return; }
    if (asked.current === evm || triedBefore()) return;
    asked.current = evm;
    try { sessionStorage.setItem(flag, '1'); } catch { /* private mode */ }
    setPhase('asking');
    void (async () => {
      let body: SponsorBody;
      if (kind === 'pool' && pool?.payTo) {
        const proof = await poolLinkProof(pool.env, pool.id, pool.seed, evm, pool.payTo);
        body = { kind: 'pool', env: pool.env, poolId: pool.id.toString(), recipient: evm, payTo: pool.payTo, ...proof };
      } else {
        const c = a.cfg!;
        body = { kind: 'sender', env: a.env, owner: c.owner, guardians: c.guardians, threshold: c.threshold, dailyLimit: c.limit.toString(), userSalt: c.userSalt };
      }
      const r = await requestSponsor(body);
      if (r.ok) { setTx(r.txHash); setPhase('sent'); }
      else if (r.name === 'PocketNotFunded') {
        // our RPC saw the funds before the API's node did: ask again shortly
        setTimeout(() => { asked.current = null; try { sessionStorage.removeItem(flag); } catch { /* ignore */ } setPhase('waiting-pocket'); }, 8000);
      } else { setMessage(r.message); setPhase('refused'); }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st, kind, evm, fresh, pocketReady, k.ready, phase]);

  return {
    phase, txHash, message,
    /** True while the sponsor is (or will be) paying the setup: the "fund your key account" steps become a fallback. */
    covering: phase === 'waiting-pocket' || phase === 'asking' || phase === 'sent',
    amountWei: st?.amountWei ?? null,
    senderMinPocketWei: st?.senderMinPocketWei ?? null,
  };
}

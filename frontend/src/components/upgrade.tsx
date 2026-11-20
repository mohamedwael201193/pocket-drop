import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ShieldAlert } from './icons';
import type { Hex } from 'viem';
import { Button, Notice, TxLink } from './ui';
import { useAccount, usePocketView } from '../lib/account';
import { deriveAccount, finishUpgrade, legacyRoots, pendingUpgradeRoot } from '../lib/identity';
import { isLegacyRoot } from '../lib/keyderive';
import { spend } from '../lib/actions';
import { defaultCfg, predictPocket } from '../lib/v4';
import { fmtQor } from '../lib/chain';
import { explainError } from '../lib/api';

/** Gas money sent to the NEW key account so it can register its ML-DSA key (registration fee + tx fee + margin). */
export const UPGRADE_KEY_FUNDING_WEI = 100_000_000_000_000_000n; // 0.1 QOR

/** What the move sends now: key-account funding first, the rest to the new Pocket, both within today's allowance. */
export function planMove(balance: bigint, allowanceLeft: bigint): { fund: bigint; rest: bigint; leftBehind: bigint } {
  const cap = balance < allowanceLeft ? balance : allowanceLeft;
  if (cap <= UPGRADE_KEY_FUNDING_WEI) return { fund: cap, rest: 0n, leftBehind: balance - cap };
  return { fund: UPGRADE_KEY_FUNDING_WEI, rest: cap - UPGRADE_KEY_FUNDING_WEI, leftBehind: balance - cap };
}

/**
 * Legacy browser keys (created before 20 Nov 2026) derived the ML-DSA key from the classical key, so a stolen or
 * quantum-recovered classical key could sign Pocket intents. This card says so plainly and moves the funds to a Pocket of
 * a new v2 key (independent keys). The new key is saved BEFORE any money moves, so closing the tab never strands funds.
 */
export function LegacyKeyBanner() {
  const a = useAccount();
  const { data: pv } = usePocketView();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [txs, setTxs] = useState<{ what: string; hash: string }[]>([]);
  const [done, setDone] = useState<string | null>(null);
  const prior = legacyRoots();

  if (!a.root || !isLegacyRoot(a.root) || a.activePocket !== a.pocket) {
    return prior.length > 0 && a.root && !isLegacyRoot(a.root) ? (
      <p className="text-xs text-zinc-500" data-testid="legacy-note">This browser also keeps {prior.length} older key{prior.length > 1 ? 's' : ''} (not quantum-safe). Restore one from its backup only to empty its Pocket.</p>
    ) : null;
  }

  const allowance = pv ? (pv.deployed ? pv.allowanceLeft : a.cfg?.limit ?? 0n) : 0n;
  const plan = pv ? planMove(pv.balance, allowance) : null;

  async function move() {
    if (!a.actionCtx || !a.root || !pv || !plan) return;
    setBusy(true); setErr(null);
    const legacy = a.root;
    try {
      const next = pendingUpgradeRoot();
      const na = await deriveAccount(next);
      const np = await predictPocket(a.env, defaultCfg(na.evm as Hex));
      const out: { what: string; hash: string }[] = [];
      if (plan.fund > 0n) { const r = await spend(a.actionCtx, na.evm as Hex, plan.fund); out.push({ what: 'gas money to the new key', hash: r.txHash }); setTxs([...out]); }
      if (plan.rest > 0n) { const r = await spend(a.actionCtx, np, plan.rest); out.push({ what: 'funds to the new Pocket', hash: r.txHash }); setTxs([...out]); }
      finishUpgrade(legacy);
      setDone(np);
      await qc.invalidateQueries();
    } catch (e) { setErr(explainError(e)); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-3" data-testid="legacy-key-banner">
      <Notice tone="error">
        <span className="flex items-start gap-2"><ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span><b>This Pocket is not quantum-safe. Move your funds.</b> It belongs to an older browser key whose quantum-safe key can be computed from its ordinary key. Anyone who learns the ordinary key (a leak today, or a quantum computer later) could move this money. One tap moves it to a Pocket of a new key with two independent keys.</span>
        </span>
      </Notice>
      {plan && (
        <p className="text-sm text-zinc-700" data-testid="legacy-plan">
          {pv!.balance === 0n ? 'This Pocket is empty: switching only creates the new key.' : <>Sends {fmtQor(plan.fund)} QOR to the new key (for its one-time registration) and {fmtQor(plan.rest)} QOR to the new Pocket.</>}
          {plan.leftBehind > 0n && <> {fmtQor(plan.leftBehind)} QOR is above today&apos;s limit and stays behind: restore this old key from its backup tomorrow and move it again.</>}
        </p>
      )}
      <Button block variant="danger" busy={busy} disabled={!a.actionCtx || !pv || (pv?.frozen ?? false)} onClick={() => void move()} data-testid="legacy-move">Move to a new quantum-safe key</Button>
      <p className="text-xs text-zinc-500">Back up the old key first if you may need it again (Backup key, below). After the move, this browser uses the new key; back that one up too.</p>
      {txs.map((t) => <p key={t.hash} className="font-mono text-xs text-zinc-600">{t.what}: <TxLink hash={t.hash} /></p>)}
      {err && <Notice tone="error" testId="legacy-error">{err}</Notice>}
      {done && <Notice tone="ok" testId="legacy-done">Done. Your new Pocket is <span className="font-mono">{done}</span>. Register the new key below, then back it up.</Notice>}
    </div>
  );
}

/** Thin site-wide strip for a legacy key, pointing to the move on the Pocket page (hidden there and on the landing page). */
export function LegacyKeyStrip({ path }: { path: string }) {
  const a = useAccount();
  if (!a.root || !isLegacyRoot(a.root) || path === '/' || path.startsWith('/pocket')) return null;
  return (
    <div className="border-b border-red-300 bg-red-50 px-4 py-2 text-center text-sm text-red-900" data-testid="legacy-key-strip">
      <b>Your Pocket is not quantum-safe</b> (older browser key). <Link to="/pocket" className="underline">Move your funds to a new key</Link>.
    </div>
  );
}

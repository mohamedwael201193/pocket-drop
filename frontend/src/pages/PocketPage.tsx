import { useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { isAddress, type Hex } from 'viem';
import { Button, CopyButton, Mono, Notice, Page, PageTitle, Pill, SourceBadge, StepCard, TxLink, cx } from '../components/ui';
import { ActivationCard, BackupCard, ConnectChoices, PocketCard } from '../components/account';
import { LegacyKeyBanner } from '../components/upgrade';
import { ChevronDown } from '../components/icons';
import { RescuePanel } from '../components/rescue';
import { HelpFriend, LostPhone } from '../components/guardians';
import { useAccount, useKeyAccount, usePocketView } from '../lib/account';
import { applyGuardians, applyLimit, cancelPending, executeQueued, finalizeRecovery, setGuardians, setLimit, spend, vetoQueued, vetoRecovery } from '../lib/actions';
import { INST, chainTimestamp, type Env } from '../lib/v4';
import { explainError, type RouteResult } from '../lib/api';
import { fmtQor, parseQor } from '../lib/chain';
import { addrUrl } from '../lib/config';
import { useBalance } from '../lib/queries';

/** busy / error / last tx for one action button. */
function useAct() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tx, setTx] = useState<{ what: string; hash: string } | null>(null);
  async function run(what: string, fn: () => Promise<RouteResult>) {
    setBusy(what); setErr(null);
    try { const r = await fn(); setTx({ what, hash: r.txHash }); await qc.invalidateQueries({ queryKey: ['pocket'] }); await qc.invalidateQueries({ queryKey: ['balance'] }); }
    catch (e) { setErr(explainError(e)); } finally { setBusy(null); }
  }
  return { busy, err, tx, run };
}
const ActResult = ({ act, testId }: { act: ReturnType<typeof useAct>; testId: string }) => (
  <>
    {act.err && <div className="mt-3"><Notice tone="error" testId={`${testId}-error`}>{act.err}</Notice></div>}
    {act.tx && <p className="mt-3 font-mono text-xs text-zinc-600">{act.tx.what} mined: <TxLink hash={act.tx.hash} testId={`${testId}-tx`} check /> <SourceBadge kind="LIVE" /></p>}
  </>
);

function Section({ title, badge, testId, children }: { title: string; badge?: ReactNode; testId: string; children: ReactNode }) {
  return (
    <section data-testid={testId} className="rounded-3xl border border-zinc-200 bg-white/90 p-5 shadow-sm sm:p-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 className="font-serif text-2xl text-zinc-900">{title}</h2>{badge}</div>
      {children}
    </section>
  );
}
const dur = (s: number) => (s <= 0 ? 'now' : s < 90 ? `${s} s` : s < 5400 ? `${Math.round(s / 60)} min` : s < 172800 ? `${Math.round(s / 3600)} h` : `${Math.round(s / 86400)} days`);
const short = (a: string) => `${a.slice(0, 8)}…${a.slice(-6)}`;

export default function PocketPage() {
  const a = useAccount();
  const key = useKeyAccount();
  const { data: pv } = usePocketView();
  const { data: now } = useQuery({ queryKey: ['chain-now'], queryFn: chainTimestamp, refetchInterval: 5000 });
  const t = now ?? Math.floor(Date.now() / 1000);
  const inst = INST[a.env];
  const ctx = a.actionCtx;
  const owned = !!pv && !!a.acct && pv.owner?.toLowerCase() === a.acct.evm.toLowerCase();
  const canAct = !!ctx && key.ready && (!pv?.deployed || owned);

  const spendAct = useAct(); const limitAct = useAct(); const guardAct = useAct(); const queueAct = useAct(); const recAct = useAct();
  const [to, setTo] = useState(''); const [amt, setAmt] = useState('');
  const [newLimit, setNewLimit] = useState('');
  const [gText, setGText] = useState(''); const [gThr, setGThr] = useState('2');

  const spendAmt = parseQor(amt);
  const spendProblem = !isAddress(to) ? 'Enter the 0x address to send to.' : spendAmt === null || spendAmt === 0n ? 'Enter an amount like 0.1.' : pv && spendAmt > pv.balance ? `Your Pocket holds ${fmtQor(pv.balance)} QOR.` : null;
  const queuedWarn = pv?.deployed && spendAmt !== null && spendAmt > pv.allowanceLeft ? `Above the ${fmtQor(pv.allowanceLeft)} QOR left today: it will wait ${dur(inst.timelockSec)} before going out, and you can cancel it (veto) until then.` : null;
  const gList = gText.split(/[\s,;]+/).filter(Boolean);
  const gProblem = gList.length < 2 || gList.length > 5 ? 'Add 2 to 5 guardian addresses.' : gList.some((g) => !isAddress(g)) ? 'Every guardian must be a 0x address.'
    : new Set(gList.map((g) => g.toLowerCase())).size !== gList.length ? 'A guardian is listed twice.'
    : a.acct && gList.some((g) => g.toLowerCase() === a.acct!.evm.toLowerCase()) ? 'You cannot be your own guardian.'
    : Number(gThr) < 2 || Number(gThr) > gList.length ? 'The threshold must be at least 2 and at most the number of guardians.' : null;
  const limitVal = parseQor(newLimit);

  return (
    <Page narrow form testId="pocket-page">
      <PageTitle eyebrow="Pocket" title="Your Pocket">Your money, which only your quantum-safe key can move. Big spends wait so you can stop them, and people you trust can pause it or move it to a new phone. Everything here is a real on-chain action on testnet.</PageTitle>
      <div className="space-y-5">
        <StepCard n={1} title="Pocket and key" done={key.ready && !!pv && pv.balance > 0n} testId="pocket-main">
          {!a.root ? <ConnectChoices /> : (
            <div className="space-y-5">
              <LegacyKeyBanner />
              <PocketCard />
              {!(pv?.deployed && pv.owner && !owned) && <ActivationCard />}
              {a.adopted.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 text-xs"><span className="text-zinc-500">Active Pocket:</span>
                  {[a.pocket as Hex, ...a.adopted].filter(Boolean).map((p) => <button key={p} type="button" onClick={() => a.setActivePocket(p)} className={cx('rounded-full border px-3 py-1 font-mono', p === a.activePocket ? 'border-zinc-900 bg-zinc-900 text-stone-50' : 'border-zinc-300 bg-white')}>{short(p)}</button>)}
                </div>
              )}
              <details className="rounded-2xl border border-zinc-200 bg-white/70 p-4"><summary className="cursor-pointer text-sm font-medium text-zinc-900">Backup key</summary><div className="mt-3"><BackupCard /></div></details>
              <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-600" data-testid="env-switch">
                <span>Instance:</span>
                {(['prod', 'lab'] as Env[]).map((e) => <button key={e} type="button" data-testid={`env-${e}`} onClick={() => a.setEnv(e)} className={cx('rounded-full border px-3 py-1', a.env === e ? 'border-zinc-900 bg-zinc-900 text-stone-50' : 'border-zinc-300 bg-white')}>{e === 'prod' ? 'Production (24 h timelock)' : 'Lab (60 s timelock, for demos)'}</button>)}
              </div>
            </div>
          )}
        </StepCard>

        {a.root && pv && (
          <>
            <Section title="Send out" testId="spend-section" badge={<SourceBadge kind="LIVE" />}>
              <p className="text-sm text-zinc-700">Move QOR out of your Pocket with a signed intent. Within today&apos;s limit it is paid at once.</p>
              <div className="mt-3 space-y-2">
                <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="0x… address" aria-label="Send to" data-testid="spend-to" className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-3 font-mono text-xs" />
                <input value={amt} onChange={(e) => setAmt(e.target.value)} placeholder="Amount in QOR" inputMode="decimal" aria-label="Amount" data-testid="spend-amount" className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-3 font-mono text-sm" />
              </div>
              {spendProblem && to + amt !== '' && <p role="alert" className="mt-2 text-sm font-medium text-red-700" data-testid="spend-problem">{spendProblem}</p>}
              {queuedWarn && <div className="mt-2"><Notice tone="warn" testId="spend-queue-warning">{queuedWarn}</Notice></div>}
              <div className="mt-3"><Button block busy={spendAct.busy === 'spend'} disabled={!canAct || !!spendProblem || pv.frozen} onClick={() => void spendAct.run('spend', () => spend(ctx!, to as Hex, spendAmt!))} data-testid="spend-send">Sign and send</Button></div>
              {pv.frozen && <p className="mt-2 text-xs text-red-800">Frozen by guardians: spending is paused.</p>}
              <ActResult act={spendAct} testId="spend" />
            </Section>

            <Section title="Daily limit" testId="limit-section" badge={<SourceBadge kind="LIVE" />}>
              <p className="text-sm text-zinc-700">Limit <b data-testid="daily-limit">{pv.deployed ? fmtQor(pv.dailyLimit) : fmtQor(a.cfg?.limit ?? 0n)}</b> QOR per day, <b data-testid="allowance-left">{pv.deployed ? fmtQor(pv.allowanceLeft) : fmtQor(a.cfg?.limit ?? 0n)}</b> QOR left today (a spend that already waited out the delay below does not use today&apos;s limit). Anything above it waits {dur(inst.timelockSec)} and can be vetoed. Raising the limit also waits {dur(inst.timelockSec)}; lowering it is immediate.</p>
              {pv.pendingLimitAt > 0 && (
                <div className="mt-3"><Notice tone="warn" testId="pending-limit">A raise to {fmtQor(pv.pendingLimit)} QOR is pending: ready {pv.pendingLimitAt > t ? `in ${dur(pv.pendingLimitAt - t)}` : 'now'}.
                  <div className="mt-2 flex gap-2"><Button variant="secondary" disabled={pv.pendingLimitAt > t || !!pv.recovery} busy={limitAct.busy === 'apply'} onClick={() => void limitAct.run('apply limit', () => applyLimit(a.env, pv.address))} data-testid="apply-limit">Apply now</Button>
                    <Button variant="danger" disabled={!canAct} busy={limitAct.busy === 'cancel'} onClick={() => void limitAct.run('cancel pending', () => cancelPending(ctx!))}>Cancel</Button></div></Notice></div>
              )}
              <div className="mt-3 flex gap-2"><input value={newLimit} onChange={(e) => setNewLimit(e.target.value)} placeholder="New limit in QOR" inputMode="decimal" aria-label="New limit" data-testid="limit-input" className="min-w-0 flex-1 rounded-xl border border-zinc-300 bg-white px-3 py-3 font-mono text-sm" />
                <Button variant="secondary" disabled={!canAct || !pv.deployed || limitVal === null} busy={limitAct.busy === 'set'} onClick={() => void limitAct.run('set limit', () => setLimit(ctx!, limitVal!))} data-testid="limit-set">Set</Button></div>
              {!pv.deployed && <p className="mt-2 text-xs text-zinc-500">Limits can be changed after the Pocket is deployed (its first drop or spend deploys it).</p>}
              <ActResult act={limitAct} testId="limit" />
            </Section>

            <Section title="Waiting to go out" testId="queue-section" badge={<Pill>{pv.queue.filter((q) => q.state === 'Pending').length} pending</Pill>}>
              {pv.queue.length === 0 ? <p className="text-sm text-zinc-500">Nothing waiting. A spend above the daily limit waits here for {dur(inst.timelockSec)}, and you can cancel it (veto) the whole time.</p> : (
                <ul className="space-y-2">
                  {pv.queue.map((q) => (
                    <li key={q.id} className="rounded-2xl border border-zinc-200 bg-white p-3 text-sm" data-testid={`queued-${q.id}`} data-state={q.state}>
                      <div className="flex items-center justify-between gap-2"><span>#{q.id} · {fmtQor(q.amount)} QOR to <a className="font-mono text-xs underline" href={addrUrl(q.to)} target="_blank" rel="noopener noreferrer">{short(q.to)}</a></span><Pill tone={q.state === 'Pending' ? 'warn' : 'neutral'}>{q.state}</Pill></div>
                      {q.state === 'Pending' && (
                        <div className="mt-2 flex flex-wrap items-center gap-2"><span className="text-xs text-zinc-600">{q.unlockAt > t ? `unlocks in ${dur(q.unlockAt - t)}` : 'unlocked'}</span>
                          <Button variant="danger" disabled={!canAct} busy={queueAct.busy === `veto${q.id}`} onClick={() => void queueAct.run(`veto ${q.id}`, () => vetoQueued(ctx!, BigInt(q.id)))} data-testid={`veto-${q.id}`}>Veto</Button>
                          <Button variant="secondary" disabled={q.unlockAt > t || pv.frozen} busy={queueAct.busy === `ex${q.id}`} onClick={() => void queueAct.run(`execute ${q.id}`, () => executeQueued(a.env, pv.address, BigInt(q.id)))} data-testid={`execute-${q.id}`}>Execute</Button></div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <ActResult act={queueAct} testId="queue" />
            </Section>

            <Section title="Guardians" testId="guardian-section" badge={<SourceBadge kind="LIVE" />}>
              <p className="text-sm text-zinc-700">Guardians are people you trust (or your other accounts) who can <b>pause</b> your Pocket if your key is stolen, or <b>move it to a new phone</b> if you lose yours. You choose how many of them must agree (at least 2; this number is called the threshold). Each needs their own registered quantum-safe key. Changes to the list wait {dur(inst.timelockSec)}.</p>
              <div className="mt-3 rounded-2xl border border-zinc-200 bg-white p-3 text-sm" data-testid="guardian-list">
                {pv.guardians.length === 0 ? <span className="text-zinc-500">No guardians yet.</span> : <><div className="text-xs text-zinc-500">{pv.threshold} of {pv.guardians.length} needed</div>{pv.guardians.map((g) => <div key={g}><Mono>{g}</Mono></div>)}</>}
              </div>
              {pv.pendingGuardiansAt > 0 && (
                <div className="mt-3"><Notice tone="warn" testId="pending-guardians">New set pending ({pv.pendingThreshold} of {pv.pendingGuardians.length}): ready {pv.pendingGuardiansAt > t ? `in ${dur(pv.pendingGuardiansAt - t)}` : 'now'}.
                  <div className="mt-2 flex gap-2"><Button variant="secondary" disabled={pv.pendingGuardiansAt > t || pv.frozen || !!pv.recovery} busy={guardAct.busy === 'apply'} onClick={() => void guardAct.run('apply guardians', () => applyGuardians(a.env, pv.address))} data-testid="apply-guardians">Apply now</Button>
                    <Button variant="danger" disabled={!canAct} onClick={() => void guardAct.run('cancel pending', () => cancelPending(ctx!))}>Cancel</Button></div></Notice></div>
              )}
              <div className="mt-4 space-y-2">
                <label className="text-sm font-semibold text-zinc-900" htmlFor="guardians-in">Set guardians (2 to 5 addresses, one per line)</label>
                <textarea id="guardians-in" value={gText} onChange={(e) => setGText(e.target.value)} rows={3} placeholder={'0x… (their key account address)\n0x…'} data-testid="guardians-input" className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-3 font-mono text-xs" />
                <label className="flex flex-wrap items-center gap-2 text-sm text-zinc-800">How many guardians must sign to freeze or recover (the threshold)
                  <select value={gThr} onChange={(e) => setGThr(e.target.value)} data-testid="guardians-threshold" className="rounded-lg border border-zinc-300 bg-white px-2 py-1">{[2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
                {gText && gProblem && <p role="alert" className="text-sm font-medium text-red-700" data-testid="guardians-problem">{gProblem}</p>}
                <Button block disabled={!canAct || !pv.deployed || !!gProblem} busy={guardAct.busy === 'set'} onClick={() => void guardAct.run('set guardians', () => setGuardians(ctx!, gList as Hex[], Number(gThr)))} data-testid="guardians-set">Queue this guardian set</Button>
                {!pv.deployed && <p className="text-xs text-zinc-500">Your Pocket is deployed by its first drop or spend; guardians can be set right after.</p>}
              </div>
              {a.acct && <div className="mt-4 rounded-2xl border border-zinc-200 bg-white/70 p-3 text-xs"><div className="text-zinc-500">Being a guardian for a friend? Give them this address (your key account, it must be registered):</div><Mono>{a.acct.evm}</Mono><div className="mt-2"><CopyButton text={a.acct.evm} label="Copy my guardian address" testId="copy-guardian-address" /></div></div>}
              <ActResult act={guardAct} testId="guardians" />
            </Section>

            <Section title="Freeze and recovery" testId="recovery-section" badge={<SourceBadge kind="LIVE" />}>
              <div className="space-y-3 text-sm">
                <div data-testid="freeze-status" data-frozen={pv.frozen ? '1' : '0'}>
                  {pv.frozen
                    ? <Notice tone="error">Frozen{pv.frozenUntil > t ? ` for another ${dur(pv.frozenUntil - t)}` : ' while a unanimous recovery is pending'}. Spending, drops, limit raises and guardian changes are paused. Your key alone cannot lift a freeze.</Notice>
                    : <p className="text-zinc-700">Not frozen. If your key is stolen, any {pv.threshold || 'threshold'} of your guardians can freeze the Pocket for {dur(inst.freezeSec)}.</p>}
                </div>
                {pv.recovery && (
                  <Notice tone="warn" testId="pending-recovery">Recovery to <Mono>{pv.recovery.newOwner}</Mono> is pending ({pv.recovery.at > t ? `can finish in ${dur(pv.recovery.at - t)}` : 'ready to finish'}). If this is not you, veto it.
                    <div className="mt-2 flex flex-wrap gap-2"><Button variant="danger" disabled={!canAct} busy={recAct.busy === 'veto'} onClick={() => void recAct.run('veto recovery', () => vetoRecovery(ctx!))} data-testid="veto-recovery">Veto this recovery</Button>
                      <Button variant="secondary" disabled={pv.recovery.at > t} busy={recAct.busy === 'fin'} onClick={() => void recAct.run('finalize recovery', () => finalizeRecovery(a.env, pv.address, false))} data-testid="finalize-recovery">Finish recovery</Button></div></Notice>
                )}
                {pv.unanimous && (
                  <Notice tone="error" testId="pending-unanimous">A unanimous recovery to <Mono>{pv.unanimous.newOwner}</Mono> is pending ({pv.unanimous.at > t ? `can finish in ${dur(pv.unanimous.at - t)}` : 'ready to finish'}). <b>It cannot be vetoed</b>: every guardian signed it, and a stolen owner key must not be able to stop it.
                    <div className="mt-2"><Button variant="secondary" disabled={pv.unanimous.at > t} busy={recAct.busy === 'finu'} onClick={() => void recAct.run('finalize unanimous recovery', () => finalizeRecovery(a.env, pv.address, true))} data-testid="finalize-unanimous">Finish recovery</Button></div></Notice>
                )}
                {!pv.recovery && !pv.unanimous && <p className="text-xs text-zinc-500" data-testid="no-recovery">No recovery pending.</p>}
              </div>
              <ActResult act={recAct} testId="recovery" />
            </Section>
          </>
        )}

        {a.root ? (
          <>
            <Section title="Help a friend recover" testId="help-section" badge={<Pill>guardian tools</Pill>}>
              <HelpFriend />
            </Section>
            <Section title="I lost my phone" testId="lost-section" badge={<Pill>new key</Pill>}><LostPhone /></Section>
            <Section title="Q-Day Rescue" testId="rescue-section" badge={<Pill tone="warn">legacy accounts</Pill>}>
              <RescuePanel />
            </Section>
          </>
        ) : (
          // a first-time visitor sees one thing to do: create the key. Guardian tools and Rescue wait under Advanced.
          <details className="group rounded-3xl border border-zinc-200 bg-white/80 p-5 sm:p-6" data-testid="pocket-advanced">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden" data-testid="pocket-advanced-toggle">
              <span><span className="block text-sm font-semibold text-zinc-900">Advanced</span><span className="block text-xs text-zinc-600">Guardian tools for helping a friend, and Q-Day Rescue for old accounts. You need your own key for both.</span></span>
              <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden />
            </summary>
            <div className="mt-5 space-y-5">
              <Section title="Help a friend recover" testId="help-section" badge={<Pill>guardian tools</Pill>}>
                <HelpFriend />
              </Section>
              <Section title="Q-Day Rescue" testId="rescue-section" badge={<Pill tone="warn">legacy accounts</Pill>}>
                <RescuePanel />
              </Section>
            </div>
          </details>
        )}

        {a.root && pv && !pv.deployed && a.acct && <p className="text-center text-xs text-zinc-500">Your Pocket opens on its first drop or spend. Until then it simply holds what you send to its address.</p>}
        {a.root && <KeyOnlyBalance />}
      </div>
    </Page>
  );
}

function KeyOnlyBalance() {
  const a = useAccount();
  const { data } = useBalance(a.acct?.evm as Hex | undefined);
  return a.acct ? <p className="text-center text-xs text-zinc-500">Key account <Mono>{a.acct.evm}</Mono> holds {data !== undefined ? fmtQor(data) : '…'} QOR (network fees only).</p> : null;
}

import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { decodeErrorResult, type Hex } from 'viem';
import { CheckCircle2, Play, ShieldX, XCircle } from '../components/icons';
import { Button, Card, Notice, Pill, SourceBadge, TxLink } from '../components/ui';
import { Reveal } from '../components/bits';
import { Stage } from '../components/stage';
import { ATTACKS, attackTx } from '../data/proofs';
import v4 from '../data/v4.json';
import { errorsAbi } from '../lib/abi4';
import { pocketDropAbi } from '../lib/abi';
import { pub } from '../lib/chain';
import { addrUrl } from '../lib/config';
import { LAB_REFUSED } from '../lib/labcount';

interface Row { section: string; step: string; status: string; outcome: string; url: string | null; hash: string | null }
const ROWS = v4.liveRows as Row[];
const STOLEN = 'Guardian freeze and unanimous recovery';
// test-account labels from the live suite, said in plain words on the page (UX-9)
const NAMES: [RegExp, string][] = [
  [/freeze-demo-thief/g, 'the thief'], [/freeze-demo-new-owner/g, 'the new owner'], [/freeze-demo-expiry-owner/g, 'the owner'],
  [/new-owner-after-recovery/g, 'the new owner after recovery'], [/attacker-B/g, 'a second attacker'], [/pool-claimer-(\d)/g, 'pool claimer $1'],
  [/guardian-(\d)/g, 'guardian $1'], [/lab-owner/g, 'the lab owner'], [/sender-owner/g, 'the sender'],
];
export const plainNames = (s: string) => NAMES.reduce((t, [re, w]) => t.replace(re, w), s);
const clean = (s: string) => plainNames(s.replace(/^ATTACK\s+/, '').replace(/\s+ATTACK\s+/, ' ').replace(/^[A-Z]{1,2}\d+[a-z]?\s+/, ''));
const inStolen = (r: Row) => r.section.startsWith(STOLEN);
const isAttack = (r: Row) => r.status === 'reverted' || r.status === 'refused';

interface Check { receipt?: string; replay?: string; block?: string; error?: string }
/** LIVE: fetch the receipt, then replay the exact call against the chain state one block before it was mined. */
async function verify(hash: Hex): Promise<Check> {
  const [tx, rc] = await Promise.all([pub.getTransaction({ hash }), pub.getTransactionReceipt({ hash })]);
  let replay = 'did not revert';
  try { await pub.call({ account: tx.from, to: tx.to!, data: tx.input, value: tx.value, blockNumber: rc.blockNumber - 1n }); }
  catch (e) {
    const err = e as { walk?: (f: (x: unknown) => boolean) => { data?: string } | undefined; data?: string };
    const data = (err.walk?.((x) => typeof (x as { data?: unknown })?.data === 'string') as { data?: string } | undefined)?.data ?? err.data;
    try { replay = decodeErrorResult({ abi: errorsAbi as never, data: data as Hex }).errorName; } catch { replay = 'reverted (undecoded)'; }
  }
  return { receipt: rc.status, replay, block: rc.blockNumber.toString() };
}

function AttackRow({ r, check }: { r: Row; check?: Check }) {
  const match = check?.replay && r.outcome && check.replay === r.outcome;
  return (
    <li className="min-w-0 overflow-hidden rounded-2xl border border-zinc-200 bg-white p-4" data-testid="attack-row" data-status={r.status}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1 text-sm font-medium text-zinc-900">{clean(r.step)}</div>
        <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2"><Pill tone={r.status === 'reverted' ? 'warn' : 'neutral'}><span className="break-all">{r.status === 'refused' ? 'refused at broadcast' : plainNames(r.outcome)}</span></Pill><SourceBadge kind="RECORDED" title="A mined (or chain-refused) transaction recorded in contracts-v4/LIVE_RESULTS.md" /></div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-600">
        {r.hash ? <TxLink hash={r.hash} testId="attack-tx" /> : <span>no hash: the chain refused to broadcast it</span>}
        {check && !check.error && <span className="inline-flex items-center gap-1 font-mono" data-testid="live-check">{check.receipt === 'reverted' ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-700" /> : <XCircle className="h-3.5 w-3.5 text-red-700" />}receipt {check.receipt} · block {check.block} · replay {check.replay}{match ? ' (matches)' : ''}</span>}
        {check?.error && <span className="text-red-700">{check.error}</span>}
      </div>
    </li>
  );
}

const wideNow = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(min-width: 640px)').matches;

/** A long list that starts open on a wide screen and folded on a phone, so /lab stays short there. */
function Fold({ summary, open, onToggle, testId, children }: { summary: ReactNode; open: boolean; onToggle: (v: boolean) => void; testId: string; children: ReactNode }) {
  return (
    <details open={open} onToggle={(e) => onToggle((e.currentTarget as HTMLDetailsElement).open)} className="group mt-4" data-testid={testId}>
      <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between gap-3 rounded-2xl border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-900 sm:hidden [&::-webkit-details-marker]:hidden">
        <span>{summary}</span><span aria-hidden className="text-zinc-500 transition-transform group-open:rotate-180">⌄</span>
      </summary>
      <div className="mt-2 sm:mt-0">{children}</div>
    </details>
  );
}

export default function LabPage() {
  const [checks, setChecks] = useState<Record<string, Check>>({});
  const [busy, setBusy] = useState(false);
  const attacks = useMemo(() => ROWS.filter((r) => isAttack(r) && !inStolen(r)), []);
  const stolen = useMemo(() => ROWS.filter((r) => inStolen(r) && r.status !== 'info'), []);
  const stolenAttacks = stolen.filter(isAttack);
  const [openStolen, setOpenStolen] = useState(wideNow);
  const [openList, setOpenList] = useState(wideNow);

  async function runAll() {
    setBusy(true); setOpenStolen(true); setOpenList(true); // the live checks show inside the rows
    const out: Record<string, Check> = {};
    await Promise.all([...attacks, ...stolenAttacks].filter((r) => r.hash && r.status === 'reverted').map(async (r) => {
      try { out[r.hash!] = await verify(r.hash as Hex); } catch (e) { out[r.hash!] = { error: (e as Error).message }; }
    }));
    setChecks(out); setBusy(false);
  }
  const inst = v4.instances;

  return (
    <div className="mx-auto max-w-5xl px-4 pb-28 pt-8 sm:px-6 sm:pb-16 sm:pt-12 lg:px-8" data-testid="lab">
      <Stage eyebrow={<span className="break-words">Lab · recorded on v4 (previous contracts) · prod router <a className="underline" href={addrUrl(inst.prodV4.router.address)} target="_blank" rel="noopener noreferrer">{inst.prodV4.router.address.slice(0, 8)}…</a> · lab router <a className="underline" href={addrUrl(inst.labV4.router.address)} target="_blank" rel="noopener noreferrer">{inst.labV4.router.address.slice(0, 8)}…</a> · v5 smoke rows use the v5 routers <SourceBadge kind="RECORDED" /></span>} title={<>{LAB_REFUSED} attacks the chain refused</>} action={<Button onClick={() => void runAll()} busy={busy} data-testid="verify-all"><Play className="h-4 w-4" aria-hidden />Verify live</Button>}>Each row below is a real transaction on Diana testnet. A &quot;reverted&quot; attack was decoded with eth_call first, then mined with an explicit gas limit so the revert itself is on-chain. Source: <code className="font-mono text-xs">contracts-v4/LIVE_RESULTS.md</code>, recorded when the live suite ran. The button re-checks them against the chain right now.</Stage>

      <Link to="/qday" data-testid="lab-qday-link" className="mb-6 flex flex-wrap items-center justify-between gap-2 rounded-3xl border-2 border-zinc-900 bg-white p-5 shadow-sm hover:bg-stoneBg">
        <span><span className="block font-serif text-2xl text-zinc-900">Q-Day Drill</span><span className="block text-sm text-zinc-700">Five Pockets with published classical keys. Try every attack yourself, live.</span></span>
        <SourceBadge kind="LIVE" />
      </Link>

      <Reveal>
        <Card className="mb-6" data-testid="stolen-key">
          <div className="flex flex-wrap items-center gap-2"><ShieldX className="h-5 w-5 text-zinc-700" aria-hidden /><h2 className="font-serif text-2xl text-zinc-900">Stolen key: freeze, then unanimous recovery</h2><SourceBadge kind="RECORDED" /></div>
          <p className="mt-2 text-sm leading-relaxed text-zinc-700">A thief holds the owner key. The thief can spend only inside the daily limit before the guardians act. Then a threshold of guardians freeze the Pocket (the owner key cannot lift it), and all guardians replace the owner by a unanimous recovery that the thief cannot veto. This is the lab (60 s) instance run end to end; the residual risk (what a thief can take before the freeze) is shown honestly in the first step.</p>
          <Fold open={openStolen} onToggle={setOpenStolen} testId="stolen-fold" summary={`Show all ${stolen.length} steps (${stolenAttacks.length} refused)`}>
            <ul className="space-y-2" data-testid="stolen-rows">{stolen.map((r) => <AttackRow key={r.step} r={r} check={r.hash ? checks[r.hash] : undefined} />)}</ul>
          </Fold>
        </Card>
      </Reveal>

      <Reveal>
        <h2 className="mb-3 font-serif text-2xl text-zinc-900">Everything else it refused</h2>
        <p className="mb-4 text-xs text-zinc-500">Vault signatures, replays, timelocks, recovery, the router and pool rules, and the v3 attacks on the v4 drop. Production and lab instances.</p>
        <Fold open={openList} onToggle={setOpenList} testId="attack-fold" summary={`Show all ${attacks.length} refused attacks`}>
          <ul className="space-y-2" data-testid="attack-list">{attacks.map((r) => <AttackRow key={r.step} r={r} check={r.hash ? checks[r.hash] : undefined} />)}</ul>
        </Fold>
      </Reveal>

      <Reveal>
        <details className="mt-8 rounded-3xl border border-zinc-200 bg-white/80 p-5">
          <summary className="cursor-pointer font-serif text-xl text-zinc-900">The six v3 attacks (v3 contract, still deployed)</summary>
          <ul className="mt-3 space-y-2">{ATTACKS.map((a) => (
            <li key={a.n} className="rounded-2xl border border-zinc-200 bg-white p-3 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><span className="min-w-0 font-medium text-zinc-900">{a.n}. {a.title}</span><span className="flex min-w-0 flex-wrap items-center gap-2"><Pill tone="warn">{a.error}</Pill><SourceBadge kind="RECORDED" /></span></div><div className="mt-1 text-xs text-zinc-600">{a.plain}</div><div className="mt-1"><TxLink hash={attackTx(a.n).hash} /></div></li>
          ))}</ul>
          <p className="mt-2 text-xs text-zinc-500">v3 decoded against its own ABI ({pocketDropAbi.filter((x) => x.type === 'error').length} custom errors).</p>
        </details>
      </Reveal>
      <div className="mt-6"><Notice tone="info">LIVE means this page read it from the chain just now. RECORDED means it comes from a file in the repository. Nothing on this page is simulated.</Notice></div>
    </div>
  );
}

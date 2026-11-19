import { useState } from 'react';
import { decodeErrorResult, type Hex } from 'viem';
import { ShieldX, Play, CheckCircle2, XCircle } from 'lucide-react';
import { Button, Card, Mono, Notice, SourceBadge, TxLink, cx } from '../components/ui';
import { Reveal } from '../components/bits';
import { ATTACKS, REC, attackTx } from '../data/proofs';
import { addrUrl, LAB_ADDRESS, POCKETDROP_ADDRESS } from '../lib/config';
import { pub } from '../lib/chain';
import { pocketDropAbi } from '../lib/abi';

interface Check { receipt?: 'success' | 'reverted'; replay?: string; block?: string; error?: string }

/** LIVE: fetch the receipt, then replay the exact call against the chain state one block before it was mined. */
async function verify(hash: Hex): Promise<Check> {
  const [tx, rc] = await Promise.all([pub.getTransaction({ hash }), pub.getTransactionReceipt({ hash })]);
  let replay = 'did not revert';
  try {
    await pub.call({ account: tx.from, to: tx.to!, data: tx.input, value: tx.value, blockNumber: rc.blockNumber - 1n });
  } catch (e) {
    const err = e as { walk?: (f: (x: unknown) => boolean) => { data?: string } | undefined; data?: string };
    const data = (err.walk?.((x) => typeof (x as { data?: unknown })?.data === 'string') as { data?: string } | undefined)?.data ?? err.data;
    try { replay = decodeErrorResult({ abi: pocketDropAbi, data: data as Hex }).errorName; } catch { replay = 'reverted (undecoded)'; }
  }
  return { receipt: rc.status, replay, block: rc.blockNumber.toString() };
}

const CAT: Record<number, 'sig' | 'pop'> = { 1: 'sig', 2: 'sig', 3: 'pop', 4: 'pop', 5: 'sig', 6: 'pop' };

export default function LabPage() {
  const [checks, setChecks] = useState<Record<number, Check>>({});
  const [busy, setBusy] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [filter, setFilter] = useState<'all' | 'sig' | 'pop'>('all');

  async function runAll() {
    setBusy(true);
    const out: Record<number, Check> = {};
    await Promise.all(ATTACKS.map(async (a) => {
      try { out[a.n] = await verify(attackTx(a.n).hash as Hex); } catch (e) { out[a.n] = { error: (e as Error).message }; }
    }));
    setChecks(out); setBusy(false);
  }
  const items = ATTACKS.filter((a) => filter === 'all' || CAT[a.n] === filter);
  const short = (a: string) => `${a.slice(0, 6)}...${a.slice(-4)}`;

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8" data-testid="lab">
      <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-zinc-500">Lab Instance: {short(LAB_ADDRESS)} <SourceBadge kind="RECORDED" title="Attack transactions recorded in deployments/diana.json; the button below re-verifies them live" /></p>
          <h1 className="mt-1 font-serif text-3xl text-zinc-900 sm:text-5xl">6 On-Chain Revert Defences</h1>
        </div>
        <div className="flex gap-1.5 self-start rounded-full border border-zinc-200 bg-white p-1">
          {([['all', `All (${ATTACKS.length})`], ['sig', 'Signatures'], ['pop', 'PoP & State']] as const).map(([f, l]) => (
            <button key={f} type="button" onClick={() => setFilter(f)} className={cx('rounded-full px-3 py-1 text-xs font-medium', filter === f ? 'bg-zinc-900 text-white' : 'text-zinc-600')}>{l}</button>
          ))}
        </div>
      </div>

      <Card className="mb-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-zinc-700">
            <p className="mb-2 max-w-2xl text-xs leading-relaxed text-zinc-600">Each attack below was mined as a real transaction on Diana against the main contract and reverted with the custom error shown. The hashes come from the recorded live run. The button re-runs each call against the chain state it originally faced.</p>
            <div>Main contract <a className="underline" href={addrUrl(POCKETDROP_ADDRESS)} target="_blank" rel="noopener noreferrer"><Mono>{POCKETDROP_ADDRESS}</Mono></a></div>
            <div className="mt-1">Lab instance (60 s bind timeout, used for the rebind scenario) <a className="underline" href={addrUrl(LAB_ADDRESS)} target="_blank" rel="noopener noreferrer"><Mono>{LAB_ADDRESS}</Mono></a></div>
          </div>
          <Button onClick={runAll} busy={busy} data-testid="lab-verify"><Play className="h-4 w-4" />Re-run all 6 against the chain</Button>
        </div>
        <p className="mt-2 text-xs text-zinc-500">This reads the receipt and replays the same call with eth_call at the block before it was mined, then decodes the revert. It changes nothing on-chain and costs nothing.</p>
      </Card>

      <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3" data-testid="lab-grid">
        {items.map((a, idx) => {
          const t = attackTx(a.n); const c = checks[a.n];
          const ok = c && !c.error && c.receipt === 'reverted' && c.replay === a.error;
          return (
            <Reveal key={a.n} delay={(idx % 3) * 0.06} className="flex">
              <div data-testid={`attack-${a.n}`} data-verified={c ? (ok ? 'ok' : 'bad') : 'idle'} className="flex w-full flex-col justify-between rounded-2xl border border-zinc-200 bg-white p-5 transition-all hover:shadow-md">
                <div>
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2.5 py-0.5 font-mono text-[11px] font-semibold text-rose-700"><ShieldX className="h-3 w-3" />REVERTED</span>
                    <span className="font-mono text-[11px] text-zinc-500">{a.error}</span>
                  </div>
                  <h3 className="mb-2 font-serif text-xl text-zinc-900">{a.n}. {a.title}</h3>
                  <p className="mb-4 text-xs leading-relaxed text-zinc-600">{a.plain}</p>
                </div>
                <div>
                  <div className="flex items-center justify-between border-t border-zinc-100 pt-3 text-xs">
                    <TxLink hash={t.hash} testId={`attack-tx-${a.n}`} />
                    <span className="text-[11px] text-zinc-500">recorded: {t.status} / {t.outcome}</span>
                  </div>
                  {c && (
                    <div className={cx('mt-2 flex items-start gap-2 rounded-lg px-2.5 py-2 text-xs', ok ? 'bg-emerald-50 text-emerald-900' : 'bg-red-50 text-red-900')}>
                      {ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0" />}
                      <div>
                        <SourceBadge kind="LIVE" />
                        <div className="mt-1">{c.error ? c.error : `Receipt in block ${c.block}: ${c.receipt}. Replay at block ${(BigInt(c.block!) - 1n).toString()}: ${c.replay}.`}</div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </Reveal>
          );
        })}
      </div>

      <div className="mt-6"><Notice tone="info"><span className="font-medium">Why a revert counts as proof.</span> A reverted transaction is mined and visible on the explorer with status failed. Re-running the same call at the earlier block shows the contract itself names the reason.</Notice></div>

      <div className="mt-6">
        <Button variant="secondary" onClick={() => setShowAll((v) => !v)}>{showAll ? 'Hide' : 'Show'} all {REC.liveTxs.length} recorded live transactions</Button>
        {showAll && (
          <Card className="mt-3 overflow-x-auto p-0 sm:p-0">
            <table className="w-full min-w-[520px] text-left text-xs">
              <thead className="bg-stoneCard text-zinc-600"><tr><th className="p-2.5">Step</th><th className="p-2.5">Status</th><th className="p-2.5">Outcome</th><th className="p-2.5">Tx</th></tr></thead>
              <tbody>
                {REC.liveTxs.map((t, i) => (
                  <tr key={i} className="border-t border-zinc-100">
                    <td className="p-2.5">{t.step}</td>
                    <td className={cx('p-2.5 font-mono', t.status === 'reverted' ? 'text-red-700' : 'text-emerald-700')}>{t.status}</td>
                    <td className="p-2.5">{t.outcome}</td>
                    <td className="p-2.5"><TxLink hash={t.hash} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>
    </div>
  );
}

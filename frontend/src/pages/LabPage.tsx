import { useState } from 'react';
import { decodeErrorResult, type Hex } from 'viem';
import { ShieldX, Play, CheckCircle2, XCircle } from 'lucide-react';
import { Button, Card, Mono, Notice, PageTitle, SourceBadge, TxLink, cx } from '../components/ui';
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

export default function LabPage() {
  const [checks, setChecks] = useState<Record<number, Check>>({});
  const [busy, setBusy] = useState(false);
  const [showAll, setShowAll] = useState(false);

  async function runAll() {
    setBusy(true);
    const out: Record<number, Check> = {};
    await Promise.all(ATTACKS.map(async (a) => {
      try { out[a.n] = await verify(attackTx(a.n).hash as Hex); } catch (e) { out[a.n] = { error: (e as Error).message }; }
    }));
    setChecks(out); setBusy(false);
  }

  return (
    <div className="mx-auto max-w-5xl">
      <PageTitle eyebrow={<span className="flex items-center gap-2">Attack lab <SourceBadge kind="RECORDED" /></span>} title="Six attacks, six on-chain refusals.">
        Each attack below was mined as a real transaction on Diana against the main contract and reverted with the custom error shown. The hashes come from the recorded live run. The button re-runs each call against the chain state it originally faced.
      </PageTitle>

      <Card className="mb-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-zinc-700">
            <div>Main contract <a className="underline" href={addrUrl(POCKETDROP_ADDRESS)} target="_blank" rel="noopener noreferrer"><Mono>{POCKETDROP_ADDRESS}</Mono></a></div>
            <div className="mt-1">Lab instance (60 s bind timeout, used for the rebind scenario) <a className="underline" href={addrUrl(LAB_ADDRESS)} target="_blank" rel="noopener noreferrer"><Mono>{LAB_ADDRESS}</Mono></a></div>
          </div>
          <Button onClick={runAll} busy={busy} data-testid="lab-verify"><Play className="h-4 w-4" />Re-run all 6 against the chain</Button>
        </div>
        <p className="mt-2 text-xs text-zinc-500">This reads the receipt and replays the same call with eth_call at the block before it was mined, then decodes the revert. It changes nothing on-chain and costs nothing.</p>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        {ATTACKS.map((a) => {
          const t = attackTx(a.n); const c = checks[a.n];
          const ok = c && !c.error && c.receipt === 'reverted' && c.replay === a.error;
          return (
            <Card key={a.n} className="flex flex-col" >
              <div data-testid={`attack-${a.n}`} data-verified={c ? (ok ? 'ok' : 'bad') : 'idle'} className="flex flex-1 flex-col">
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2 py-0.5 font-mono text-[11px] font-semibold text-red-800"><ShieldX className="h-3 w-3" />REVERTED</span>
                  <span className="font-mono text-[11px] text-zinc-500">{a.error}</span>
                </div>
                <h3 className="mt-3 font-serif text-xl leading-snug">{a.n}. {a.title}</h3>
                <p className="mt-1 flex-1 text-sm leading-relaxed text-zinc-600">{a.plain}</p>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-zinc-100 pt-3">
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
            </Card>
          );
        })}
      </div>

      <Notice tone="info"><span className="font-medium">Why a revert counts as proof.</span> A reverted transaction is mined and visible on the explorer with status failed. Re-running the same call at the earlier block shows the contract itself names the reason.</Notice>

      <div className="mt-6">
        <Button variant="secondary" onClick={() => setShowAll((v) => !v)}>{showAll ? 'Hide' : 'Show'} all {REC.liveTxs.length} recorded live transactions</Button>
        {showAll && (
          <Card className="mt-3 overflow-x-auto p-0 sm:p-0">
            <table className="w-full min-w-[520px] text-left text-xs">
              <thead className="bg-stone2 text-zinc-600"><tr><th className="p-2.5">Step</th><th className="p-2.5">Status</th><th className="p-2.5">Outcome</th><th className="p-2.5">Tx</th></tr></thead>
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

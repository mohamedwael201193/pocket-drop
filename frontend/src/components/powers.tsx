// "Who can do what" table for one Pocket (LIVE). Used on the owner's Pocket page and on Proof > Check for any Pocket address.
import { useQuery } from '@tanstack/react-query';
import { factoryAbi } from '../lib/abi4';
import { pub } from '../lib/chain';
import { addrUrl } from '../lib/config';
import { dur, powersOf, readDelays, type Power } from '../lib/powers';
import { INST, readPocket, type Env } from '../lib/v4';
import { Notice, SourceBadge } from './ui';
import type { Hex } from 'viem';

const TONE: Record<Power['state'], string> = { open: 'bg-emerald-100 text-emerald-900', paused: 'bg-amber-100 text-amber-950', unavailable: 'bg-zinc-200 text-zinc-700' };
const LABEL: Record<Power['state'], string> = { open: 'possible now', paused: 'paused', unavailable: 'not possible' };

/** Which instance (if any) deployed this Pocket. An undeployed (counterfactual) address is not recognised. */
export async function pocketEnv(address: Hex): Promise<Env | null> {
  for (const env of ['prod', 'lab'] as Env[]) {
    if (await pub.readContract({ address: INST[env].factory, abi: factoryAbi, functionName: 'isPocket', args: [address] })) return env;
  }
  return null;
}

export function usePowers(env: Env | null, address: Hex | null) {
  return useQuery({
    queryKey: ['powers', env, address], enabled: !!env && !!address, refetchInterval: 30_000,
    queryFn: async () => {
      const [pv, d] = await Promise.all([readPocket(env!, address!), readDelays(address!)]);
      return { pv, d, now: Number((await pub.getBlock()).timestamp) };
    },
  });
}

export function PowerMap({ env, address }: { env: Env; address: Hex }) {
  const q = usePowers(env, address);
  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-4 sm:p-5" data-testid="power-map">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-zinc-900">Who can do what with this Pocket</h2>
        <SourceBadge kind="LIVE" title="Read from the Pocket contract on Diana; refreshed every 30 s" />
      </div>
      <p className="mt-1 text-xs text-zinc-600">Pocket <a className="font-mono underline" href={addrUrl(address)} target="_blank" rel="noopener noreferrer">{address.slice(0, 10)}…{address.slice(-4)}</a> on the {env === 'prod' ? 'production' : 'lab'} instance. Every row is enforced by the contract, not by this app.</p>
      {q.isLoading && <p className="mt-3 text-sm text-zinc-500">Reading the Pocket…</p>}
      {q.error && <div className="mt-3"><Notice tone="error">Could not read the Pocket: {(q.error as Error).message}</Notice></div>}
      {q.data && (
        <>
          <p className="mt-2 text-xs text-zinc-500" data-testid="power-delays" data-timelock={q.data.d.timelock} data-recovery={q.data.d.recoveryDelay} data-freeze={q.data.d.freezePeriod} data-unanimous={q.data.d.unanimousDelay}>
            Delays read from the contract: timelock {dur(q.data.d.timelock)}, recovery {dur(q.data.d.recoveryDelay)}, freeze {dur(q.data.d.freezePeriod)}, unanimous recovery {dur(q.data.d.unanimousDelay)}.
            {' '}{q.data.pv.guardians.length ? `${q.data.pv.threshold} of ${q.data.pv.guardians.length} guardians.` : 'No guardians.'}{q.data.pv.frozen ? ' Frozen now.' : ''}
          </p>
          <ul className="mt-3 space-y-2">
            {powersOf(q.data.pv, q.data.d, q.data.now).map((p) => (
              <li key={p.id} className="rounded-xl border border-zinc-100 bg-stoneBg/60 p-3" data-testid={`power-${p.id}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <span className="text-sm font-medium text-zinc-900">{p.power}</span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${TONE[p.state]}`} data-testid={`power-${p.id}-state`} data-state={p.state}>{LABEL[p.state]}</span>
                </div>
                <dl className="mt-1.5 grid grid-cols-1 gap-x-4 gap-y-0.5 text-xs text-zinc-700 sm:grid-cols-[7rem_1fr]">
                  <dt className="text-zinc-500">Needs</dt><dd>{p.who}</dd>
                  <dt className="text-zinc-500">Checked by</dt><dd className="font-mono text-[11px] [overflow-wrap:anywhere]">{p.check}</dd>
                  <dt className="text-zinc-500">Delay</dt><dd>{p.delay}</dd>
                  <dt className="text-zinc-500">Undo</dt><dd>{p.undo}</dd>
                  {p.why && <><dt className="text-zinc-500">Now</dt><dd>{p.why}</dd></>}
                </dl>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

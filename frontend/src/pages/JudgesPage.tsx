import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Check } from '../components/icons';
import { Mono, PageTitle, Skeleton, SourceBadge, Notice } from '../components/ui';
import v4 from '../data/v4.json';
import { addrUrl, SOURCE_URL, TESTNET_BADGE, txUrl } from '../lib/config';
import { dropAbi, poolAbi } from '../lib/abi4';
import { INST } from '../lib/v4';
import { fmtQor, pub } from '../lib/chain';
import { useHealth } from '../lib/queries';

const blob = (p: string) => `${SOURCE_URL}/blob/main/${p}`;
const CONTRACTS = [['router', 'PocketRouter'], ['factory', 'PocketFactory'], ['vaultImpl', 'PocketVault (clone implementation)'], ['drop', 'PocketDrop'], ['pool', 'DropPool']] as const;

function useFacts() {
  return useQuery({
    queryKey: ['v4-facts'], refetchInterval: 30_000,
    queryFn: async () => {
      const [links, pools, dropCode, poolCode] = await Promise.all([
        pub.readContract({ address: INST.prod.drop, abi: dropAbi, functionName: 'linkCount' }) as Promise<bigint>,
        pub.readContract({ address: INST.prod.pool, abi: poolAbi, functionName: 'poolCount' }) as Promise<bigint>,
        pub.getCode({ address: INST.prod.drop }), pub.getCode({ address: INST.prod.router }),
      ]);
      const [escrow, poolEscrow] = await Promise.all([pub.getBalance({ address: INST.prod.drop }), pub.getBalance({ address: INST.prod.pool })]);
      return { links, pools, escrow, poolEscrow, dropBytes: ((dropCode?.length ?? 2) - 2) / 2, routerBytes: ((poolCode?.length ?? 2) - 2) / 2 };
    },
  });
}

function Item({ n, title, children, action }: { n: number; title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex gap-3 rounded-2xl border border-zinc-200 bg-white p-5">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-zinc-900 font-mono text-xs text-white">{n}</span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-start justify-between gap-2"><h2 className="text-sm font-semibold leading-snug text-zinc-900">{title}</h2>{action}</div>
        <div className="mt-1.5 space-y-2 text-sm leading-relaxed text-zinc-700">{children}</div>
      </div>
    </div>
  );
}

export default function JudgesPage() {
  const { data: f } = useFacts();
  const { data: h } = useHealth();
  const q = v4.qcai as { stage1: string; stage2: string; report: string | null; auditId?: string | null; score?: string | null; findings?: string | null; publicReport?: string | null };
  const t = v4.tests;
  return (
    <div className="mx-auto max-w-5xl px-4 pb-28 pt-10 sm:px-6 sm:pb-16 lg:px-8" data-testid="judges">
      <PageTitle eyebrow="60-Second Verification" title="Judges & Auditors Checklist">
        Every number says where it came from. <SourceBadge kind="LIVE" /> was read from the chain or the API when you opened this page. <SourceBadge kind="RECORDED" /> comes from files in the repository. {TESTNET_BADGE}.
      </PageTitle>

      <div className="space-y-3">
        <Item n={1} title="The v4 contracts are on Diana (two instances: production and a 60 s lab)" action={<SourceBadge kind="RECORDED" title="Addresses and deploy transactions from contracts-v4/deployments/diana.json" />}>
          <div className="overflow-x-auto rounded-xl bg-stoneBg p-3" data-testid="v4-addresses">
            <table className="w-full min-w-[34rem] text-left font-mono text-xs">
              <thead><tr className="text-zinc-500"><th className="pr-3">Contract</th><th className="pr-3">Production</th><th>Lab</th></tr></thead>
              <tbody>{CONTRACTS.map(([k, label]) => (
                <tr key={k} className="align-top"><td className="pr-3 py-1 text-zinc-700">{label}</td>
                  {(['prod', 'lab'] as const).map((e) => <td key={e} className="pr-3 py-1"><a className="underline" href={addrUrl(v4.instances[e][k].address)} target="_blank" rel="noopener noreferrer" data-testid={`addr-${e}-${k}`}>{v4.instances[e][k].address}</a> <a className="text-zinc-500 underline" href={txUrl(v4.instances[e][k].deployTx)} target="_blank" rel="noopener noreferrer">deploy tx</a></td>)}
                </tr>))}
              </tbody>
            </table>
          </div>
          {!f ? <Skeleton className="h-12 w-full" /> : (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-xl bg-stoneBg p-3 font-mono text-xs" data-testid="v4-facts">
              <dt className="text-zinc-500">drops created (prod) <SourceBadge kind="LIVE" /></dt><dd data-testid="fact-links">{f.links.toString()}</dd>
              <dt className="text-zinc-500">pools created (prod)</dt><dd>{f.pools.toString()}</dd>
              <dt className="text-zinc-500">escrow held (drops / pools)</dt><dd>{fmtQor(f.escrow)} / {fmtQor(f.poolEscrow)} QOR</dd>
              <dt className="text-zinc-500">timelock / recovery / freeze / unanimous</dt><dd>{Number(v4.instances.prod.readBack.TIMELOCK) / 3600} h / {Number(v4.instances.prod.readBack.RECOVERY_DELAY) / 3600} h / {Number(v4.instances.prod.readBack.FREEZE_PERIOD) / 3600} h / {Number(v4.instances.prod.readBack.UNANIMOUS_RECOVERY_DELAY) / 3600} h</dd>
            </dl>
          )}
          <p className="text-xs text-zinc-500">No owner, no admin, no upgradeability. The relayer window is scoped to the two routers, so the relayer cannot reach a Pocket or the drop contract directly.</p>
        </Item>

        <Item n={2} title="The attacks, including a stolen key, are refused on-chain" action={<SourceBadge kind="RECORDED" />}>
          <p>{v4.liveRows.filter((r) => r.status === 'reverted' || r.status === 'refused').length} attack rows, each a mined revert (or a chain refusal at broadcast) with an explorer link, including the stolen-key freeze and unanimous-recovery scenario. The Lab re-checks them against the chain live.</p>
          <Link className="inline-block rounded-full bg-zinc-900 px-4 py-2 text-xs font-medium text-white" to="/lab">Open the lab</Link>
        </Item>

        <Item n={3} title="Every sensitive action is a post-quantum intent, checked on-chain" >
          <p>An owner or guardian signs an ML-DSA-87 intent over <code>&quot;qorechain-msg-v1|qorechain-diana|0x&quot; + lowercase hex(digest)</code>. The vault verifies it with <code>pqcVerify</code> (0x0A01) against the key from <code>pqcKeyStatus</code> (0x0A02), failing closed unless the key is registered, ML-DSA-87 and possession-proven. The relayer only pays gas; <code>PocketRouter</code> forwards only to factory Pockets, <code>PocketDrop</code> and <code>DropPool</code>.</p>
          <p className="text-xs text-zinc-500">The digests this app signs are tested against the contract view functions by eth_call (frontend/test/digests4.live.test.ts).</p>
        </Item>

        <Item n={4} title="The relayer holds no user secret and has a scoped window" action={<SourceBadge kind="LIVE" />}>
          {!h ? <Skeleton className="h-10 w-full" /> : (
            <ul className="list-disc space-y-1 pl-5">
              <li>Relayer <Mono>{h.relayer?.address}</Mono> holds {h.relayer?.balance ?? '–'} QOR.</li>
              <li>EVM window: <strong>{h.window.live ? 'live' : 'closed'}</strong>, {h.window.remainingTxs ?? '–'} txs left, allowed targets: <Mono>{Array.isArray((h.window as { allowedTargets?: string[] }).allowedTargets) ? (h.window as { allowedTargets: string[] }).allowedTargets.join(', ') : '–'}</Mono></li>
              <li>It cannot sign for anyone: <code>POST /api/route</code> simulates each signed intent with eth_call through the router and answers 422 with the decoded error, sending nothing, if it would revert.</li>
              {h.warning && <li className="text-amber-800">{h.warning.message}</li>}
            </ul>
          )}
        </Item>

        <Item n={5} title="Tests and coverage" action={<SourceBadge kind="RECORDED" title="Verified by the orchestrator; see contracts-v4/COVERAGE.md" />}>
          <ul className="grid gap-2 sm:grid-cols-3">
            {[[String(t.total), 'Foundry tests pass', `${t.unit} unit, ${t.fuzz} fuzz, ${t.invariantFns} invariant functions`], ['100%', 'line, statement, branch, function', 'coverage on every file in src/'], ['CI profile', 'fuzz 10,000 runs', 'invariants 256 runs x depth 50']].map(([big, a, b]) => (
              <li key={a} className="rounded-xl bg-stoneBg p-3"><div className="font-money text-3xl leading-none" data-testid={`test-${a.split(' ')[0]}`}>{big}</div><div className="mt-1 text-xs">{a}</div><div className="text-xs text-zinc-500">{b}</div></li>
            ))}
          </ul>
          <p className="text-xs text-zinc-500">{t.verifiedBy}. Foundry cannot fork the native precompiles, so the live suite (<code>contracts-v4/test/live/*.mjs</code>) is the end-to-end proof. <a className="underline" href={blob('contracts-v4/COVERAGE.md')} target="_blank" rel="noopener noreferrer">COVERAGE.md</a></p>
        </Item>

        <Item n={6} title="QCAI audit (two stages)" action={<SourceBadge kind="RECORDED" title="Read from docs/AUDIT.md when this build was made" />}>
          {q.stage1 === 'complete' ? (
            <div data-testid="qcai" className="space-y-1">
              <p><b>Stage 1 complete.</b> Score {q.score}. {q.findings}. Stage 2 (on the final bytecode): {q.stage2}.</p>
              {q.auditId && <p className="font-mono text-xs">Audit ID {q.auditId}</p>}
              <p className="flex flex-wrap gap-3 text-xs"><a className="underline" href={blob('docs/AUDIT.md')} target="_blank" rel="noopener noreferrer">docs/AUDIT.md (triage and resolutions)</a>{q.publicReport && <a className="underline" href={q.publicReport} target="_blank" rel="noopener noreferrer">public report</a>}<a className="underline" href={blob('docs/audit/stage1/QCAI-stage1-2026-11-19.pdf')} target="_blank" rel="noopener noreferrer">Stage 1 PDF</a></p>
            </div>
          ) : <p data-testid="qcai"><b>Stage 1 in progress.</b> <a className="underline" href={blob('docs/AUDIT.md')} target="_blank" rel="noopener noreferrer">docs/AUDIT.md</a> appears when the report is in.</p>}
        </Item>

        <Item n={7} title="Re-verify it yourself in one command" >
          <p><code className="rounded bg-stoneBg px-1.5 py-0.5 font-mono text-xs">node frontend/scripts/reverify.mjs</code> reads the chain (no key, no dependency beyond Node 20) and checks: every v4 contract has code and its recorded keccak, the router points at the factory, drop and pool, the timelock constants match, and every recorded live transaction is mined with the status we claim.</p>
          <a className="inline-block text-xs underline" href={blob('frontend/scripts/reverify.mjs')} target="_blank" rel="noopener noreferrer">reverify.mjs on GitHub</a>
        </Item>

        <Item n={8} title="Try the whole thing yourself">
          <p>Send creates a real drop from your Pocket (a quantum-safe key made in your browser); open the link in another browser to receive into that browser&apos;s Pocket, no wallet. The Pocket tab has the limit, veto, guardians, freeze, recovery and Q-Day Rescue. /radar shows the effect, counted from chain events.</p>
          <div className="flex flex-wrap gap-2"><Link className="rounded-full bg-zinc-900 px-4 py-2 text-xs font-medium text-white" to="/send">Send a drop</Link><Link className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-xs font-medium" to="/pocket">Open the Pocket</Link><Link className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-xs font-medium" to="/radar">Radar</Link></div>
        </Item>

        <Item n={9} title="What it does not do">
          <ul className="space-y-1.5">
            {[
              'Unaudited by humans; QCAI Stage 1 is automated and Stage 2 is not run yet. Testnet only.',
              'A thief who holds the owner key can spend up to the daily limit before the guardians freeze the Pocket (the freeze is guardian-signed, so it is only as fast as your guardians).',
              'A Drop Pool slot goes to a distinct proof-of-possession account, not a person: one person can hold many accounts.',
              'The sender can still lose a link: whoever opens it first becomes the recipient (Confirmed mode adds a 4-word check).',
              'The browser key lives in the browser. Back it up and add guardians; QoreX signing is not used because QoreX is mainnet-only today.',
              'The drip and relayer fee are paid at first open and cannot be recovered by the sender.',
            ].map((l) => <li key={l} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400" aria-hidden />{l}</li>)}
          </ul>
          <Notice tone="warn">Testnet only. QOR on Diana has no monetary value. <a className="underline" href={blob('contracts-v4/KNOWN_ISSUES.md')} target="_blank" rel="noopener noreferrer">KNOWN_ISSUES.md</a></Notice>
          <a className="inline-block text-xs underline" href={SOURCE_URL} target="_blank" rel="noopener noreferrer">Source on GitHub</a>
        </Item>
      </div>
    </div>
  );
}

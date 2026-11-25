import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Check } from '../components/icons';
import { Mono, PageTitle, Skeleton, SourceBadge, Notice } from '../components/ui';
import v4 from '../data/v4.json';
import { addrUrl, SOURCE_URL, TESTNET_BADGE, txUrl } from '../lib/config';
import { dropAbi, poolAbi } from '../lib/abi4';
import { INST } from '../lib/v4';
import { fmtQor, pub } from '../lib/chain';
import { useHealth } from '../lib/queries';
import tests from '../data/tests.json';
import { SamplePoolCard } from '../components/samplePool';
import { REQUIREMENTS } from '../data/requirements';
import selfRelay from '../../evidence/v4/e2e/self-relay-v5.json';
import { COSTS_NOTE, RELAY_COSTS, deliveryCostUqor, deliveryFeeWei } from '../lib/fees';

const blob = (p: string) => `${SOURCE_URL}/blob/main/${p}`;
const CONTRACTS = [['router', 'PocketRouter'], ['factory', 'PocketFactory'], ['vaultImpl', 'PocketVault (clone implementation)'], ['drop', 'PocketDrop'], ['pool', 'DropPool']] as const;

function useFacts() {
  return useQuery({
    queryKey: ['v4-facts'], refetchInterval: 30_000,
    queryFn: async () => {
      // production counts on the current v5 contracts and on the previous v4 contracts, read separately
      const one = async (e: 'prod' | 'prodV4') => {
        const [links, pools, escrow, poolEscrow] = await Promise.all([
          pub.readContract({ address: INST[e].drop, abi: dropAbi, functionName: 'linkCount' }) as Promise<bigint>,
          pub.readContract({ address: INST[e].pool, abi: poolAbi, functionName: 'poolCount' }) as Promise<bigint>,
          pub.getBalance({ address: INST[e].drop }), pub.getBalance({ address: INST[e].pool }),
        ]);
        return { links, pools, escrow, poolEscrow };
      };
      const [v5, v4p] = await Promise.all([one('prod'), one('prodV4')]);
      return { v5, v4: v4p };
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
  const { hash } = useLocation();
  // /judges#costs (linked from Send) lands on that section
  useEffect(() => { if (hash) requestAnimationFrame(() => document.getElementById(hash.slice(1))?.scrollIntoView({ block: 'start' })); }, [hash]);
  const q = v4.qcai as { stage1: string; stage2: string; stage3?: string; report: string | null; auditId?: string | null; score?: string | null; findings?: string | null; publicReport?: string | null; stage2AuditId?: string; stage2Score?: string; stage2PublicReport?: string; stage3AuditId?: string | null; stage3Score?: string | null; stage3Findings?: string | null; stage3PublicReport?: string | null };
  const t = v4.tests;
  return (
    <div className="mx-auto max-w-5xl px-4 pb-28 pt-10 sm:px-6 sm:pb-16 lg:px-8" data-testid="judges">
      <PageTitle eyebrow="60-Second Verification" title="Judges & Auditors Checklist">
        Every number says where it came from. <SourceBadge kind="LIVE" /> was read from the chain or the API when you opened this page. <SourceBadge kind="RECORDED" /> comes from files in the repository. {TESTNET_BADGE}.
      </PageTitle>

      <div className="space-y-3">
        <Item n={1} title="Start here: the Q-Day Drill" action={<SourceBadge kind="LIVE" />}>
          <p>Five real Pockets on Diana have their classical (secp256k1) keys published on the page, as if a quantum computer had already broken them. Each Pocket holds a little QOR. Try to take it, from your own tab: the chain refuses, because only the post-quantum key can move funds. The page lists every attempt the chain refused (EVM reverts and hybrid relays that failed), and a live breach check.</p>
          <p className="text-xs text-zinc-500">The drill also found a bug in our own key derivation (the PQ key could be derived from the classical key) and the fix is part of this build. Details on the page.</p>
          <Link className="inline-block rounded-full bg-zinc-900 px-4 py-2 text-xs font-medium text-white" to="/qday" data-testid="judges-qday">Open the Q-Day Drill</Link>
        </Item>

        <section className="rounded-2xl border border-zinc-200 bg-white p-4 sm:p-5" data-testid="req-table">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h2 className="text-sm font-semibold leading-snug text-zinc-900">Every track requirement: code, live transaction, test</h2>
            <SourceBadge kind="RECORDED" title="Hashes from contracts-v4/deployments/diana.json and frontend/evidence; reverify.mjs re-checks each one" />
          </div>
          <p className="mt-1.5 text-xs text-zinc-500">Each hash opens the explorer. Rows that say reverted are attacks the chain refused. Test names are Foundry tests in <code>contracts-v4/test</code> unless marked.</p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[46rem] border-collapse text-left text-xs">
              <thead><tr className="border-b border-zinc-200 text-zinc-500"><th className="w-[24%] py-2 pr-3 font-medium">Requirement</th><th className="w-[24%] py-2 pr-3 font-medium">Code</th><th className="w-[30%] py-2 pr-3 font-medium">Live on Diana</th><th className="py-2 font-medium">Test</th></tr></thead>
              <tbody>{REQUIREMENTS.map((r) => (
                <tr key={r.id} className="border-b border-zinc-100 align-top last:border-0" data-testid={`req-${r.id}`}>
                  <td className="py-2 pr-3 text-zinc-900">{r.requirement}</td>
                  <td className="py-2 pr-3"><ul className="space-y-1">{r.code.map((c) => <li key={c.path}><a className="break-words underline" href={blob(c.path)} target="_blank" rel="noopener noreferrer">{c.label}</a></li>)}</ul></td>
                  <td className="py-2 pr-3"><ul className="space-y-1">
                    {r.liveHealth && <li data-testid="req-window-live"><SourceBadge kind="LIVE" /> {h ? <>{h.relay ? <>relays {h.relay.mode}, ECDSA-only path {h.relay.classicalPathOpen ? 'open' : 'closed'}; </> : null}window {h.window.live ? 'live' : 'closed'}, allowed targets {(h.window.allowedTargets ?? []).length ? (h.window.allowedTargets ?? []).map((a) => <Mono key={a}>{a.slice(0, 8)}…</Mono>).reduce<React.ReactNode[]>((acc, el, i) => (i ? [...acc, ', ', el] : [el]), []) : '–'}</> : 'reading /api/health…'}</li>}
                    {r.live.map((t) => <li key={t.label}>{t.hash ? <a className="underline" href={txUrl(t.hash)} target="_blank" rel="noopener noreferrer">{t.label}</a> : <>{t.label}{t.note && <span className="text-zinc-500"> ({t.note})</span>}</>}</li>)}
                  </ul></td>
                  <td className="py-2"><ul className="space-y-1 font-mono text-[11px] text-zinc-700">{r.tests.map((t) => <li key={t} className="break-words">{t}</li>)}</ul></td>
                </tr>))}
              </tbody>
            </table>
          </div>
        </section>

        <Item n={2} title="The contracts are on Diana: current v5 (strict PqcLib) and the previous v4, each with production and a 60 s lab" action={<SourceBadge kind="RECORDED" title="Addresses and deploy transactions from contracts-v4/deployments/diana.json" />}>
          <p className="text-xs text-zinc-500">v5 changes only the signature library: exact ML-DSA-87 key and signature sizes are required before the precompile is called, and the key-status reply must have the exact canonical layout (<a className="underline" href={blob('contracts-v4/docs/V5.md')} target="_blank" rel="noopener noreferrer">docs/V5.md</a>). New Pockets, drops and pools use v5. Pockets, links and recorded evidence made on v4 stay on v4 and keep working.</p>
          <div className="overflow-x-auto rounded-xl bg-stoneBg p-3" data-testid="v4-addresses">
            <table className="w-full min-w-[60rem] text-left font-mono text-xs">
              <thead><tr className="text-zinc-500"><th className="pr-3">Contract</th><th className="pr-3">v5 production</th><th className="pr-3">v5 lab</th><th className="pr-3">v4 production (previous)</th><th>v4 lab (previous)</th></tr></thead>
              <tbody>{CONTRACTS.map(([k, label]) => (
                <tr key={k} className="align-top"><td className="pr-3 py-1 text-zinc-700">{label}</td>
                  {(['prod', 'lab', 'prodV4', 'labV4'] as const).map((e) => <td key={e} className="pr-3 py-1"><a className="underline" href={addrUrl(v4.instances[e][k].address)} target="_blank" rel="noopener noreferrer" data-testid={`addr-${e}-${k}`}>{v4.instances[e][k].address}</a> <a className="text-zinc-500 underline" href={txUrl(v4.instances[e][k].deployTx)} target="_blank" rel="noopener noreferrer">deploy tx</a></td>)}
                </tr>))}
              </tbody>
            </table>
          </div>
          {!f ? <Skeleton className="h-12 w-full" /> : (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-xl bg-stoneBg p-3 font-mono text-xs" data-testid="v4-facts">
              <dt className="text-zinc-500">drops created, production v5 / v4 <SourceBadge kind="LIVE" /></dt><dd data-testid="fact-links">{f.v5.links.toString()} / {f.v4.links.toString()}</dd>
              <dt className="text-zinc-500">pools created, production v5 / v4</dt><dd>{f.v5.pools.toString()} / {f.v4.pools.toString()}</dd>
              <dt className="text-zinc-500">escrow held v5 (drops / pools)</dt><dd>{fmtQor(f.v5.escrow)} / {fmtQor(f.v5.poolEscrow)} QOR</dd>
              <dt className="text-zinc-500">escrow held v4 (drops / pools)</dt><dd>{fmtQor(f.v4.escrow)} / {fmtQor(f.v4.poolEscrow)} QOR</dd>
              <dt className="text-zinc-500">timelock / recovery / freeze / unanimous</dt><dd>{Number(v4.instances.prod.readBack.TIMELOCK) / 3600} h / {Number(v4.instances.prod.readBack.RECOVERY_DELAY) / 3600} h / {Number(v4.instances.prod.readBack.FREEZE_PERIOD) / 3600} h / {Number(v4.instances.prod.readBack.UNANIMOUS_RECOVERY_DELAY) / 3600} h</dd>
            </dl>
          )}
          <p className="text-xs text-zinc-500">No owner, no admin, no upgradeability. The relayer only ever calls the routers (v5 and v4; hybrid cross-VM calls; the fallback EVM window is scoped to the same targets), so it cannot reach a Pocket or the drop contract directly.</p>
        </Item>

        <Item n={3} title="The attacks, including a stolen key, are refused on-chain" action={<SourceBadge kind="RECORDED" />}>
          <p>{v4.liveRows.filter((r) => r.status === 'reverted' || r.status === 'refused').length} attack rows, each a mined revert (or a chain refusal at broadcast) with an explorer link, including the stolen-key freeze and unanimous-recovery scenario. The Lab re-checks them against the chain live.</p>
          <Link className="inline-block rounded-full bg-zinc-900 px-4 py-2 text-xs font-medium text-white" to="/lab">Open the lab</Link>
        </Item>

        <Item n={4} title="Every sensitive action is a post-quantum intent, checked on-chain" >
          <p>An owner or guardian signs an ML-DSA-87 intent over <code>&quot;qorechain-msg-v1|qorechain-diana|0x&quot; + lowercase hex(digest)</code>. The vault verifies it with <code>pqcVerify</code> (0x0A01) against the key from <code>pqcKeyStatus</code> (0x0A02), failing closed unless the key is registered, ML-DSA-87 and possession-proven. The relayer only pays gas; <code>PocketRouter</code> forwards only to factory Pockets, <code>PocketDrop</code> and <code>DropPool</code>.</p>
          <p className="text-xs text-zinc-500">The digests this app signs are tested against the contract view functions by eth_call (frontend/test/digests4.live.test.ts).</p>
          <p data-testid="judges-check">Do not take our word for a signature: <Link className="underline" to="/check">Proof &gt; Check a transaction</Link> fetches any recorded transaction from the chain and re-verifies its ML-DSA-87 signatures in your browser with <code>@qorechain/qoresign</code>, including a refused Q-Day attack.</p>
        </Item>

        <Item n={5} title="The relayer holds no user secret, and every relay carries a post-quantum signature" action={<SourceBadge kind="LIVE" />}>
          {!h ? <Skeleton className="h-10 w-full" /> : (
            <ul className="list-disc space-y-1 pl-5" data-testid="judges-relayer">
              <li>Relayer <Mono>{h.relayer?.address}</Mono> holds {h.relayer?.balance ?? '–'} QOR.</li>
              {h.relay?.mode === 'hybrid'
                ? <li data-testid="judges-relay-mode">Relays: <strong>hybrid</strong>. Each one is a <code>MsgCrossVMCall</code> signed with secp256k1 + ML-DSA-87; the chain checks both before the EVM runs. ECDSA-only path: <strong>{h.relay.classicalPathOpen ? 'open' : 'closed'}</strong>{h.relay.classicalPathOpen ? ` (EVM window, ${h.window.remainingBlocks ?? '–'} blocks left)` : ''}. <Link className="underline" to="/check/04AA17839F57179DA8EC58454F1CD1CEBDDA4D883C86376B4CD92720AF56D445">Re-verify one relay in your browser</Link>.</li>
                : <li data-testid="judges-relay-mode">Relays: EVM window <strong>{h.window.live ? 'live' : 'closed'}</strong>, {h.window.remainingTxs ?? '–'} txs left, allowed targets: <Mono>{Array.isArray((h.window as { allowedTargets?: string[] }).allowedTargets) ? (h.window as { allowedTargets: string[] }).allowedTargets.join(', ') : '–'}</Mono></li>}
              <li>It cannot sign for anyone: <code>POST /api/route</code> simulates each signed intent with eth_call through the router and answers 422 with the decoded error, sending nothing, if it would revert.</li>
              {h.warning && <li className="text-amber-800">{h.warning.message}</li>}
              {(h.warnings ?? []).map((w) => <li key={w.kind} className="text-amber-800">{w.message}</li>)}
            </ul>
          )}
        </Item>

        <Item n={6} title="Relay it yourself: a live scoped EVM window opened by the user" action={<SourceBadge kind="RECORDED" />}>
          <p data-testid="judges-self-relay">This proves a live scoped EVM window per user, on the deployed v5 contracts. <code>PocketRouter.relay</code> has no caller check, so the user's own account can submit the call it signed. A fresh test account (it started with 0 QOR; the link's drip paid its fees) registered its ML-DSA-87 key, opened its own hybrid-signed window scoped to the one v5 router ({selfRelay.recipientWindow.blocks} blocks, {selfRelay.recipientWindow.maxTxs} txs, expiry height {selfRelay.recipientWindow.expiryHeight}), then sent its own claim and its own first spend, and closed the window. Our relayer and API are in none of these transactions. The app offers the same path when the relayer is down or slow, and as an Advanced setting on /pocket.</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm" data-testid="judges-self-relay-txs">
            {selfRelay.rows.filter((r) => r.hash && (r.step.startsWith('recipient') || r.step.startsWith('U'))).map((r) => (
              <li key={r.hash}>{r.step}: <a className="font-mono text-xs underline" href={txUrl(r.hash as string)} target="_blank" rel="noreferrer">{(r.hash as string).slice(0, 14)}…</a></li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-zinc-500">Test accounts, Diana testnet. Re-checked by <code>reverify.mjs</code> section 11 (window scope and caps, submitter = that account, window closed now). Script: <code>contracts-v4/script/self-relay-v5.mjs</code>.</p>
        </Item>

        <section id="costs" className="scroll-mt-20 rounded-2xl border border-zinc-200 bg-white p-4 sm:p-5" data-testid="cost-table">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h2 className="text-sm font-semibold leading-snug text-zinc-900">What each action costs, and who pays</h2>
            <SourceBadge kind="RECORDED" title="frontend/src/data/relayCosts.json, built from frontend/evidence/v4/e2e/hybrid-relay*.json by scripts/relay-costs.mjs" />
          </div>
          <p className="mt-1.5 text-xs text-zinc-500">{COSTS_NOTE} Users never hold QOR for gas: the relayer pays every network fee. The delivery fee in a drop pays it back for the relays that link needs (bind and claim, plus confirm in Confirmed mode): {fmtQor(deliveryFeeWei('Open'))} QOR Open, {fmtQor(deliveryFeeWei('Confirmed'))} QOR Confirmed (recorded {(deliveryCostUqor('Open') / 1e6).toFixed(3)} / {(deliveryCostUqor('Confirmed') / 1e6).toFixed(3)} QOR, plus 15 %). Everything else is paid from the team&apos;s relayer float on testnet. Each hash opens the checker, which re-reads the transaction from the chain.</p>
          <p className="mt-1.5 text-xs text-zinc-700" data-testid="cost-float"><SourceBadge kind="LIVE" /> Relayer float now: {h?.relayer?.balance ? <b data-testid="cost-float-qor">{Number(h.relayer.balance).toFixed(3)} QOR</b> : "…"}</p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[40rem] border-collapse text-left text-xs">
              <thead><tr className="border-b border-zinc-200 text-zinc-500"><th className="py-2 pr-3 font-medium">Action</th><th className="py-2 pr-3 font-medium">Asked by</th><th className="py-2 pr-3 font-medium">Paid from</th><th className="py-2 pr-3 text-right font-medium">Network fee (QOR)</th><th className="py-2 font-medium">Recorded tx</th></tr></thead>
              <tbody>{RELAY_COSTS.map((r) => (
                <tr key={r.id} className="border-b border-zinc-100 align-top last:border-0" data-testid={`cost-${r.id}`}>
                  <td className="py-2 pr-3 text-zinc-900">{r.label}</td>
                  <td className="py-2 pr-3 text-zinc-700">{r.who}</td>
                  <td className="py-2 pr-3 text-zinc-700">{r.payer}</td>
                  <td className="py-2 pr-3 text-right font-mono text-zinc-900">{r.minUqor === r.maxUqor ? (r.maxUqor / 1e6).toFixed(3) : `${(r.minUqor / 1e6).toFixed(3)} to ${(r.maxUqor / 1e6).toFixed(3)}`}<span className="block text-[11px] text-zinc-500">{r.n} tx{r.n === 1 ? '' : 's'}</span></td>
                  <td className="py-2"><Link className="font-mono underline" to={`/check/${r.example}`}>{r.example.slice(0, 8)}…</Link>{r.exampleCode !== 0 && <span className="text-zinc-500"> (refused, code {r.exampleCode})</span>}</td>
                </tr>))}
              </tbody>
            </table>
          </div>
        </section>

        <Item n={7} title="Tests and coverage" action={<SourceBadge kind="RECORDED" title="Verified by the orchestrator; see contracts-v4/COVERAGE.md" />}>
          <ul className="grid gap-2 sm:grid-cols-3">
            {[[String(t.total), 'Foundry tests pass', `${t.unit} unit, ${t.fuzz} fuzz, ${t.invariantFns} invariant functions`], ['100%', 'line, statement, branch, function', 'coverage on every file in src/'], ['CI profile', 'fuzz 10,000 runs', 'invariants 256 runs x depth 50']].map(([big, a, b]) => (
              <li key={a} className="rounded-xl bg-stoneBg p-3"><div className="font-money text-3xl leading-none" data-testid={`test-${a.split(' ')[0]}`}>{big}</div><div className="mt-1 text-xs">{a}</div><div className="text-xs text-zinc-500">{b}</div></li>
            ))}
          </ul>
          <p className="text-sm" data-testid="test-others">Also {tests.frontend.passed} frontend and {tests.backend.passed} backend unit tests pass ({tests.frontend.failed + tests.backend.failed} failed, {tests.backend.skipped} skipped live-chain tests), recorded by <code>frontend/scripts/count-tests.mjs</code> on {tests.recordedAt.slice(0, 10)}.</p>
          <p className="text-xs text-zinc-500">{t.verifiedBy}. Foundry cannot fork the native precompiles, so the live suite (<code>contracts-v4/test/live/*.mjs</code>) is the end-to-end proof. <a className="underline" href={blob('contracts-v4/COVERAGE.md')} target="_blank" rel="noopener noreferrer">COVERAGE.md</a></p>
        </Item>

        <Item n={8} title="QCAI audit (three stages)" action={<SourceBadge kind="RECORDED" title="Read from docs/AUDIT.md when this build was made" />}>
          {q.stage1 === 'complete' ? (
            <div data-testid="qcai" className="space-y-1">
              <p><b>Stage 1 (v4):</b> score {q.score}, {q.findings}. <b>Stage 2 (v4):</b> {q.stage2 === 'complete' ? <>score {q.stage2Score}.</> : 'not run yet.'} <b>Stage 3 (v5):</b> {q.stage3 === 'complete' ? <>score {q.stage3Score}{q.stage3Findings ? `, ${q.stage3Findings}` : ''}.</> : 'not run yet.'} All are automated QCAI audits; there was no human audit.</p>
              {q.auditId && <p className="break-all font-mono text-xs">Stage 1 ID {q.auditId}{q.stage2AuditId ? ` · Stage 2 ID ${q.stage2AuditId}` : ''}{q.stage3AuditId ? ` · Stage 3 ID ${q.stage3AuditId}` : ''}</p>}
              <p className="flex flex-wrap gap-3 text-xs"><a className="underline" href={blob('docs/AUDIT.md')} target="_blank" rel="noopener noreferrer">docs/AUDIT.md (triage and resolutions)</a>{q.publicReport && <a className="underline" href={q.publicReport} target="_blank" rel="noopener noreferrer">Stage 1 public report</a>}{q.stage2PublicReport && <a className="underline" href={q.stage2PublicReport} target="_blank" rel="noopener noreferrer">Stage 2 public report</a>}<a className="underline" href={blob('docs/audit/stage1/QCAI-stage1-2026-11-19.pdf')} target="_blank" rel="noopener noreferrer">Stage 1 PDF</a>{q.stage3PublicReport && <a className="underline" href={q.stage3PublicReport} target="_blank" rel="noopener noreferrer">Stage 3 public report</a>}{q.stage3 === 'complete' && <a className="underline" href={blob('docs/audit/stage3/QCAI-stage3-v5.pdf')} target="_blank" rel="noopener noreferrer">Stage 3 PDF (v5)</a>}</p>
            </div>
          ) : <p data-testid="qcai"><b>Stage 1 in progress.</b> <a className="underline" href={blob('docs/AUDIT.md')} target="_blank" rel="noopener noreferrer">docs/AUDIT.md</a> appears when the report is in.</p>}
        </Item>

        <Item n={9} title="Re-verify it yourself in one command" >
          <p><code className="rounded bg-stoneBg px-1.5 py-0.5 font-mono text-xs">node frontend/scripts/reverify.mjs</code> reads the chain (no key, no dependency beyond Node 20) and checks: every v4 contract has code and its recorded keccak, the router points at the factory, drop and pool, the timelock constants match, and every recorded live transaction is mined with the status we claim.</p>
          <a className="inline-block text-xs underline" href={blob('frontend/scripts/reverify.mjs')} target="_blank" rel="noopener noreferrer">reverify.mjs on GitHub</a>
        </Item>

        <Item n={10} title="Try the whole thing yourself">
          <p>Send creates a real drop from your Pocket (a quantum-safe key made in your browser); open the link in another browser to receive into that browser&apos;s Pocket, no wallet. The Pocket tab has the limit, veto, guardians, freeze, recovery and Q-Day Rescue. /radar shows the effect, counted from chain events.</p>
          <div className="flex flex-wrap gap-2"><Link className="rounded-full bg-zinc-900 px-4 py-2 text-xs font-medium text-white" to="/send">Send a drop</Link><Link className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-xs font-medium" to="/pocket">Open the Pocket</Link><Link className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-xs font-medium" to="/radar">Radar</Link></div>
          <SamplePoolCard compact />
        </Item>

        <Item n={11} title="What it does not do">
          <ul className="space-y-1.5">
            {[
              `No human audit. Automated QCAI audits: Stage 1 (v4) ${q.score ?? ''}, Stage 2 (v4) ${q.stage2Score ?? 'not run'}, Stage 3 (v5) ${q.stage3Score ?? 'not run'} (findings and triage in docs/AUDIT.md). Testnet only.`,
              'A thief who holds the owner key can spend up to the daily limit before the guardians freeze the Pocket (the freeze is guardian-signed, so it is only as fast as your guardians).',
              'A Drop Pool slot goes to a distinct proof-of-possession account, not a person: one person can hold many accounts.',
              'The sender can still lose a link: whoever opens it first becomes the recipient (Confirmed mode adds a 4-word check).',
              'The browser key lives in the browser. Back it up and add guardians. QoreX can fund a Pocket, and one real QoreX signature has spent a Pocket through the router (TEAM-RUN), but the default flow signs with the browser key.',
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

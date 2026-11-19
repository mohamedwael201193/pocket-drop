import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Check } from 'lucide-react';
import { Mono, PageTitle, Skeleton, SourceBadge, TxLink, Notice } from '../components/ui';
import { KNOWN_LIMITS, REC, TESTS } from '../data/proofs';
import { addrUrl, LAB_ADDRESS, POCKETDROP_ADDRESS, SOURCE_URL, TESTNET_BADGE } from '../lib/config';
import { fmtQor, pub } from '../lib/chain';
import { pocketDropAbi } from '../lib/abi';
import { useHealth } from '../lib/queries';

function useContractFacts() {
  return useQuery({
    queryKey: ['facts'],
    refetchInterval: 20_000,
    queryFn: async () => {
      const read = (functionName: 'MIN_ESCROW' | 'MAX_AMOUNT' | 'MAX_DRIP' | 'DAILY_DRIP_CAP' | 'BIND_TIMEOUT' | 'MAX_EXPIRY' | 'linkCount') =>
        pub.readContract({ address: POCKETDROP_ADDRESS, abi: pocketDropAbi, functionName }) as Promise<bigint>;
      const [minEscrow, maxAmount, maxDrip, dailyCap, bindTimeout, linkCount, code, balance] = await Promise.all([
        read('MIN_ESCROW'), read('MAX_AMOUNT'), read('MAX_DRIP'), read('DAILY_DRIP_CAP'), read('BIND_TIMEOUT'), read('linkCount'),
        pub.getCode({ address: POCKETDROP_ADDRESS }), pub.getBalance({ address: POCKETDROP_ADDRESS }),
      ]);
      return { minEscrow, maxAmount, maxDrip, dailyCap, bindTimeout, linkCount, codeBytes: ((code?.length ?? 2) - 2) / 2, balance };
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
  const { data: f } = useContractFacts();
  const { data: h } = useHealth();
  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8" data-testid="judges">
      <PageTitle eyebrow="60-Second Verification" title="Judges & Auditors Checklist">
        Every number says where it came from. <SourceBadge kind="LIVE" /> was read from the chain or the API when you opened this page. <SourceBadge kind="RECORDED" /> comes from files in the repository. {TESTNET_BADGE}.
      </PageTitle>

      <div className="space-y-3">
        <Item n={1} title="The contract is on Diana and matches what we say" action={<SourceBadge kind="LIVE" />}>
          <div>Main <a className="underline" href={addrUrl(POCKETDROP_ADDRESS)} target="_blank" rel="noopener noreferrer"><Mono>{POCKETDROP_ADDRESS}</Mono></a></div>
          <div>Lab <a className="underline" href={addrUrl(LAB_ADDRESS)} target="_blank" rel="noopener noreferrer"><Mono>{LAB_ADDRESS}</Mono></a> (same bytecode, 60 s bind timeout)</div>
          {!f ? <Skeleton className="h-20 w-full" /> : (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-xl bg-stoneBg p-3 font-mono text-xs" data-testid="contract-facts">
              <dt className="text-zinc-500">links created</dt><dd data-testid="fact-linkcount">{f.linkCount.toString()}</dd>
              <dt className="text-zinc-500">escrow held now</dt><dd>{fmtQor(f.balance)} QOR</dd>
              <dt className="text-zinc-500">min / max per link</dt><dd>{fmtQor(f.minEscrow)} / {fmtQor(f.maxAmount)} QOR</dd>
              <dt className="text-zinc-500">max drip / daily cap</dt><dd>{fmtQor(f.maxDrip)} / {fmtQor(f.dailyCap)} QOR</dd>
              <dt className="text-zinc-500">bind timeout</dt><dd>{f.bindTimeout.toString()} s</dd>
              <dt className="text-zinc-500">runtime code</dt><dd>{f.codeBytes} bytes (recorded {REC.build.runtimeCodeBytes})</dd>
            </dl>
          )}
          <div className="flex flex-wrap items-center gap-2 text-xs"><SourceBadge kind="RECORDED" /> deployed in block {REC.main.blockNumber}: <TxLink hash={REC.main.deployTx} /></div>
        </Item>

        <Item n={2} title="The six attacks are refused on-chain" action={<SourceBadge kind="RECORDED" />}>
          <p>Six mined transactions that reverted with a named custom error. The Lab page re-runs each one against the chain state it faced and decodes the revert live.</p>
          <Link className="inline-block rounded-full bg-zinc-900 px-4 py-2 text-xs font-medium text-white" to="/lab">Open the lab</Link>
        </Item>

        <Item n={3} title="Dual-precompile money path (0x0A01 + 0x0A02)" action={<Link className="rounded-full border border-zinc-300 px-4 py-2 text-xs font-medium hover:bg-stoneCard" to="/lab">Inspect 6 reverts →</Link>}>
          <p><code>bind()</code> verifies the link ML-DSA-87 key via <code>0x0A01</code>; <code>claim()</code> enforces <code>possessionProven</code> via <code>0x0A02</code> and the recipient signature via <code>0x0A01</code>. A missing or legacy key fails closed (attacks 3 and 4).</p>
        </Item>

        <Item n={4} title="The relayer holds no user secret and has a scoped window" action={<SourceBadge kind="LIVE" />}>
          {!h ? <Skeleton className="h-10 w-full" /> : (
            <ul className="list-disc space-y-1 pl-5">
              <li>Relayer <Mono>{h.relayer?.address}</Mono> holds {h.relayer?.balance ?? '–'} QOR.</li>
              <li>EVM window: <strong>{h.window.live ? 'live' : 'closed'}</strong>, {h.window.remainingTxs ?? '–'} txs left, allowed targets: <Mono>{Array.isArray((h.window as { allowedTargets?: string[] }).allowedTargets) ? (h.window as { allowedTargets?: string[] }).allowedTargets!.join(', ') : '–'}</Mono></li>
              <li>It can only submit payloads that users signed. Swapping the recipient fails with BadLinkSignature (attack 1).</li>
              {h.warning && <li className="text-amber-800">{h.warning.message}</li>}
            </ul>
          )}
        </Item>

        <Item n={5} title="Tests and coverage" action={<SourceBadge kind="RECORDED" title="Ran in this build session; raw output saved in the repository's evidence folder" />}>
          <ul className="grid gap-2 sm:grid-cols-3">
            {[
              [`${TESTS.foundry.passed}/${TESTS.foundry.total}`, 'Foundry tests pass', `incl. ${TESTS.foundry.fuzzRuns.toLocaleString()} fuzz runs, invariants`],
              [`${TESTS.coverage.lines}`, 'lines covered (100%)', `branches ${TESTS.coverage.branches} (100%)`],
              [`${TESTS.backend.passed}`, 'backend tests pass', `${TESTS.backend.skipped} live-only skipped`],
            ].map(([big, a, b]) => (
              <li key={a} className="rounded-xl bg-stoneBg p-3"><div className="font-serif text-3xl leading-none" data-testid={`test-${a.split(' ')[0]}`}>{big}</div><div className="mt-1 text-xs">{a}</div><div className="text-[11px] text-zinc-500">{b}</div></li>
            ))}
          </ul>
          <p className="text-xs text-zinc-500">Verified on {TESTS.verifiedOn} by running <code>{TESTS.foundry.command}</code> and <code>forge coverage</code> in <code>contracts/</code>, and <code>{TESTS.backend.command}</code>. The frontend adds unit tests whose bind and claim digests are checked against the live contract's <code>bindDigest</code> and <code>claimDigest</code>.</p>
        </Item>

        <Item n={6} title="Try the whole thing yourself" >
          <p>The dashboard creates a real link from a browser account. Open the link in another browser to receive without any wallet. /radar shows the effect, indexed from chain events.</p>
          <div className="flex flex-wrap gap-2"><Link className="rounded-full bg-zinc-900 px-4 py-2 text-xs font-medium text-white" to="/dashboard">Send a Drop</Link><Link className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-xs font-medium" to="/radar">/radar</Link></div>
        </Item>

        <Item n={7} title="What it does not do">
          <ul className="space-y-1.5">
            {KNOWN_LIMITS.map((l) => <li key={l} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400" aria-hidden />{l}</li>)}
          </ul>
          <Notice tone="warn">Testnet only. Nothing here is audited, and QOR on Diana has no monetary value.</Notice>
          <a className="inline-block text-xs underline" href={SOURCE_URL} target="_blank" rel="noopener noreferrer">Source and SECURITY.md on GitHub</a>
        </Item>
      </div>
    </div>
  );
}

// Proof > Check a transaction: paste a Pocket Drop transaction hash; the page fetches it from the chain, decodes the router call
// and re-runs every ML-DSA-87 signature check in this browser with the keys the chain holds. Our API is not trusted for any of it.
import { useMutation } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { Button, CopyButton, Mono, Notice, PageTitle, SourceBadge, TxLink } from '../components/ui';
import { addrUrl, TESTNET_BADGE } from '../lib/config';
import { checkTx, normalizeHash, verdict, type Report, type SigCheck } from '../lib/txcheck';
import { liveDeps, withQoresign } from '../lib/txcheckChain';
import { PowerMap, pocketEnv } from '../components/powers';
import { useQuery } from '@tanstack/react-query';
import type { Hex } from 'viem';

const isAddr = (s: string) => /^0x[0-9a-fA-F]{40}$/.test(s.trim());

function PocketView({ address }: { address: Hex }) {
  const q = useQuery({ queryKey: ['pocket-env', address], queryFn: () => pocketEnv(address) });
  if (q.isLoading) return <p className="text-sm text-zinc-600" data-testid="check-busy">Looking the address up in both Pocket factories…</p>;
  if (q.error) return <Notice tone="error" testId="check-error">{(q.error as Error).message}</Notice>;
  if (!q.data) return <Notice tone="info" testId="check-not-pocket">Neither Pocket factory deployed this address, so it is not a Pocket (or not deployed yet: a Pocket is deployed by its first drop or spend).</Notice>;
  return <PowerMap env={q.data} address={address} />;
}

const WHO: Record<SigCheck['who'], string> = {
  owner: "Pocket owner's post-quantum key",
  guardian: "guardian's post-quantum key",
  'link key': 'one-time link key (its seed was in the link)',
  recipient: "recipient's post-quantum key",
};

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return <div className="grid grid-cols-1 gap-0.5 py-1.5 sm:grid-cols-[11rem_1fr] sm:gap-3"><dt className="text-xs text-zinc-500">{k}</dt><dd className="min-w-0 break-words text-sm text-zinc-900 [overflow-wrap:anywhere]">{children}</dd></div>;
}

function Check({ c, i }: { c: SigCheck; i: number }) {
  const ok = c.valid && !c.tamperedValid && c.pinned !== false;
  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-4 sm:p-5" data-testid={`check-sig-${i}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-zinc-900">Signature {i + 1}: {WHO[c.who]}</h3>
        <span data-testid={`check-sig-${i}-verdict`} className={ok ? 'rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-900' : 'rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-900'}>{ok ? 'valid' : 'did not check out'}</span>
      </div>
      <dl className="mt-2 divide-y divide-zinc-100">
        <Row k="Signer"><a className="font-mono text-xs underline" href={addrUrl(c.signer)} target="_blank" rel="noopener noreferrer">{c.signer}</a></Row>
        <Row k="Public key">{c.pkBytes ? <>{c.pkBytes.toLocaleString('en-US')} bytes, {c.keySource === 'chain' ? 'read from the chain (PQC precompile 0x…0a02)' : 'carried in the call'}{c.pinned === true && ', and its hash matches the one pinned on chain'}{c.pinned === false && <b className="text-red-800">; its hash does NOT match the one pinned on chain</b>}</> : <b className="text-red-800">no key registered on chain</b>}</Row>
        <Row k="Signature">{c.sigBytes.toLocaleString('en-US')} bytes, ML-DSA-87 (FIPS 204)</Row>
        {c.nonce !== undefined && <Row k="Nonce">{c.nonce.toString()} (read from the chain at the block before)</Row>}
        <Row k="Signed text"><span className="flex flex-col items-start gap-1.5"><Mono className="text-xs">{c.message}</Mono><span className="shrink-0"><CopyButton text={c.message} label="Copy signed text" /></span></span></Row>
        <Row k="Checked in this browser"><span data-testid={`check-sig-${i}-valid`}>{c.valid ? 'Valid for this exact intent.' : 'Not valid for this intent.'}</span></Row>
        {c.qoresign && <Row k="Second library"><span data-testid={`check-sig-${i}-qoresign`}>@qorechain/qoresign (the message format QoreX signs) builds {c.qoresign.sameText ? 'the same signed text' : <b className="text-red-800">a different signed text</b>} and finds the signature {c.qoresign.valid ? 'valid' : <b className="text-red-800">not valid</b>}.</span></Row>}
        <Row k="Changed intent"><span data-testid={`check-sig-${i}-tampered`}>{c.tamperedValid ? <b className="text-red-800">The same signature also passes a changed intent ({c.tamperedWhat}).</b> : <>Same signature, changed intent ({c.tamperedWhat}): rejected.</>}</span></Row>
      </dl>
    </section>
  );
}

function ReportView({ r }: { r: Report }) {
  const v = verdict(r);
  return (
    <div className="space-y-3" data-testid="check-report">
      <Notice tone={v === 'verified' || v === 'refused' ? 'ok' : v === 'failed' ? 'error' : 'info'} testId="check-verdict">
        {v === 'verified' && <>All {r.checks.length} post-quantum signature{r.checks.length > 1 ? 's' : ''} in this transaction verified in your browser, with keys read from the chain. A changed intent fails with the same signature.</>}
        {v === 'failed' && <>At least one signature did not check out in this browser. Details below.</>}
        {v === 'refused' && <>Refused attempt: this transaction reverted, and the signature it carried is not a valid ML-DSA-87 signature from the key on chain. The contract refused it for the reason shown below.</>}
        {v === 'none' && <>{r.note ?? 'Nothing to check.'}</>}
      </Notice>
      <section className="rounded-2xl border border-zinc-200 bg-white p-4 sm:p-5" data-testid="check-tx">
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-semibold text-zinc-900">Transaction</h2><SourceBadge kind="LIVE" title="Fetched from the chain when you pressed Check" /></div>
        <dl className="mt-2 divide-y divide-zinc-100">
          <Row k="Hash"><TxLink hash={r.tx.hash} label={`${r.tx.hash.slice(0, 12)}…${r.tx.hash.slice(-6)}`} /></Row>
          <Row k="Result">{r.tx.ok ? 'succeeded' : 'failed (reverted)'} at block {r.tx.height.toString()}</Row>
          <Row k="Relayer signature"><span data-testid="check-lane">{r.tx.lane === 'hybrid'
            ? <>Hybrid: secp256k1 + ML-DSA-87 on a native cross-VM call. The chain's own check: {r.tx.relayerHybridVerified ? <b>pqc_hybrid_verify = verified</b> : 'no pqc_hybrid_verify event'}.</>
            : <>EVM transaction (secp256k1), sent inside the relayer's scoped window. The relayer only pays gas; the signatures below are what move funds.</>}</span></Row>
          {r.env && <Row k="Instance">{r.env === 'prod' ? 'production' : 'lab (60 s timers)'}</Row>}
          <Row k="Call"><Mono className="text-xs">router.{r.action}{r.fn ? ` → ${r.fn}` : ''}</Mono>{r.target && <> on <a className="font-mono text-xs underline" href={addrUrl(r.target)} target="_blank" rel="noopener noreferrer">{r.target.slice(0, 10)}…</a></>}</Row>
          {r.tx.memo && <Row k="Memo"><Mono className="text-xs">{r.tx.memo}</Mono></Row>}
        </dl>
        {Object.keys(r.args).length > 0 && (
          <details className="mt-2 text-sm"><summary className="cursor-pointer text-xs text-zinc-600">Decoded arguments</summary>
            <dl className="mt-1 divide-y divide-zinc-100">{Object.entries(r.args).map(([k, val]) => <Row key={k} k={k}><Mono className="text-xs">{val}</Mono></Row>)}</dl>
          </details>
        )}
      </section>
      {r.checks.map((c, i) => <Check key={i} c={c} i={i} />)}
    </div>
  );
}

export default function CheckTxPage() {
  const { hash: param } = useParams();
  const nav = useNavigate();
  const [text, setText] = useState(param ?? '');
  const m = useMutation({ mutationFn: async (h: string) => checkTx(h, await withQoresign(liveDeps)) });
  const { mutate } = m;
  const paramAddr = param && isAddr(param) ? (param as Hex) : null;
  useEffect(() => { if (param && normalizeHash(param)) mutate(param); }, [param, mutate]);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isAddr(text)) { nav(`/check/${text.trim()}`); return; }
    const h = normalizeHash(text);
    if (!h) return;
    if (h === param) mutate(h); else nav(`/check/${h}`);
  };
  const bad = text.trim() !== '' && !normalizeHash(text) && !isAddr(text);
  return (
    <div className="mx-auto max-w-3xl px-4 pb-28 pt-10 sm:px-6 sm:pb-16" data-testid="check-page">
      <PageTitle eyebrow="Proof" title="Check a transaction">
        Paste the hash of any Pocket Drop transaction. This page fetches it from the chain, decodes what it asked for, and re-runs each
        ML-DSA-87 signature check in your browser with the public keys the chain holds. Our server is not involved. Paste a Pocket
        address instead to see who can do what with it. {TESTNET_BADGE}.
      </PageTitle>
      <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row" data-testid="check-form">
        <label className="sr-only" htmlFor="check-hash">Transaction hash</label>
        <input id="check-hash" data-testid="check-input" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} autoComplete="off"
          placeholder="tx hash (0x… or 64 hex) or a Pocket address" className="min-w-0 flex-1 rounded-xl border border-zinc-300 bg-white px-3 py-2.5 font-mono text-sm text-zinc-900" />
        <Button type="submit" busy={m.isPending} disabled={!normalizeHash(text) && !isAddr(text)} data-testid="check-submit">Check</Button>
      </form>
      {bad && <p className="mt-2 text-xs text-red-800" data-testid="check-bad">A hash is 64 hex characters (with 0x for an EVM transaction); an address is 0x + 40 hex characters.</p>}
      {(!param || (!normalizeHash(param) && !isAddr(param))) && (
        <p className="mt-3 text-sm text-zinc-600" data-testid="check-examples">Transaction results in Send, Receive, Pocket and Radar carry a “check” link that opens this page. Examples recorded on Diana:{' '}
          <Link className="underline" to="/check/E64662F8E0503C8A2C18E267A52ABE2670958E22A8BF6B10C6563FEFB9864FC8" data-testid="check-example-claim">a claim</Link>,{' '}
          <Link className="underline" to="/check/0x0c653400b781cf9501a28d76b1ace95dfb6398282b0f053e5d7c61a60e769007" data-testid="check-example-freeze">a 2-of-3 guardian freeze</Link>,{' '}
          <Link className="underline" to="/check/FB826A14E7E1A8A6271E9489E2BA12BF17075CC793479720F981594F758F00D3" data-testid="check-example-refused">a refused Q-Day attack</Link>,{' '}
          <Link className="underline" to="/check/0x31368D55a0fD1983397ffc5D85dB3bdd482a11cE" data-testid="check-example-pocket">a guarded Q-Day bait Pocket</Link>.
        </p>
      )}
      <div className="mt-5">
        {!paramAddr && m.isPending && <p className="text-sm text-zinc-600" data-testid="check-busy">Fetching the transaction and verifying…</p>}
        {!paramAddr && m.error && <Notice tone="error" testId="check-error">{(m.error as Error).message}</Notice>}
        {paramAddr ? <PocketView address={paramAddr} /> : m.data && <ReportView r={m.data} />}
      </div>
    </div>
  );
}

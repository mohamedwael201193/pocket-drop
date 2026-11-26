import { useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Gift, ShieldCheck, Users } from '../components/icons';
import { Button, Mono, Notice, Page, PageTitle, Pill, SourceBadge, StepCard, TxLink, cx } from '../components/ui';
import { ActivationCard, ConnectChoices, KEY_ACCOUNT_MIN_WEI, PocketCard } from '../components/account';
import { amountFormatProblem, countProblem } from '../lib/validate';
import { ShareCard } from '../components/share';
import { ConfirmCard, LinkRow, type OnTx } from '../components/links';
import { useAccount, useKeyAccount, usePocketView } from '../lib/account';
import { useMyLinks } from '../lib/hooks4';
import { createDrop, createPool } from '../lib/actions';
import { claimUrl4, linkId4 } from '../lib/claim4';
import { rememberNonce } from '../lib/links4';
import { DEFAULTS, INST, REGISTRATION_FEE_WEI, createdId } from '../lib/v4';
import { deliveryFeeWei, deliverySteps } from '../lib/fees';
import { OPEN_ACK_ABOVE_WEI, openNeedsAck, justMadeDrop } from '../lib/sendMode';
import { explainError } from '../lib/api';
import { isCancelled } from '../lib/signReview';
import { fmtQor, parseQor } from '../lib/chain';
import { useSponsorStatus } from '../lib/sponsor';
import { Celebrate } from '../components/alive';

export function SendTabs() {
  const cls = ({ isActive }: { isActive: boolean }) => cx('flex-1 rounded-full px-4 py-2 text-center text-sm font-medium', isActive ? 'bg-zinc-900 text-stone-100' : 'text-zinc-600');
  return (
    <nav className="mb-6 flex gap-1 rounded-full border border-zinc-200 bg-white/80 p-1" aria-label="Send views">
      <NavLink to="/send" end className={cls} data-testid="send-new">New drop</NavLink>
      <NavLink to="/send/inbox" className={cls} data-testid="send-inbox">Inbox</NavLink>
    </nav>
  );
}

interface Made { url: string; id: string; kind: 'drop' | 'pool'; amountText: string; hash: string; amountInput?: string }

export default function SendPage() {
  const a = useAccount();
  const { data: pv } = usePocketView();
  const key = useKeyAccount();
  const { data: sponsor } = useSponsorStatus();
  const qc = useQueryClient();
  const { links } = useMyLinks();
  const inst = INST[a.env];
  const [mode, setMode] = useState<'Confirmed' | 'Open'>('Confirmed');
  const [amount, setAmount] = useState('0.3');
  // the prefilled amount was not typed by the sender: a problem with it is a grey hint until they edit it, not a red alert
  const [amountEdited, setAmountEdited] = useState(false);
  const [openAck, setOpenAck] = useState(false);
  const [slots, setSlots] = useState('3');
  const [perSlot, setPerSlot] = useState('0.02');
  const [busy, setBusy] = useState<'drop' | 'pool' | null>(null);
  const [err, setErr] = useState<{ where: 'drop' | 'pool'; text: string } | null>(null);
  const [made, setMade] = useState<Made | null>(null);
  const [txs, setTxs] = useState<Record<string, { what: string; hash: string }>>({});
  const onTx: OnTx = (k, t) => setTxs((x) => ({ ...x, [k]: t }));

  const ready = !!a.acct && key.ready;
  const amt = parseQor(amount);
  const fee = deliveryFeeWei(mode);
  const total = amt !== null ? amt + DEFAULTS.drip + fee : null;
  // why the form is locked, said next to every disabled control (UX-1)
  const lockReason = !a.root ? 'Locked: create your key in step 1 first.'
    : !a.acct ? 'Loading your key…'
    : !key.ready ? (sponsor?.enabled
      ? 'Locked: finish step 1 first (fund your Pocket; the one-time key setup is covered and runs by itself).'
      : `Locked: register your key in step 1 first (send at least ${fmtQor(KEY_ACCOUNT_MIN_WEI)} QOR to your key account).`) : null;
  const dropProblem = amt === null ? (amountFormatProblem(amount) ?? 'Enter an amount like 0.3.')
    : amt < inst.minEscrow ? `The minimum is ${fmtQor(inst.minEscrow)} QOR.`
    : amt > inst.maxAmount ? `The maximum is ${fmtQor(inst.maxAmount)} QOR.`
    : pv && total! > pv.balance ? `Your Pocket holds ${fmtQor(pv.balance)} QOR; this drop needs ${fmtQor(total!)} QOR (amount + ${fmtQor(DEFAULTS.drip)} for the receiver's setup fee + ${fmtQor(fee)} delivery fee).`
    : pv && pv.deployed && total! > pv.allowanceLeft ? `Your daily limit has ${fmtQor(pv.allowanceLeft)} QOR left; this drop needs ${fmtQor(total!)} QOR.`
    : pv && !pv.deployed && total! > DEFAULTS.dailyLimit ? `A new Pocket's daily limit is ${fmtQor(DEFAULTS.dailyLimit)} QOR.`
    : pv?.frozen ? 'This Pocket is frozen by its guardians.' : null;
  // Right after a link is made the balance drops, so the same amount no longer fits. That is expected, not an error:
  // say so plainly instead of a red "fix the amount" alert above the link the sender just made. Editing the amount brings the check back.
  const justMade = justMadeDrop(made, amount);
  const shownDropProblem = justMade ? null : dropProblem;
  const needsAck = openNeedsAck(mode, amt);
  const ackProblem = needsAck && !openAck ? `Above ${fmtQor(OPEN_ACK_ABOVE_WEI)} QOR, a first-to-open link needs your OK below, or switch to Someone I know.` : null;
  const ns = Number(slots);
  const per = parseQor(perSlot);
  const poolTotal = per !== null && Number.isInteger(ns) ? per * BigInt(ns) : null;
  // per-field errors sit under their own field (UX-4); balance and limit problems below the form
  const slotsProblem = countProblem(slots, 1, inst.maxSlots, 'slots');
  const perProblem = per === null ? (amountFormatProblem(perSlot, '0.02') ?? 'Enter a slot amount like 0.02.')
    : per < inst.minPerSlot || per > inst.maxPerSlot ? `A slot must be ${fmtQor(inst.minPerSlot)} to ${fmtQor(inst.maxPerSlot)} QOR.` : null;
  const poolFundsProblem = slotsProblem || perProblem ? null
    : pv && poolTotal! > pv.balance ? `Your Pocket holds ${fmtQor(pv.balance)} QOR; this pool needs ${fmtQor(poolTotal!)} QOR.`
    : pv && pv.deployed && poolTotal! > pv.allowanceLeft ? `Your daily limit has ${fmtQor(pv.allowanceLeft)} QOR left.`
    : pv?.frozen ? 'This Pocket is frozen by its guardians.' : null;
  const poolProblem = slotsProblem ?? perProblem ?? poolFundsProblem;

  async function makeDrop() {
    if (!a.actionCtx || !a.root || amt === null || ackProblem) return;
    setBusy('drop'); setErr(null); setMade(null);
    try {
      const r = await createDrop(a.actionCtx, a.root, { mode, amount: amt, drip: DEFAULTS.drip, relayerFee: fee, ttlSeconds: DEFAULTS.ttlSeconds });
      const linkId = await createdId(r.res, 'drop');
      rememberNonce(a.env, 'drop', linkId, r.nonce);
      setMade({ url: claimUrl4(window.location.origin, a.env, linkId, r.seed), id: linkId4(a.env, linkId), kind: 'drop', amountText: fmtQor(amt), hash: r.res.txHash, amountInput: amount });
      await qc.invalidateQueries();
    } catch (e) { setErr(isCancelled(e) ? null : { where: 'drop', text: explainError(e) }); } finally { setBusy(null); }
  }
  async function makePool() {
    if (!a.actionCtx || !a.root || per === null) return;
    setBusy('pool'); setErr(null); setMade(null);
    try {
      const r = await createPool(a.actionCtx, a.root, ns, per, DEFAULTS.ttlSeconds);
      const poolId = await createdId(r.res, 'pool');
      rememberNonce(a.env, 'pool', poolId, r.nonce);
      setMade({ url: claimUrl4(window.location.origin, a.env, poolId, r.seed, 'pool'), id: linkId4(a.env, poolId), kind: 'pool', amountText: fmtQor(per), hash: r.res.txHash });
      await qc.invalidateQueries();
    } catch (e) { setErr(isCancelled(e) ? null : { where: 'pool', text: explainError(e) }); } finally { setBusy(null); }
  }

  const pending = links.filter((l) => l.drop?.state === 'Bound' && l.drop.mode === 'Confirmed');
  return (
    <Page narrow form testId="send-page">
      <PageTitle eyebrow="Send" title="Send QOR from your Pocket">Your friend opens the link and the QOR lands in a Pocket made for them. They need no wallet, and you need nothing but this page.</PageTitle>
      <details className="-mt-4 mb-6 text-xs text-zinc-600" data-testid="send-tech"><summary className="cursor-pointer">Technical details</summary><p className="mt-2 leading-relaxed">Each drop is an intent signed in this browser with your ML-DSA-87 key; the chain checks the signature with its post-quantum precompile. A relayer submits it and pays the gas, so there is no EVM window or activation step for you.</p></details>
      <SendTabs />
      {made && <Celebrate once={`made-${made.kind}-${made.id}`} />}
      <div className="space-y-5">
        <StepCard n={1} title="Your Pocket" done={ready && !!pv && pv.balance > 0n} testId="step-account">
          {!a.root ? <ConnectChoices /> : (
            <div className="space-y-5">
              <PocketCard />
              <ActivationCard />
              <p className="text-xs text-zinc-500">Backup, limits, guardians and recovery live in the <Link to="/pocket" className="underline">Pocket tab</Link>.</p>
            </div>
          )}
        </StepCard>

        {pending.length > 0 && (
          <section className="space-y-3" data-testid="needs-you">
            <div className="flex items-center gap-2"><h2 className="font-serif text-2xl text-zinc-900">Needs your confirmation</h2><Pill tone="warn">{pending.length}</Pill></div>
            {pending.map((m) => <ConfirmCard key={m.created.id.toString()} m={m} onTx={onTx} />)}
          </section>
        )}

        <StepCard n={2} title="Amount and mode" done={!dropProblem && ready} locked={!ready}>
          <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Mode">
            {([['Confirmed', 'Someone I know', ShieldCheck, 'Confirmed mode: you compare 4 words with them before any money moves. The safest choice.'], ['Open', 'First to open it', Gift, 'Giveaway mode, like cash: whoever opens the link first gets it, with no check. For small gifts.']] as const).map(([m, t, Icon, line]) => (
              <button key={m} type="button" role="radio" aria-checked={mode === m} data-testid={`mode-${m}`} onClick={() => setMode(m)}
                className={cx('rounded-2xl border p-4 text-left transition', mode === m ? 'border-zinc-900 bg-stoneBg ring-1 ring-zinc-900' : 'border-zinc-200 bg-white hover:bg-stoneBg')}>
                <span className="flex items-center gap-2 text-sm font-semibold text-zinc-900"><Icon className="h-4 w-4" aria-hidden />{t}{m === 'Confirmed' && <Pill tone="dark">default</Pill>}</span>
                <span className="mt-1 block text-xs leading-snug text-zinc-600">{line}</span>
              </button>
            ))}
          </div>
          {needsAck && (
            <label className="mt-3 flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-zinc-900" data-testid="open-ack">
              <input type="checkbox" className="mt-0.5" checked={openAck} onChange={(e) => setOpenAck(e.target.checked)} data-testid="open-ack-box" />
              <span>Anyone who opens this link first can take {amt !== null ? fmtQor(amt) : ''} QOR, with no check. Use this only for a giveaway. For a friend, Someone I know is safer: you compare 4 words before any money moves.</span>
            </label>
          )}
          <label htmlFor="amount" className="mt-4 block text-sm font-semibold text-zinc-900">Amount (QOR)</label>
          <input id="amount" value={amount} onChange={(e) => { setAmount(e.target.value); setAmountEdited(true); }} inputMode="decimal" autoComplete="off" data-testid="amount" disabled={!ready}
            aria-invalid={ready && !!shownDropProblem} aria-describedby="drop-total drop-problem amount-lock"
            className="mt-1 w-full rounded-xl border border-zinc-300 bg-white px-3 py-3 font-mono text-lg" />
          {lockReason && <p id="amount-lock" className="mt-2 text-xs font-medium text-zinc-700" data-testid="amount-lock">{lockReason}</p>}
          {ready && shownDropProblem && (amountEdited
            ? <p id="drop-problem" role="alert" className="mt-2 text-sm font-medium text-red-700" data-testid="drop-problem">{shownDropProblem}</p>
            : <p id="drop-problem" className="mt-2 text-sm text-zinc-700" data-testid="drop-problem">{shownDropProblem}</p>)}
          <div id="drop-total" className="mt-3 rounded-2xl border border-zinc-200 bg-white/70 p-3 text-xs text-zinc-700" data-testid="drop-total">
            <div className="mb-1 font-semibold text-zinc-900">What leaves your Pocket</div>
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
              <dt>Gift to your friend</dt><dd className="text-right font-mono">{amt !== null ? fmtQor(amt) : '…'} QOR</dd>
              <dt>Setup for your friend: pays the one-time registration of their quantum-safe key (about {fmtQor(REGISTRATION_FEE_WEI)} QOR); anything left over is theirs</dt><dd className="text-right font-mono">{fmtQor(DEFAULTS.drip)} QOR</dd>
              <dt data-testid="delivery-line">Delivery: pays the relayer back for the network fees of the {deliverySteps(mode).length} relays this link needs ({deliverySteps(mode).join(', ')}; measured on Diana, plus 15 %), so your friend needs no QOR</dt><dd className="text-right font-mono" data-testid="delivery-fee">{fmtQor(fee)} QOR</dd>
              <dt className="font-semibold text-zinc-900">Total from your Pocket</dt><dd className="text-right font-mono font-semibold text-zinc-900">{total !== null ? fmtQor(total) : '…'} QOR</dd>
            </dl>
            {sponsor?.enabled && <p className="mt-2 text-zinc-600" data-testid="drop-sponsor-note">Our sponsor pays the key setup for new senders and for Drop Pool claimers, not for people who open a drop link, so this setup fee is still needed here. A Drop Pool has no extra fees.</p>}
            <p className="mt-2 text-zinc-600" data-testid="who-pays">Who pays the rest: creating this link and every other Pocket action are relayed at the team&apos;s cost on testnet. <Link to="/judges#costs" className="underline">Measured cost of every action</Link>.</p>
            <p className="mt-2 text-zinc-600">Cancel before the link is opened and all of it comes back. Gift limits: {fmtQor(inst.minEscrow)} to {fmtQor(inst.maxAmount)} QOR.</p>
          </div>
        </StepCard>

        <StepCard n={3} title="Create and share" done={made?.kind === 'drop'} locked={!ready || !!shownDropProblem}>
          <Button block busy={busy === 'drop'} disabled={!ready || !!dropProblem || !!ackProblem || !!busy} onClick={() => void makeDrop()} data-testid="create-drop">Create drop link</Button>
          {(lockReason || (ready && (dropProblem || ackProblem))) && !busy && <p className="mt-2 text-xs text-zinc-600" data-testid="create-drop-reason">{lockReason ?? (justMade ? 'Link created. To make another, enter a new amount.' : dropProblem ? `Fix the amount first: ${dropProblem}` : ackProblem)}</p>}
          {err?.where === 'drop' && <div className="mt-3"><Notice tone="error" testId="drop-error">{err.text}</Notice></div>}
          {made?.kind === 'drop' && <div className="mt-4 space-y-2"><ShareCard url={made.url} id={made.id} amountText={made.amountText} headline="Your link is ready" /><p className="font-mono text-xs text-zinc-600">Created in <TxLink hash={made.hash} testId="create-tx" check /> <SourceBadge kind="LIVE" /></p></div>}
        </StepCard>

        <section className="rounded-3xl border border-zinc-200 bg-white/90 p-5 shadow-sm sm:p-6" data-testid="pool-card">
          <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1"><Users className="h-5 w-5 text-zinc-700" aria-hidden /><h2 className="whitespace-nowrap font-serif text-2xl text-zinc-900">Drop Pool</h2><Pill>one link, many slots</Pill></div>
          <p className="text-sm leading-relaxed text-zinc-700">One link, N slots of a small amount each. Each slot goes to a <b>distinct proof-of-possession account, not a person</b>: one person can hold several accounts, so a pool is a way to share a little QOR, not a way to count people. It is <b>self-funded</b>: the slots come from your Pocket and the unclaimed part returns when you close it.</p>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <label className="text-sm font-semibold text-zinc-900">Slots<input value={slots} onChange={(e) => setSlots(e.target.value)} inputMode="numeric" data-testid="pool-slots" disabled={!ready} aria-invalid={ready && !!slotsProblem} aria-describedby="pool-slots-error" className="mt-1 w-full rounded-xl border border-zinc-300 bg-white px-3 py-3 font-mono" />
              {ready && slotsProblem && <span id="pool-slots-error" role="alert" className="mt-1 block text-xs font-medium text-red-700" data-testid="pool-slots-error">{slotsProblem}</span>}</label>
            <label className="text-sm font-semibold text-zinc-900">Per slot (QOR)<input value={perSlot} onChange={(e) => setPerSlot(e.target.value)} inputMode="decimal" data-testid="pool-per-slot" disabled={!ready} aria-invalid={ready && !!perProblem} aria-describedby="pool-per-error" className="mt-1 w-full rounded-xl border border-zinc-300 bg-white px-3 py-3 font-mono" />
              {ready && perProblem && <span id="pool-per-error" role="alert" className="mt-1 block text-xs font-medium text-red-700" data-testid="pool-per-error">{perProblem}</span>}</label>
          </div>
          <p className="mt-2 text-xs text-zinc-600">Total from your Pocket: {poolTotal !== null ? fmtQor(poolTotal) : '…'} QOR. Slot size {fmtQor(inst.minPerSlot)} to {fmtQor(inst.maxPerSlot)} QOR, up to {inst.maxSlots} slots. A claimer needs a registered quantum-safe key: the pool page walks them through it. {sponsor?.enabled ? 'Pocket Drop covers that one-time setup for new accounts (daily cap; the faucet is the fallback).' : <>That one-time setup needs about {fmtQor(KEY_ACCOUNT_MIN_WEI)} QOR from the faucet (a pool slot does not include a setup fee).</>}</p>
          {ready && poolProblem && <p className="sr-only" data-testid="pool-problem">{poolProblem}</p>}
          {ready && poolFundsProblem && <div className="mt-3"><Notice tone="warn" testId="pool-funds-problem">{poolFundsProblem}</Notice></div>}
          <div className="mt-4"><Button block busy={busy === 'pool'} disabled={!ready || !!poolProblem || !!busy} onClick={() => void makePool()} data-testid="create-pool">Create pool link</Button>
            {(lockReason || (ready && poolProblem)) && !busy && <p className="mt-2 text-xs text-zinc-600" data-testid="create-pool-reason">{lockReason ?? `Fix the pool first: ${poolProblem}`}</p>}</div>
          {err?.where === 'pool' && <div className="mt-3"><Notice tone="error" testId="pool-error">{err.text}</Notice></div>}
          {made?.kind === 'pool' && <div className="mt-4 space-y-2"><ShareCard url={made.url} id={made.id} kind="pool" amountText={made.amountText} headline="Your pool link is ready" /><p className="font-mono text-xs text-zinc-600">Created in <TxLink hash={made.hash} testId="pool-tx" check /> <SourceBadge kind="LIVE" /></p></div>}
        </section>

        {ready && links.length > 0 && (
          <section className="space-y-3">
            <h2 className="font-serif text-2xl text-zinc-900">Your links</h2>
            {links.slice(0, 4).map((m) => <LinkRow key={`${m.created.kind}${m.created.id}`} m={m} tx={txs[`${m.created.kind}:${m.created.id}`]} onTx={onTx} />)}
            <p className="text-xs text-zinc-500">All of them, with confirmations, in the <Link to="/send/inbox" className="underline">Inbox</Link>. Pocket <Mono>{a.activePocket ?? ''}</Mono></p>
          </section>
        )}
      </div>
    </Page>
  );
}

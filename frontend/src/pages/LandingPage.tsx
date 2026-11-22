import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ChevronDown, ChevronRight, ShieldCheck, Globe, MessageCircle, CheckCircle2, KeyRound, Droplets, Fingerprint, Compass, Hexagon, Send, Users, Wallet } from '../components/icons';
import { Reveal, SectionHead, SourcePill, Dash } from '../components/bits';
import { SourceBadge, cx } from '../components/ui';
import { useQuery } from '@tanstack/react-query';
import { ATTACKS, PHONE, attackTx, REC } from '../data/proofs';
import v4 from '../data/v4.json';
import tests from '../data/tests.json';
import { fetchQday } from '../lib/qday';
import { useHealth, useLatestDrop } from '../lib/queries';
import { LAB_REFUSED } from '../lib/labcount';
import { fmtQor } from '../lib/chain';
import { fingerprint, shortHash } from '../lib/protocol';
import { txUrl } from '../lib/config';

const stagger = (i: number) => ({ initial: { opacity: 0, y: 24 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.8, delay: i * 0.08, ease: 'easeOut' as const } });

/** Latest claimed drop, read from the API. Every number the design hard-coded (25.00 QOR, CEDAR PULSE ORBIT FLINT, 0.20 drip) comes from here. */
function useDropFacts() {
  const { id, link } = useLatestDrop();
  const amount = link ? fmtQor(BigInt(link.amount)) : null;
  const drip = link ? fmtQor(BigInt(link.drip)) : null;
  const words = link?.recipientKeyHash ? fingerprint(link.recipientKeyHash) : null;
  return { id, amount, drip, words };
}

const STEP_ICONS = {
  whatsapp: <MessageCircle className="h-5 w-5" />, key: <KeyRound className="h-5 w-5" />, drip: <Droplets className="h-5 w-5" />,
  seal: <Fingerprint className="h-5 w-5" />, shield: <ShieldCheck className="h-5 w-5 text-emerald-600" />, explorer: <Compass className="h-5 w-5" />,
};

/** The Q-Day Drill, in one card: the live verdict and a way in. */
function QdayTeaser() {
  const { data: q } = useQuery({ queryKey: ['qday'], queryFn: fetchQday, refetchInterval: 60_000, retry: 1 });
  const holding = q ? q.baits.filter((b) => b.alarm.length === 0).length : null;
  return (
    <div className="mx-auto max-w-6xl px-4 pt-16 sm:px-6 lg:px-8" data-testid="landing-qday">
      <Reveal className="capsule-obsidian grid gap-6 rounded-3xl p-6 text-stone-100 sm:p-10 md:grid-cols-[1.4fr_1fr] md:items-center">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-stone-300">— Q-DAY DRILL</p>
          <h2 className="mt-3 font-serif text-4xl leading-[1.05] tracking-tight text-white sm:text-5xl">We published the classical keys. Try to take the QOR.</h2>
          <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-stone-300">On Q-Day a quantum computer can work out today&apos;s wallet keys. We rehearse it now: five real Pockets on Diana have their classical keys on the page, and only the post-quantum key can move their QOR. You can try from your own browser tab. This is our own drill, self-run and always on; it is separate from the organisers&apos; 18 Nov drill.</p>
          <Link to="/qday" className="mt-6 inline-flex items-center gap-2 rounded-full bg-stone-50 px-5 py-3 text-sm font-medium text-zinc-950 transition-all hover:-translate-y-0.5" data-testid="landing-qday-open">Open the Q-Day Drill <ChevronRight className="h-4 w-4" aria-hidden /></Link>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
          <div className="flex items-center justify-between text-sm text-stone-300"><span>Pockets still holding</span><SourceBadge kind="LIVE" /></div>
          <div className="mt-2 font-money text-6xl leading-none text-white" data-testid="landing-qday-holding">{q ? `${holding} of ${q.baits.length}` : <Dash />}</div>
          <p className="mt-2 text-sm text-stone-300">{q ? (q.alarm.raised ? 'Breach alarm raised: see the page.' : (() => { const n = q.log.onChain.rows.filter((r) => r.failed).length; return `No breach. ${n} ${n === 1 ? 'attempt' : 'attempts'} refused on-chain so far.`; })()) : 'Reading the drill…'}</p>
        </div>
      </Reveal>
    </div>
  );
}

export default function LandingPage() {
  const navigate = useNavigate();
  const d = useDropFacts();
  const { data: h } = useHealth();
  const stageRef = useRef<HTMLDivElement>(null);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const [stack, setStack] = useState(0);

  const STACK = [
    { badge: 'STEP 01 · LINK OPENED', title: d.amount ? `Link Pass · ${d.amount} QOR` : 'Link Pass', desc: 'Your browser makes an ML-DSA-87 key and proves it holds it; POST /api/route relays PocketDrop.bind, hybrid-signed' },
    { badge: 'STEP 02 · 4-WORD SEAL', title: d.words ? d.words.join(' · ').toUpperCase() : '4 words from your key', desc: 'The sender\'s Pocket signs; PocketDrop.confirmRecipient pins your key hash' },
    { badge: 'STEP 03 · CLAIMED', title: 'Paid into the Pocket', desc: 'PocketDrop.claim: 0x0A02 checks your key, 0x0A01 checks your signature' },
  ];
  const s = STACK[stack % 3];
  const left = h?.window.remainingBlocks;

  return (
    <div data-testid="landing">
      {/* SECTION 1: MONUMENTAL HERO */}
      <div className="relative overflow-hidden pb-8 pt-10 sm:pb-12 sm:pt-14">
        <div className="relative z-20 mx-auto max-w-5xl px-4 text-center sm:px-6">
          <motion.div {...stagger(0)} className="mb-6 inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white/90 px-3.5 py-1.5 text-xs font-medium text-zinc-700 shadow-sm">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            <span data-testid="hero-badge">Diana testnet · no wallet needed</span>
          </motion.div>
          <motion.h1 {...stagger(1)} className="mx-auto max-w-4xl font-serif text-5xl leading-[0.98] tracking-tight text-zinc-900 sm:text-7xl">
            Send Quantum-Safe QOR Through a Link
          </motion.h1>
          <motion.p {...stagger(2)} className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-zinc-600 sm:text-lg">
            No wallet, no app, no seed phrase. Your friend taps a link in any chat app (WhatsApp, Telegram, SMS, email) and gets a Pocket that only a quantum-safe key can move.
          </motion.p>
          <motion.div {...stagger(3)} className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link to="/send" data-testid="hero-create" className="inline-flex items-center gap-2 rounded-full bg-accent px-6 py-3 text-[15px] font-medium text-stone-50 shadow-[0_10px_24px_-10px_rgba(11,107,75,.6)] transition-all hover:-translate-y-0.5 hover:bg-accentHover">
              <span>Send QOR</span><ChevronRight className="h-4 w-4" />
            </Link>
            <Link to="/receive" data-testid="hero-claim" className="inline-flex items-center gap-2 rounded-full border border-zinc-300 bg-stoneCard px-6 py-3 text-sm font-medium text-zinc-900 transition-all hover:-translate-y-0.5 hover:bg-white">
              <MessageCircle className="h-4 w-4 text-emerald-600" /><span>Receive a link</span>
            </Link>
          </motion.div>
        </div>

        <div className="relative mx-auto mt-4 flex min-h-[380px] max-w-6xl flex-col items-center justify-end border-b border-zinc-200/70 px-4 pb-10 sm:min-h-[470px]">
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-center overflow-hidden">
            <img src="/hero-sculptures.webp" width={1344} height={756} alt="Sculptural dialogue bridging legacy to post-quantum Web3" className="sculptures-blend h-auto w-full max-w-[1060px] select-none object-contain" />
          </div>

          <div className="relative z-20 mb-4 flex flex-wrap items-center justify-center gap-x-5 gap-y-1 rounded-2xl bg-stone-50/85 px-4 py-1.5 font-mono text-xs uppercase tracking-widest text-zinc-700 shadow-sm backdrop-blur-sm" data-testid="hero-facts">
            <span className="inline-flex items-center gap-1"><MessageCircle className="h-3 w-3 text-emerald-600" /> Any chat app</span>
            <span className="inline-flex items-center gap-1"><Globe className="h-3 w-3" /> Diana testnet</span>
            <Link to="/judges" className="inline-flex items-center gap-1 hover:text-zinc-900" data-testid="hero-tests" title={`RECORDED: ${v4.tests.verifiedBy}; vitest counts from ${tests.command} on ${tests.recordedAt.slice(0, 10)}`}>
              <CheckCircle2 className="h-3 w-3" /> {v4.tests.passed} contract + {tests.frontend.passed + tests.backend.passed} app tests pass
            </Link>
          </div>

          <div ref={stageRef} className="tilt-stage relative z-20 w-full max-w-[295px] animate-float-slow sm:max-w-[315px]"
            onMouseMove={(e) => { const r = stageRef.current!.getBoundingClientRect(); setTilt({ x: (e.clientX - r.left) / r.width - 0.5, y: (e.clientY - r.top) / r.height - 0.5 }); }}
            onMouseLeave={() => setTilt({ x: 0, y: 0 })}>
            <div role="button" tabIndex={0} aria-describedby="hero-capsule-hint" data-testid="hero-capsule" onClick={() => navigate("/receive")} onKeyDown={(e) => { if (e.key === 'Enter') navigate("/receive"); }}
              className="tilt-card capsule-bezel cursor-pointer" style={{ transform: `rotateY(${tilt.x * 14}deg) rotateX(${-tilt.y * 12}deg)` }}>
              <span id="hero-capsule-hint" className="sr-only">Opens the claim flow</span>
              <div className="rounded-[19px] capsule-obsidian p-5 text-stone-100">
                <div className="mb-3.5 flex items-center justify-between">
                  <span className="font-mono text-xs uppercase tracking-widest text-zinc-300">POCKET DROP</span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500 px-2.5 py-0.5 text-xs font-semibold text-zinc-950"><MessageCircle className="h-3 w-3" />WhatsApp</span>
                </div>
                <div className="my-2 text-center">
                  <div className="font-money text-4xl tracking-tight text-white" data-testid="hero-amount">{d.amount ?? <Dash />} <span className="text-lg text-zinc-400">QOR</span></div>
                </div>
                <div className="mb-3 rounded-lg border border-white/10 bg-white/10 px-2 py-1.5 text-center font-mono text-xs uppercase tracking-widest text-stone-100" data-testid="hero-words">
                  {d.words ? d.words.join(' · ') : '4 words · from · your · key'}
                </div>
                <div className="flex items-center justify-between border-t border-white/10 pt-2 font-mono text-xs text-zinc-400">
                  <span>{d.id ? `Last claimed link ${d.id}` : 'Last claimed link'}</span>
                  <span className="whitespace-nowrap text-emerald-400">quantum-safe</span>
                </div>
                <div className="mt-2 text-right"><SourcePill kind="LIVE" /></div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* SECTION 2: HOW IT WORKS, IN THREE STEPS */}
      <div className="border-y border-zinc-200/80 bg-white/80 py-20 sm:py-28">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <Reveal className="mb-10">
            <p className="mb-3 font-mono text-xs uppercase tracking-[0.2em] text-zinc-600">— HOW IT WORKS</p>
            <h2 className="font-serif text-4xl leading-[1.05] tracking-tight text-zinc-900 sm:text-5xl">Three steps, no wallet</h2>
          </Reveal>
          <ol className="grid gap-4 md:grid-cols-3" data-testid="how-it-works">
            {([
              [Send, 'Send a link', 'Put some QOR in a link and share it in any chat. If nobody opens it, you cancel and all of it comes back to you.'],
              [Wallet, 'Your friend gets a quantum-safe Pocket', 'Opening the link makes a key inside their browser and pays into a Pocket that only that key can move. No wallet, no app, no seed phrase. You can compare four words with them, so nobody else takes it.'],
              [Users, 'Guardians if the phone is lost', 'Pick a few people you trust as guardians. If the phone is lost they can move the Pocket to a new key after a waiting period, and if the key is stolen they can freeze the Pocket.'],
            ] as const).map(([Icon, title, body], i) => (
              <li key={title} className="rounded-3xl border border-zinc-200 bg-stoneBg/70 p-6">
                <div className="flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-full bg-zinc-900 font-mono text-sm text-white">{i + 1}</span><Icon className="h-5 w-5 text-zinc-700" aria-hidden /></div>
                <h3 className="mt-4 font-serif text-2xl leading-tight text-zinc-900">{title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-zinc-700">{body}</p>
              </li>
            ))}
          </ol>
          <p className="mt-5 text-sm leading-relaxed text-zinc-600" data-testid="phone-timing">
            On real phones the three on-chain steps of the earlier v3 claim (register key, open window, claim) took {PHONE.androidLabel} on Android Chrome and {PHONE.iphoneLabel} on iPhone Safari. <SourceBadge kind="RECORDED" title={`Source: ${PHONE.source}`} /> Claims no longer open a window: the relayer carries them as hybrid-signed cross-VM calls.
          </p>

          <details className="group mt-8 rounded-3xl border border-zinc-200 bg-white/90 p-5 sm:p-6" data-testid="landing-tech">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-zinc-900 [&::-webkit-details-marker]:hidden">
              <span>Technical details: what happens on-chain when a link is opened</span><ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden />
            </summary>
            <p className="mt-3 text-sm leading-relaxed text-zinc-600">
              The browser makes an ML-DSA-87 keypair, a small drip pays for its proof-of-possession registration, and the four words are a fingerprint of the recipient&apos;s key that the sender can confirm on-chain. The chain checks every signature with its native post-quantum precompiles (0x0A01 verify, 0x0A02 key status).
            </p>
          <div className="relative flex flex-col items-center justify-between gap-8 py-6 md:flex-row">
            <div className="flex items-center justify-center gap-5 sm:gap-7">
              {[[STEP_ICONS.whatsapp, 'Chat link', 0, 'text-emerald-600'], [STEP_ICONS.key, 'Keygen', 0, 'text-zinc-800'], [STEP_ICONS.drip, 'Drip', 1, 'text-sky-600']].map(([icon, label, step, tone]) => (
                <button key={label as string} type="button" onClick={() => setStack(step as number)} className="group flex flex-col items-center gap-2">
                  <span className={cx('flex h-12 w-12 items-center justify-center rounded-full border border-zinc-200 bg-stoneBg shadow-sm transition-all group-hover:scale-105 group-hover:border-zinc-900', tone as string)}>{icon}</span>
                  <span className="text-xs font-medium text-zinc-600">{label as string}</span>
                </button>
              ))}
            </div>

            <div className="flex shrink-0 flex-col items-center">
              <div className="relative flex h-[210px] w-[240px] cursor-pointer items-center justify-center" onClick={() => setStack((v) => (v + 1) % 3)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setStack((v) => (v + 1) % 3); } }} role="button" tabIndex={0} aria-describedby="stacked-deck-hint" data-testid="stacked-deck">
                <span id="stacked-deck-hint" className="sr-only">Shows the next step</span>
                <div className="iso-slab absolute top-[56px] h-[126px] w-[200px] rounded-2xl opacity-85" />
                <div className="iso-slab absolute top-[30px] h-[126px] w-[200px] rounded-2xl opacity-95" />
                <div className="iso-slab absolute top-[4px] flex h-[126px] w-[200px] flex-col justify-between rounded-2xl p-4 transition-transform hover:-translate-y-1">
                  <div className="flex items-center justify-between"><span className="text-xs font-semibold text-zinc-800">Link Pass</span><Hexagon className="h-3.5 w-3.5 text-zinc-700" /></div>
                  <div className="font-mono text-xs text-zinc-600">{d.amount ? `${d.amount} QOR` : '…'} · ML-DSA-87</div>
                </div>
              </div>
              <div className="mt-2 max-w-[260px] text-center">
                <span className="mb-1.5 inline-block rounded-full bg-zinc-900 px-2.5 py-0.5 font-mono text-xs text-white" data-testid="stack-badge">{s.badge}</span>
                <div className="font-serif text-2xl text-zinc-900" data-testid="stack-title">{s.title}</div>
                <div className="mt-0.5 text-xs text-zinc-600" data-testid="stack-desc">{s.desc}</div>
                <div className="mt-1.5 text-xs text-zinc-400">Example taken from the latest claimed drop{d.id ? ` (#${d.id})` : ''} <SourceBadge kind="LIVE" /></div>
              </div>
            </div>

            <div className="flex items-center justify-center gap-5 sm:gap-7">
              {[[STEP_ICONS.seal, '4-Word Seal', 1, 'text-zinc-800'], [STEP_ICONS.shield, 'PoP Shield', 2, 'text-zinc-900'], [STEP_ICONS.explorer, 'Explorer', 2, 'text-zinc-800']].map(([icon, label, step, tone]) => (
                <button key={label as string} type="button" onClick={() => setStack(step as number)} className="group flex flex-col items-center gap-2">
                  <span className={cx('flex h-12 w-12 items-center justify-center rounded-full border border-zinc-200 bg-stoneBg shadow-sm transition-all group-hover:scale-105 group-hover:border-zinc-900', tone as string)}>{icon}</span>
                  <span className="text-xs font-medium text-zinc-600">{label as string}</span>
                </button>
              ))}
            </div>
          </div>
          </details>
        </div>
      </div>

      {/* SECTION 3: Q-DAY DRILL */}
      <QdayTeaser />

      {/* SECTION 4: POST-QUANTUM ARCHITECTURE */}
      <div className="mx-auto max-w-6xl px-4 pb-24 pt-16 sm:px-6 lg:px-8">
        <SectionHead eyebrow="— TECHNICAL DETAILS" sub="Enforced by the chain's native post-quantum precompiles" title="Checked by the chain, not by our server." className="mb-12" />
        <div className="grid gap-5 md:grid-cols-12">
          <Reveal className="relative flex flex-col justify-between overflow-hidden rounded-3xl border border-zinc-200/90 bg-white/90 p-6 shadow-sm md:col-span-6">
            <div className="mb-2 font-mono text-xs uppercase tracking-widest text-zinc-500">Crystalline Lattice Seal · 0x0A01 &amp; 0x0A02</div>
            <div className="relative my-1 flex items-center justify-center">
              <span className="absolute bottom-4 left-3 z-10 font-mono text-xs text-zinc-600">0x0A01</span>
              <span className="absolute right-3 top-4 z-10 font-mono text-xs text-zinc-600">0x0A02</span>
              <img src="/lattice-seal.webp" width={480} height={480} loading="lazy" alt="3D interlocking titanium rings around crystalline lattice" className="h-48 w-48 select-none object-contain" style={{ mixBlendMode: 'multiply' }} />
            </div>
            <div className="border-t border-zinc-100 pt-3 font-mono text-xs text-zinc-500">Precompile verification · ML-DSA-87 native execution</div>
          </Reveal>

          <Reveal delay={0.08} className="flex flex-col justify-between rounded-3xl border border-zinc-200/90 bg-white/90 p-6 text-center shadow-sm md:col-span-3">
            <div className="font-mono text-xs uppercase tracking-widest text-zinc-500">{h?.relay?.mode === 'hybrid' ? 'Relayer Hybrid Signature' : 'Relayer Scoped Window'}</div>
            <div className="my-4 flex items-center justify-center">
              <div className="relative flex h-28 w-28 items-center justify-center rounded-full border border-dashed border-zinc-300">
                <div className="titanium-plaque relative flex h-20 w-20 items-center justify-center rounded-full">
                  <div className="h-7 w-0.5 origin-bottom -translate-y-2 rotate-45 rounded-full bg-zinc-700" />
                </div>
              </div>
            </div>
            <div>
              <div className="text-sm font-semibold text-zinc-900">{h?.relay?.mode === 'hybrid' ? 'secp256k1 + ML-DSA-87' : '[PocketDrop] Only'}</div>
              <div className="mt-0.5 text-xs text-zinc-500">{h?.relay?.mode === 'hybrid' ? 'every relay, checked by the chain' : 'ECDSA tx inside a scoped window'}</div>
              <div className="mt-3 border-t border-zinc-100 pt-2 font-mono text-xs text-zinc-400" data-testid="landing-window">
                {h ? (h.relay?.mode === 'hybrid' ? (h.relay.classicalPathOpen ? `ECDSA window still open · ${left} blocks` : 'ECDSA-only path closed') : h.window.live ? `Window live · ${left} blocks left` : 'Window closed') : 'Reading the relayer…'} <SourceBadge kind="LIVE" />
              </div>
            </div>
          </Reveal>

          <Reveal delay={0.16} className="flex flex-col justify-between rounded-3xl border border-zinc-200/90 bg-white/90 p-6 shadow-sm md:col-span-3">
            <div>
              <h3 className="mb-4 font-serif text-xl text-zinc-900">/lab · Attacks the chain refused</h3>
              <div className="space-y-2.5">
                {[[1, 'bg-rose-100 text-rose-800'], [3, 'bg-amber-100 text-amber-800'], [4, 'bg-zinc-200 text-zinc-800']].map(([n, tone]) => {
                  const t = attackTx(n as number); const a = ATTACKS[(n as number) - 1];
                  return (
                    <a key={n as number} href={txUrl(t.hash)} target="_blank" rel="noopener noreferrer" className="block rounded-xl border border-zinc-200/80 bg-stoneBg p-2.5">
                      <span className={cx('inline-block max-w-full rounded-full px-2 py-0.5 font-mono text-xs [overflow-wrap:anywhere]', tone as string)}>{a.error}</span>
                      <div className="mt-1 font-mono text-xs text-zinc-500">Tx {shortHash(t.hash, 4)} · Reverted</div>
                    </a>
                  );
                })}
              </div>
            </div>
            <Link to="/lab" className="mt-4 text-left font-mono text-xs text-zinc-800 underline">All {LAB_REFUSED} v4 attacks and the {ATTACKS.length} v3 ones → <span className="no-underline"><SourceBadge kind="RECORDED" title={`deployments/diana.json, main contract ${REC.main.address}`} /></span></Link>
          </Reveal>
        </div>
      </div>
    </div>
  );
}

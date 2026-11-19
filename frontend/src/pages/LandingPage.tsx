import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ChevronRight, Cpu, ShieldCheck, Globe, MessageCircle, CheckCircle2, KeyRound, Droplets, Fingerprint, Compass, Hexagon } from 'lucide-react';
import { Reveal, SectionHead, SourcePill, Dash } from '../components/bits';
import { SourceBadge, cx } from '../components/ui';
import { ATTACKS, PHONE, TESTS, attackTx, REC } from '../data/proofs';
import { useHealth, useLatestDrop } from '../lib/queries';
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

export default function LandingPage() {
  const navigate = useNavigate();
  const d = useDropFacts();
  const { data: h } = useHealth();
  const stageRef = useRef<HTMLDivElement>(null);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const [stack, setStack] = useState(0);

  const STACK = [
    { badge: 'STEP 01 · LINK OPENED', title: d.amount ? `Link Pass · ${d.amount} QOR` : 'Link Pass', desc: 'Browser generates ML-DSA-87 keypair & calls POST /api/bind' },
    { badge: 'STEP 02 · 4-WORD SEAL', title: d.words ? d.words.join(' · ').toUpperCase() : '4 words from your key', desc: 'Sender confirms recipientKeyHash on-chain via confirmRecipient()' },
    { badge: 'STEP 03 · PoP SETTLED', title: 'PoP Account Born', desc: '0x0A02 + 0x0A01 verify recipient signature & release escrow' },
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
            <span data-testid="hero-badge">Diana Testnet · Zero-Wallet Onboarding</span>
          </motion.div>
          <motion.h1 {...stagger(1)} className="mx-auto max-w-4xl font-serif text-5xl leading-[0.98] tracking-tight text-zinc-900 sm:text-7xl">
            Send Quantum-Safe QOR Through a Link
          </motion.h1>
          <motion.p {...stagger(2)} className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-zinc-600 sm:text-lg">
            No wallet, no app, no seed phrase. Your friend taps a link in any chat app (WhatsApp, Telegram, SMS, email), reads 4 words, and gets a PoP-verified QoreChain account.
          </motion.p>
          <motion.div {...stagger(3)} className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link to="/dashboard" data-testid="hero-create" className="inline-flex items-center gap-2 rounded-full bg-zinc-900 px-6 py-3 text-sm font-medium text-stone-100 shadow-md transition-all hover:-translate-y-0.5 hover:bg-zinc-800">
              <span>Create a Drop</span><ChevronRight className="h-4 w-4" />
            </Link>
            <Link to="/claim" data-testid="hero-claim" className="inline-flex items-center gap-2 rounded-full border border-zinc-300 bg-stoneCard px-6 py-3 text-sm font-medium text-zinc-900 transition-all hover:-translate-y-0.5 hover:bg-white">
              <MessageCircle className="h-4 w-4 text-emerald-600" /><span>Open a Claim Link</span>
            </Link>
          </motion.div>
        </div>

        <div className="relative mx-auto mt-4 flex min-h-[380px] max-w-6xl flex-col items-center justify-end border-b border-zinc-200/70 px-4 pb-10 sm:min-h-[470px]">
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-center overflow-hidden">
            <img src="/hero-sculptures.webp" width={1344} height={756} alt="Sculptural dialogue bridging legacy to post-quantum Web3" className="sculptures-blend h-auto w-full max-w-[1060px] select-none object-contain" />
          </div>

          <div className="relative z-20 mb-4 flex flex-wrap items-center justify-center gap-x-5 gap-y-1 font-mono text-[10px] uppercase tracking-widest text-zinc-500">
            <span className="inline-flex items-center gap-1"><Cpu className="h-3 w-3" /> 0x0A01</span>
            <span className="inline-flex items-center gap-1"><ShieldCheck className="h-3 w-3" /> 0x0A02</span>
            <span className="inline-flex items-center gap-1"><Globe className="h-3 w-3" /> Diana 9800</span>
            <span className="inline-flex items-center gap-1"><MessageCircle className="h-3 w-3 text-emerald-600" /> Any chat app</span>
            <span className="inline-flex items-center gap-1" title={`RECORDED: forge test, ${TESTS.verifiedOn}`}><CheckCircle2 className="h-3 w-3" /> Foundry {TESTS.foundry.passed}</span>
          </div>

          <div ref={stageRef} className="tilt-stage relative z-20 w-full max-w-[295px] animate-float-slow sm:max-w-[315px]"
            onMouseMove={(e) => { const r = stageRef.current!.getBoundingClientRect(); setTilt({ x: (e.clientX - r.left) / r.width - 0.5, y: (e.clientY - r.top) / r.height - 0.5 }); }}
            onMouseLeave={() => setTilt({ x: 0, y: 0 })}>
            <div role="button" tabIndex={0} aria-label="Open the claim flow" data-testid="hero-capsule" onClick={() => navigate('/claim')} onKeyDown={(e) => { if (e.key === 'Enter') navigate('/claim'); }}
              className="tilt-card capsule-bezel cursor-pointer" style={{ transform: `rotateY(${tilt.x * 14}deg) rotateX(${-tilt.y * 12}deg)` }}>
              <div className="rounded-[19px] capsule-obsidian p-5 text-stone-100">
                <div className="mb-3.5 flex items-center justify-between">
                  <span className="font-mono text-[10px] uppercase tracking-widest text-zinc-300">POCKET DROP</span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500 px-2.5 py-0.5 text-[10px] font-semibold text-zinc-950"><MessageCircle className="h-3 w-3" />WhatsApp</span>
                </div>
                <div className="my-2 text-center">
                  <div className="font-serif text-4xl tracking-tight text-white" data-testid="hero-amount">{d.amount ?? <Dash />} <span className="text-lg text-zinc-400">QOR</span></div>
                </div>
                <div className="mb-3 rounded-lg border border-white/10 bg-white/10 px-2 py-1.5 text-center font-mono text-[10px] uppercase tracking-widest text-stone-100" data-testid="hero-words">
                  {d.words ? d.words.join(' · ') : '4 words · from · your · key'}
                </div>
                <div className="flex items-center justify-between border-t border-white/10 pt-2 font-mono text-[9.5px] text-zinc-400">
                  <span>{d.id ? `link #${d.id} · latest claimed` : 'latest claimed drop'}</span>
                  <span className="text-emerald-400">ML-DSA-87 · PoP</span>
                </div>
                <div className="mt-2 text-right"><SourcePill kind="LIVE" /></div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* SECTION 2: ZERO-WALLET ONBOARDING */}
      <div className="border-y border-zinc-200/80 bg-white/80 py-20 sm:py-28">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <Reveal className="mb-16 grid items-end gap-8 md:grid-cols-2">
            <div>
              <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.2em] text-zinc-500">— ZERO-WALLET ONBOARDING</p>
              <h2 className="font-serif text-4xl leading-[1.05] tracking-tight text-zinc-900 sm:text-5xl">From a chat link to a quantum-safe account</h2>
            </div>
            <div>
              <p className="text-sm leading-relaxed text-zinc-600 sm:text-base">
                Every Pocket Drop link abstracts away QoreChain's hardest onboarding barriers: ephemeral ML-DSA-87 keygen in the browser, drip-funded Proof-of-Possession registration, and 4-word human verification.
              </p>
              <p className="mt-2 text-xs leading-relaxed text-zinc-500" data-testid="phone-timing">
                On real phones the three on-chain steps (register key, open window, claim) took {PHONE.androidLabel} on Android Chrome and {PHONE.iphoneLabel} on iPhone Safari. <SourceBadge kind="RECORDED" title={`Source: ${PHONE.source}`} />
              </p>
            </div>
          </Reveal>

          <div className="relative flex flex-col items-center justify-between gap-8 py-6 md:flex-row">
            <div className="flex items-center justify-center gap-5 sm:gap-7">
              {[[STEP_ICONS.whatsapp, 'Chat link', 0, 'text-emerald-600'], [STEP_ICONS.key, 'Keygen', 0, 'text-zinc-800'], [STEP_ICONS.drip, 'Drip', 1, 'text-sky-600']].map(([icon, label, step, tone]) => (
                <button key={label as string} type="button" onClick={() => setStack(step as number)} className="group flex flex-col items-center gap-2">
                  <span className={cx('flex h-12 w-12 items-center justify-center rounded-full border border-zinc-200 bg-stoneBg shadow-sm transition-all group-hover:scale-105 group-hover:border-zinc-900', tone as string)}>{icon}</span>
                  <span className="text-[11px] font-medium text-zinc-600">{label as string}</span>
                </button>
              ))}
            </div>

            <div className="flex shrink-0 flex-col items-center">
              <div className="relative flex h-[210px] w-[240px] cursor-pointer items-center justify-center" onClick={() => setStack((v) => (v + 1) % 3)} role="button" aria-label="Next step" data-testid="stacked-deck">
                <div className="iso-slab absolute top-[56px] h-[126px] w-[200px] rounded-2xl opacity-85" />
                <div className="iso-slab absolute top-[30px] h-[126px] w-[200px] rounded-2xl opacity-95" />
                <div className="iso-slab absolute top-[4px] flex h-[126px] w-[200px] flex-col justify-between rounded-2xl p-4 transition-transform hover:-translate-y-1">
                  <div className="flex items-center justify-between"><span className="text-[11px] font-semibold text-zinc-800">Link Pass</span><Hexagon className="h-3.5 w-3.5 text-zinc-700" /></div>
                  <div className="font-mono text-[10px] text-zinc-600">{d.amount ? `${d.amount} QOR` : '…'} · ML-DSA-87</div>
                </div>
              </div>
              <div className="mt-2 max-w-[260px] text-center">
                <span className="mb-1.5 inline-block rounded-full bg-zinc-900 px-2.5 py-0.5 font-mono text-[10px] text-white" data-testid="stack-badge">{s.badge}</span>
                <div className="font-serif text-2xl text-zinc-900" data-testid="stack-title">{s.title}</div>
                <div className="mt-0.5 text-xs text-zinc-600">{s.desc}</div>
                <div className="mt-1.5 text-[10px] text-zinc-400">Example taken from the latest claimed drop{d.id ? ` (#${d.id})` : ''} <SourceBadge kind="LIVE" /></div>
              </div>
            </div>

            <div className="flex items-center justify-center gap-5 sm:gap-7">
              {[[STEP_ICONS.seal, '4-Word Seal', 1, 'text-zinc-800'], [STEP_ICONS.shield, 'PoP Shield', 2, 'text-zinc-900'], [STEP_ICONS.explorer, 'Explorer', 2, 'text-zinc-800']].map(([icon, label, step, tone]) => (
                <button key={label as string} type="button" onClick={() => setStack(step as number)} className="group flex flex-col items-center gap-2">
                  <span className={cx('flex h-12 w-12 items-center justify-center rounded-full border border-zinc-200 bg-stoneBg shadow-sm transition-all group-hover:scale-105 group-hover:border-zinc-900', tone as string)}>{icon}</span>
                  <span className="text-[11px] font-medium text-zinc-600">{label as string}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* SECTION 3: PHONE + LEGACY COLLAPSE */}
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-24 lg:px-8">
        <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.2em] text-zinc-500">— ZERO-FRICTION FLOW</p>
        <p className="mb-3 text-xs text-zinc-500">From a single link to a quantum-safe account</p>
        <h2 className="mb-12 max-w-xl font-serif text-4xl leading-[1.03] text-zinc-900 sm:text-5xl">One link, no wallet.<br />The friction vanishes.</h2>

        <div className="grid items-center gap-8 md:grid-cols-12">
          <Reveal className="relative flex items-center justify-center md:col-span-5">
            <div className="relative w-full max-w-[360px]">
              <img src="/phone-titanium.webp" width={800} height={800} loading="lazy" alt="3D brushed-titanium smartphone floating over alabaster ripples" className="h-auto w-full select-none object-contain" style={{ mixBlendMode: 'multiply', filter: 'brightness(1.04) contrast(1.03)' }} />
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="w-[155px] -translate-y-[14px] -rotate-[13deg] space-y-2 text-center">
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50/95 px-2 py-1 shadow-sm">
                    <div className="font-mono text-[8.5px] font-semibold text-emerald-800">…/c/{d.id ?? 'N'}#k=…</div>
                    <div className="text-[7.5px] text-zinc-500">Tap 1: open the link</div>
                  </div>
                  <div className="rounded-lg border border-zinc-200 bg-white/95 px-2 py-1.5 shadow-sm">
                    <div className="font-serif text-lg leading-none text-zinc-900">{d.amount ?? '…'} QOR</div>
                    <div className="mt-0.5 font-mono text-[8px] text-zinc-500">+ {d.drip ?? '…'} drip</div>
                  </div>
                  <div className="titanium-plaque rounded-lg px-1.5 py-1 shadow-sm">
                    <div className="font-mono text-[7px] font-bold uppercase tracking-wider text-zinc-900">{d.words ? d.words.join(' · ') : '· · · ·'}</div>
                    <div className="text-[7px] text-zinc-600">Tap 2: read the 4 words</div>
                  </div>
                  <div className="rounded-lg border border-zinc-200 bg-white/95 px-2 py-1 shadow-sm">
                    <div className="text-[8.5px] font-semibold text-zinc-900">PoP Verified ✓</div>
                  </div>
                </div>
              </div>
            </div>
            <p className="absolute -bottom-2 left-0 right-0 text-center text-[10px] text-zinc-400">Walkthrough illustration built from the latest real drop <SourceBadge kind="LIVE" /></p>
          </Reveal>

          <Reveal className="border-zinc-200/80 md:col-span-7 md:border-l md:pl-8">
            <div className="mb-5 font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-500">Typical wallet onboarding</div>
            <div className="relative space-y-2 pl-2 text-xs font-medium text-zinc-600">
              {['Install Wallet', 'Save Seed Phrase', 'Add Network RPC', 'Bridge Gas Token', 'Register PoP Key', 'Open EVM Window'].map((t, i) => (
                <div key={t} className="flex items-center gap-2.5" style={{ paddingLeft: `${i * 1.5}rem` }}><span className="h-1.5 w-1.5 rounded-full bg-zinc-400" /> {t}</div>
              ))}
            </div>
            <svg className="my-1 h-14 w-full text-zinc-300" viewBox="0 0 400 56" fill="none" aria-hidden>
              <path d="M20 0 C 20 32, 200 22, 200 52" stroke="currentColor" strokeWidth="1" />
              <path d="M80 0 C 80 30, 200 22, 200 52" stroke="currentColor" strokeWidth="1" />
              <path d="M140 0 C 140 28, 200 22, 200 52" stroke="currentColor" strokeWidth="1" />
              <path d="M260 0 C 260 30, 200 22, 200 52" stroke="currentColor" strokeWidth="1" />
              <polygon points="196,48 204,48 200,55" fill="#71717A" />
            </svg>
            <div className="titanium-plaque relative mx-auto max-w-xs rounded-2xl p-5 text-center md:ml-24">
              {['left-2.5 top-2.5', 'right-2.5 top-2.5', 'bottom-2.5 left-2.5', 'bottom-2.5 right-2.5'].map((p) => <span key={p} className={`absolute h-1.5 w-1.5 rounded-full bg-zinc-500/60 ${p}`} />)}
              <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-600">Pocket Drop</div>
              <div className="mt-1 font-sans text-xl font-semibold text-zinc-900">0 installs · 0 seed phrases</div>
              <div className="mt-1 font-mono text-[11px] text-zinc-600">+ PoP-gated claim, enforced on-chain</div>
            </div>
          </Reveal>
        </div>
      </div>

      {/* SECTION 4: POST-QUANTUM ARCHITECTURE */}
      <div className="mx-auto max-w-6xl px-4 pb-24 sm:px-6 lg:px-8">
        <SectionHead eyebrow="— POST-QUANTUM ARCHITECTURE" sub="Enforced by native precompiles" title="Hardened at the protocol layer." className="mb-12" />
        <div className="grid gap-5 md:grid-cols-12">
          <Reveal className="relative flex flex-col justify-between overflow-hidden rounded-3xl border border-zinc-200/90 bg-white/90 p-6 shadow-sm md:col-span-6">
            <div className="mb-2 font-mono text-[11px] uppercase tracking-widest text-zinc-500">Crystalline Lattice Seal · 0x0A01 &amp; 0x0A02</div>
            <div className="relative my-1 flex items-center justify-center">
              <span className="absolute bottom-4 left-3 z-10 font-mono text-xs text-zinc-600">0x0A01</span>
              <span className="absolute right-3 top-4 z-10 font-mono text-xs text-zinc-600">0x0A02</span>
              <img src="/lattice-seal.webp" width={480} height={480} loading="lazy" alt="3D interlocking titanium rings around crystalline lattice" className="h-48 w-48 select-none object-contain" style={{ mixBlendMode: 'multiply' }} />
            </div>
            <div className="border-t border-zinc-100 pt-3 font-mono text-[11px] text-zinc-500">Precompile verification · ML-DSA-87 native execution</div>
          </Reveal>

          <Reveal delay={0.08} className="flex flex-col justify-between rounded-3xl border border-zinc-200/90 bg-white/90 p-6 text-center shadow-sm md:col-span-3">
            <div className="font-mono text-[11px] uppercase tracking-widest text-zinc-500">Relayer Scoped Window</div>
            <div className="my-4 flex items-center justify-center">
              <div className="relative flex h-28 w-28 items-center justify-center rounded-full border border-dashed border-zinc-300">
                <div className="titanium-plaque relative flex h-20 w-20 items-center justify-center rounded-full">
                  <div className="h-7 w-0.5 origin-bottom -translate-y-2 rotate-45 rounded-full bg-zinc-700" />
                </div>
              </div>
            </div>
            <div>
              <div className="text-sm font-semibold text-zinc-900">[PocketDrop] Only</div>
              <div className="mt-0.5 text-xs text-zinc-500">ML-DSA key not on the server</div>
              <div className="mt-3 border-t border-zinc-100 pt-2 font-mono text-[10px] text-zinc-400" data-testid="landing-window">
                {h ? (h.window.live ? `Window live · ${left} blocks left` : 'Window expired · renewing') : 'Window …'} <SourceBadge kind="LIVE" />
              </div>
            </div>
          </Reveal>

          <Reveal delay={0.16} className="flex flex-col justify-between rounded-3xl border border-zinc-200/90 bg-white/90 p-6 shadow-sm md:col-span-3">
            <div>
              <h3 className="mb-4 font-serif text-xl text-zinc-900">/lab · 6 Mined Diana Reverts</h3>
              <div className="space-y-2.5">
                {[[1, 'bg-rose-100 text-rose-800'], [3, 'bg-amber-100 text-amber-800'], [4, 'bg-zinc-200 text-zinc-800']].map(([n, tone]) => {
                  const t = attackTx(n as number); const a = ATTACKS[(n as number) - 1];
                  return (
                    <a key={n as number} href={txUrl(t.hash)} target="_blank" rel="noopener noreferrer" className="block rounded-xl border border-zinc-200/80 bg-stoneBg p-2.5">
                      <span className={cx('inline-block rounded-full px-2 py-0.5 font-mono text-[10px]', tone as string)}>{a.error}</span>
                      <div className="mt-1 font-mono text-[10px] text-zinc-500">Tx {shortHash(t.hash, 4)} · Reverted</div>
                    </a>
                  );
                })}
              </div>
            </div>
            <Link to="/lab" className="mt-4 text-left font-mono text-[11px] text-zinc-800 underline">Inspect all {ATTACKS.length} explorer txs → <span className="no-underline"><SourceBadge kind="RECORDED" title={`deployments/diana.json, main contract ${REC.main.address}`} /></span></Link>
          </Reveal>
        </div>
      </div>
    </div>
  );
}

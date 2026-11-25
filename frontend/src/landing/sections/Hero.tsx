import { motion, useReducedMotion, useScroll, useTransform } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { Btn, Rise, Tag } from '../bits';
import { ByteField } from '../ByteField';
import { useLiveData } from '../live';
import { APP_PATH, SAMPLE_PATH } from '../links';

const LINK = 'pocketdrop-app.vercel.app/c/q12#k=7f3a…';

/** The link pill types itself, then drops into the mark. */
function LinkPill() {
  const still = useReducedMotion();
  const [n, setN] = useState(still ? LINK.length : 0);
  useEffect(() => { if (still) return; const t = setTimeout(function tick() { setN((v) => { if (v < LINK.length) setTimeout(tick, 38); return v + 1; }); }, 1500); return () => clearTimeout(t); }, [still]);
  return (
    <motion.div className="pd-hero__pill" initial={still ? false : { opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.2, duration: 0.6 }}>
      <span className="pd-hero__pill-amt">2.00 QOR</span>
      <span className="pd-hero__pill-url">{LINK.slice(0, n)}<i className="pd-caret" /></span>
      <Tag kind="ILLUSTRATION" />
    </motion.div>
  );
}

export function Hero() {
  const live = useLiveData();
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] });
  const lift = useTransform(scrollYProgress, [0, 1], [0, -80]);
  return (
    <section ref={ref} className="pd-hero" id="top">
      <div className="pd-wrap pd-hero__grid">
        <motion.div className="pd-hero__copy" style={{ y: lift }}>
          <Rise as="h1" className="pd-h1" text="Send QOR by link." muted="No wallet on the other end." />
          <motion.p className="pd-lead" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.55, duration: 0.7 }}>
            Paste a link into any chat. The receiver’s browser makes an ML-DSA-87 key and a Pocket on QoreChain that only that key can move.
          </motion.p>
          <motion.div className="pd-hero__cta" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.7, duration: 0.7 }}>
            <Btn href={APP_PATH} testId="hero-open">Open the app</Btn>
            <Btn href={SAMPLE_PATH} kind="ghost" testId="hero-sample">Claim a sample slot</Btn>
          </motion.div>
          <motion.p className="pd-hero__live" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.9 }} data-testid="hero-live">
            <Tag kind={live.source === 'live' ? 'LIVE' : 'SNAPSHOT'} title={live.source === 'live' ? 'Read from the API on this visit' : `Captured ${live.capturedAt}`} />
            <span>Block {live.headBlock?.toLocaleString('en-US') ?? '—'}</span>
            <span>Relays signed secp256k1 + ML-DSA-87</span>
            <span>{live.classicalOpen ? 'Classical path open' : 'ECDSA-only path closed'}</span>
          </motion.p>
        </motion.div>
        <div className="pd-hero__art">
          <ByteField progress={scrollYProgress} />
          <LinkPill />
          <p className="pd-hero__src"><Tag kind="RECORDED" /> Each cell is one byte of a real 4,627-byte ML-DSA-87 signature from our test fixtures.</p>
        </div>
      </div>
    </section>
  );
}

import { motion, useInView, useReducedMotion, type Variants } from 'framer-motion';
import { useRef } from 'react';
import { Rise, Tag } from '../bits';
import { Link } from 'react-router-dom';
import { SAMPLE_PATH } from '../links';
import { REVERIFY } from '../data/recorded';

const STEPS: [string, string, string, string][] = [
  ['Try to take a bait Pocket', 'The classical keys are on the page. Use one.', '/qday', '/qday'],
  ['Claim a sample slot on your phone', 'Watch the key and the Pocket appear.', SAMPLE_PATH, '/pool'],
  ['Paste any hash into the checker', 'It reads Diana directly and decodes the result.', '/check', '/check'],
  ['Read the judges checklist', 'Every requirement, with its code, a transaction and a test.', '/judges', '/judges'],
];

/** Circle and tick draw themselves as each row reaches the middle of the screen (SVG pathLength draw, as in pixel-perfect's SVG animations). */
// Normalised path length (pathLength=1) + dash offset: the draw technique, no plugin needed.
const D: Variants = { off: { strokeDashoffset: 1 }, on: { strokeDashoffset: 0 } };
function Check({ on }: { on: boolean }) {
  const still = useReducedMotion();
  const v = on || still;
  return (
    <svg viewBox="0 0 40 40" className="pd-check" aria-hidden>
      <circle cx="20" cy="20" r="17" className="pd-check__track" />
      <motion.circle cx="20" cy="20" r="17" className="pd-check__ring" pathLength={1} strokeDasharray="1 1" variants={D} initial={still ? 'on' : 'off'} animate={v ? 'on' : 'off'} transition={{ duration: 0.7, ease: [0.65, 0, 0.35, 1] }} style={{ rotate: -90, transformOrigin: '50% 50%' }} />
      <motion.path d="M12.5 20.5 18 26l10-11" className="pd-check__tick" pathLength={1} strokeDasharray="1 1" variants={D} initial={still ? 'on' : 'off'} animate={v ? 'on' : 'off'} transition={{ duration: 0.4, delay: v && !still ? 0.55 : 0 }} />
    </svg>
  );
}
function Step({ s, i }: { s: (typeof STEPS)[number]; i: number }) {
  const ref = useRef<HTMLAnchorElement>(null);
  const on = useInView(ref, { margin: '0px 0px -45% 0px', once: true });
  return (
    <Link ref={ref} to={s[2]} className={`pd-judge ${on ? 'is-on' : ''}`} data-testid={`judge-step-${i + 1}`}>
      <Check on={on} />
      <span className="pd-judge__n">{String(i + 1).padStart(2, '0')}</span>
      <span className="pd-judge__t"><b>{s[0]}</b><small>{s[1]}</small></span>
      <span className="pd-judge__go">{s[3]}</span>
    </Link>
  );
}

const RECEIPT = [
  ['$ node frontend/scripts/reverify.mjs', ''],
  ['EVM transactions', `${REVERIFY.evm} ok`],
  ['Cosmos transactions', `${REVERIFY.cosmos} ok`],
  ['hybrid relays: pqc_hybrid_verify', 'ok'],
  ['v5 and v4 contract code hashes', 'ok'],
];
function Receipt() {
  const ref = useRef<HTMLDivElement>(null);
  const on = useInView(ref, { once: true, amount: 0.5 });
  const still = useReducedMotion();
  return (
    <div ref={ref} className="pd-receipt">
      {RECEIPT.map(([a, b], i) => (
        <motion.div key={a} className={`pd-receipt__row ${i === 0 ? 'is-cmd' : ''}`} initial={still ? false : { opacity: 0, y: 6 }} animate={on ? { opacity: 1, y: 0 } : {}} transition={{ delay: 0.25 + i * 0.35 }}>
          <span>{a}</span><span>{b}</span>
        </motion.div>
      ))}
      <motion.div className="pd-receipt__total" initial={still ? false : { opacity: 0, scale: 0.96 }} animate={on ? { opacity: 1, scale: 1 } : {}} transition={{ delay: 0.25 + RECEIPT.length * 0.35 }}>
        {REVERIFY.passed} passed, {REVERIFY.failed} failed
      </motion.div>
      <p className="pd-receipt__src"><Tag kind="RECORDED" /> {REVERIFY.ranOn} run</p>
    </div>
  );
}

export function Judges() {
  return (
    <section className="pd-judges" id="judges">
      <div className="pd-wrap pd-judges__grid">
        <div>
          <Rise className="pd-h2" text="Check it yourself in four steps." />
          <div className="pd-judges__list">{STEPS.map((s, i) => <Step key={s[0]} s={s} i={i} />)}</div>
        </div>
        <Receipt />
      </div>
    </section>
  );
}

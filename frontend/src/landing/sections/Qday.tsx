import { motion, useInView, useReducedMotion, type Variants } from 'framer-motion';
import { useRef } from 'react';
import { Btn, Count, Rise, Tag } from '../bits';
import { qor, useLiveData } from '../live';
import { explorerTx as explorer } from '../links';

const HX = (cx: number, cy: number, r: number) => Array.from({ length: 6 }, (_, k) => { const a = (Math.PI / 3) * k - Math.PI / 2; return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`; }).join(' ');

const SHOT: Variants = { a: { strokeDashoffset: 1, opacity: 0 }, b: { strokeDashoffset: [1, 0, 0], opacity: [0, 1, 0] } };
/** Five bait Pockets whose classical keys are public. Lines are attempts; each one stops at the hexagon. */
function Field({ ids, on }: { ids: string[]; on: boolean }) {
  const still = useReducedMotion();
  const W = 1000, H = 360, cy = 250;
  const xs = ids.map((_, i) => 120 + i * 190);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="pd-qfield" aria-hidden>
      {xs.map((x, i) => {
        const sx = [60, 300, 520, 760, 940][i], d = `M${sx} 0 C ${sx} 90, ${x} 110, ${x} ${cy - 66}`;
        return (
          <g key={i}>
            <path d={d} className="pd-qline-bg" />
            {on && !still && <motion.path d={d} className="pd-qline" pathLength={1} strokeDasharray="1 1" variants={SHOT} initial="a" animate="b" transition={{ duration: 2.4, times: [0, 0.6, 1], repeat: Infinity, repeatDelay: 1.2 + i * 0.7, delay: i * 0.55 }} />}
            {on && !still && <motion.polygon points={HX(x, cy, 74)} className="pd-qhit" initial={{ opacity: 0, scale: 1 }} animate={{ opacity: [0, 0, 1, 0], scale: [1, 1, 1.12, 1.2] }} style={{ transformOrigin: `${x}px ${cy}px` }} transition={{ duration: 2.4, times: [0, 0.58, 0.64, 1], repeat: Infinity, repeatDelay: 1.2 + i * 0.7, delay: i * 0.55 }} />}
            <polygon points={HX(x, cy, 64)} className="pd-qhex" />
            <circle cx={sx} cy={4} r={3} className="pd-qsrc" />
            <text x={sx > 800 ? sx - 10 : sx + 10} y={8} textAnchor={sx > 800 ? 'end' : 'start'} className="pd-qsrc-t">{ids[i]} key</text>
          </g>
        );
      })}
    </svg>
  );
}

export function Qday() {
  const l = useLiveData();
  const ref = useRef<HTMLDivElement>(null);
  const on = useInView(ref, { amount: 0.3 });
  const baits = l.baits.length ? l.baits : [];
  const tag = l.source === 'live' ? 'LIVE' : 'SNAPSHOT';
  return (
    <section className="pd-qday" id="qday" data-dark>
      <div className="pd-qday__bg" aria-hidden />
      <div className="pd-wrap pd-qday__in" ref={ref}>
        <div className="pd-qday__head">
          <Rise className="pd-h2 pd-h2--light" text="We published five classical keys." muted="The QOR is still there." />
          <p className="pd-qday__lead">Each bait Pocket also has an ordinary secp256k1 key, printed in the open. Anyone can try to move the QOR with it. The chain asks for ML-DSA-87 and says no.</p>
        </div>
        <div className="pd-qday__stage">
          <Field ids={baits.map((b) => b.id)} on={on} />
          <div className="pd-qday__cells">
            {baits.map((b) => (
              <div key={b.id} className="pd-qcell">
                <b>{b.id}</b>
                <span className="pd-qcell__bal">{qor(b.pocketWei)}<small> QOR</small></span>
                <span className="pd-qcell__st">{b.alarm.length ? 'alarm' : 'untouched'}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="pd-qday__foot">
          <div className="pd-qday__count" data-testid="qday-refused" data-value={l.refused.length}>
            <Count to={l.refused.length} className="pd-num pd-num--light" />
            <p>attempts with a published key, refused on chain <Tag kind={tag} /></p>
          </div>
          <div className="pd-term" role="log" aria-label="Refused attempts">
            <div className="pd-term__bar"><i /><i /><i /><span>qday / on-chain log</span></div>
            {l.refused.slice(0, 4).map((r, i) => (
              <motion.a key={r.tx} href={explorer(r.tx)} className="pd-term__row" initial={{ opacity: 0, x: -10 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ delay: 0.2 + i * 0.15 }}>
                <span className="pd-term__h">{r.tx.replace(/^0x/, '').slice(0, 8).toLowerCase()}…{r.tx.slice(-4).toLowerCase()}</span>
                <span>{r.bait} {r.call}</span>
                <span className="pd-term__d">{r.lane} · {r.time ? new Date(r.time).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : r.height}</span>
                <span className="pd-term__no">refused</span>
              </motion.a>
            ))}
          </div>
          <div className="pd-qday__act">
            <Btn href="/qday" kind="light" testId="qday-cta">Try to take it</Btn>
            <p>Our own drill, always on, separate from the organisers’ 18 Nov drill. Balances <Tag kind={tag} /></p>
          </div>
        </div>
      </div>
    </section>
  );
}

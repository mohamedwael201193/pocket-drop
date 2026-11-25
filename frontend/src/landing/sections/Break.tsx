import { motion, useScroll, useTransform, type MotionValue } from 'framer-motion';
import { useMemo, useRef } from 'react';
import { Rise, Tag } from '../bits';
import { useLiveData } from '../live';


function Tile({ c, i, p }: { c: string; i: number; p: MotionValue<number> }) {
  const r = useMemo(() => { const h = (k: number) => { const s = Math.sin(i * 91.7 + k * 13.1) * 43758.5; return s - Math.floor(s); }; return { x: (h(1) - 0.5) * 300, y: 260 + h(2) * 420, rot: (h(3) - 0.5) * 200, d: (i % 8) * 0.012 + Math.floor(i / 8) * 0.008 }; }, [i]);
  const x = useTransform(p, [0.45 + r.d, 0.75 + r.d], [0, r.x]);
  const y = useTransform(p, [0.45 + r.d, 0.75 + r.d], [0, r.y]);
  const rotate = useTransform(p, [0.45 + r.d, 0.75 + r.d], [0, r.rot]);
  const opacity = useTransform(p, [0.52 + r.d, 0.66 + r.d], [1, 0]);
  return <motion.span className="pd-tile" style={{ x, y, rotate, opacity }}>{c}</motion.span>;
}

function Steady() {
  // 2,592 cells, one per byte of an ML-DSA-87 public key. Shading is illustrative.
  const cells = useMemo(() => Array.from({ length: 2592 }, (_, i) => { const s = Math.sin(i * 12.9898 + 78.233) * 43758.5453; return 0.3 + (s - Math.floor(s)) * 0.7; }), []);
  return <div className="pd-steady" aria-hidden>{cells.map((o, i) => <i key={i} style={{ opacity: o }} />)}</div>;
}

export function Break() {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress: p } = useScroll({ target: ref, offset: ['start end', 'end start'] });
  const leak = useTransform(p, [0.66, 0.74], [0, 1]);
  // Bait B1's classical private key, published on purpose by the API (/api/qday, shown on /qday). Not stored in this repo:
  // with the API down the tiles show dots instead.
  const key = useLiveData().baits.find((b) => b.id === 'B1')?.classicalKey?.replace(/^0x/, '');
  const shown = key && /^[0-9a-f]{64}$/i.test(key) ? key.toLowerCase() : '·'.repeat(64);
  return (
    <section ref={ref} className="pd-break" id="why">
      <div className="pd-wrap">
        <Rise className="pd-h2 pd-break__h" text="A classical key is 32 bytes. Once it leaks, it is someone else’s." />
        <div className="pd-break__grid">
          <div className="pd-break__card pd-break__card--ink" data-dark>
            <div className="pd-break__meta"><span>secp256k1 private key</span><span>32 bytes</span></div>
            <div className="pd-tiles" aria-label={key ? `Published key ${shown}` : 'Published key, loading from the API'}>{shown.split('').map((c, i) => <Tile key={i} c={c} i={i} p={p} />)}</div>
            <motion.p className="pd-break__leak" style={{ opacity: leak }}>Leaked. Any holder can sign for an ordinary account.</motion.p>
            <p className="pd-break__src">{key ? <><Tag kind="LIVE" /> Bait B1’s real key, published on /qday</> : 'Bait B1’s key loads from the API; it is published on /qday'}</p>
          </div>
          <div className="pd-break__card pd-break__card--em">
            <div className="pd-break__meta"><span>ML-DSA-87 public key</span><span>2,592 bytes</span></div>
            <Steady />
            <p className="pd-break__hold">A Pocket moves only when an ML-DSA-87 signature checks out at precompile 0x0A01.</p>
            <p className="pd-break__src"><Tag kind="ILLUSTRATION" /> One cell per byte; values not shown</p>
          </div>
        </div>
      </div>
    </section>
  );
}

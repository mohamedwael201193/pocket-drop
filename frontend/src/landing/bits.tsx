import { animate, motion, useInView, useReducedMotion } from 'framer-motion';
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

/** Source label on every number. LIVE = read from the API on this visit; RECORDED = a repo file or mined tx; ILLUSTRATION = example only. */
export function Tag({ kind, title }: { kind: 'LIVE' | 'RECORDED' | 'ILLUSTRATION' | 'SNAPSHOT'; title?: string }) {
  return <span className={`pd-tag pd-tag--${kind.toLowerCase()}`} title={title}>{kind === 'LIVE' && <i className="pd-dot" />}{kind === 'SNAPSHOT' ? 'Recorded snapshot' : kind[0] + kind.slice(1).toLowerCase()}</span>;
}

/** Counts up once when it scrolls into view (inspired by React Bits "CountUp", rewritten). */
export function Count({ to, className, format = (n: number) => Math.round(n).toLocaleString('en-US') }: { to: number; className?: string; format?: (n: number) => string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const seen = useInView(ref, { once: true, amount: 0.6 });
  const still = useReducedMotion();
  const [v, setV] = useState(still ? to : 0);
  useEffect(() => {
    if (!seen) return;
    if (still) { setV(to); return; }
    const c = animate(0, to, { duration: 1.6, ease: [0.16, 1, 0.3, 1], onUpdate: setV });
    return () => c.stop();
  }, [seen, to, still]);
  return <span ref={ref} className={className}>{format(v)}</span>;
}

/** Word-by-word rise for headings (pattern from React Bits "SplitText", own code; whole text stays in the DOM for readers). */
export function Rise({ text, as = 'h2', className, delay = 0, muted }: { text: string; as?: 'h1' | 'h2' | 'h3' | 'p'; className?: string; delay?: number; muted?: string }) {
  const still = useReducedMotion();
  const Tag = motion[as];
  const words = text.split(' ');
  const mwords = muted ? muted.split(' ') : [];
  const w = (word: string, i: number, mutedWord: boolean) => (
    <Fragment key={i + word + mutedWord}>{i > 0 && ' '}<span className="pd-rise-mask"><motion.span className={mutedWord ? 'pd-muted' : undefined} style={{ display: 'inline-block' }}
      variants={{ hide: { y: '105%' }, show: { y: '0%', transition: { duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: delay + i * 0.045 } } }}>{word}</motion.span></span></Fragment>
  );
  return (
    <Tag className={className} initial={still ? 'show' : 'hide'} whileInView="show" viewport={{ once: true, amount: 0.4 }} aria-label={muted ? `${text} ${muted}` : text}>
      <span aria-hidden>{words.map((x, i) => w(x, i, false))}{muted && <br className="pd-rise-br" />}{mwords.map((x, i) => w(x, words.length + i, true))}</span>
    </Tag>
  );
}

/** Magnetic pull toward the pointer (idea from React Bits "Magnet"; own spring code). Off on touch and reduced motion. */
export function Magnetic({ children, strength = 0.28 }: { children: ReactNode; strength?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const still = useReducedMotion();
  const [p, setP] = useState({ x: 0, y: 0 });
  return (
    <motion.span ref={ref} className="pd-magnet" animate={p} transition={{ type: 'spring', stiffness: 220, damping: 16, mass: 0.4 }}
      onPointerMove={(e) => { if (still || e.pointerType !== 'mouse') return; const r = ref.current!.getBoundingClientRect(); setP({ x: (e.clientX - r.left - r.width / 2) * strength, y: (e.clientY - r.top - r.height / 2) * strength }); }}
      onPointerLeave={() => setP({ x: 0, y: 0 })}>{children}</motion.span>
  );
}

/** In-app paths ("/app", "/qday") go through the router; anything else opens in a new tab. */
export function Go({ to, children, className, testId, onClick }: { to: string; children: ReactNode; className?: string; testId?: string; onClick?: () => void }) {
  if (to.startsWith('/')) return <Link to={to} className={className} data-testid={testId} onClick={onClick}>{children}</Link>;
  return <a href={to} className={className} data-testid={testId} onClick={onClick} target="_blank" rel="noopener noreferrer">{children}</a>;
}

export function Btn({ href, children, kind = 'primary', testId }: { href: string; children: ReactNode; kind?: 'primary' | 'ghost' | 'light' | 'outline-light'; testId?: string }) {
  return <Magnetic><Go to={href} className={`pd-btn pd-btn--${kind}`} testId={testId}><span>{children}</span><svg viewBox="0 0 16 16" aria-hidden className="pd-btn__arrow"><path d="M3 8h9M8.5 4.5 12 8l-3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg></Go></Magnetic>;
}

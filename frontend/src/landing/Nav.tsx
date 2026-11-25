import { AnimatePresence, motion, useMotionValueEvent, useScroll } from 'framer-motion';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Go } from './bits';
import { LogoMark } from './Logo';
import { APP_PATH } from './links';

const LINKS = [['How it works', '#story'], ['Q-Day drill', '/qday'], ['Proof', '/proof'], ['For judges', '/judges']] as const;
const Item = ({ l, h, onClick }: { l: string; h: string; onClick?: () => void }) =>
  h.startsWith('#') ? <a href={h} onClick={onClick}>{l}</a> : <Go to={h} onClick={onClick}>{l}</Go>;

/** Full-width bar at the top that tightens into a floating pill after 40 px of scroll. */
export function Nav() {
  const { scrollY } = useScroll();
  const [pill, setPill] = useState(false);
  const [open, setOpen] = useState(false);
  useMotionValueEvent(scrollY, 'change', (y) => setPill(y > 40));
  return (
    <>
      <motion.header className={`pd-nav ${pill ? 'is-pill' : ''}`} layout transition={{ type: 'spring', stiffness: 300, damping: 34 }}>
        <a href="#top" className="pd-nav__brand" aria-label="Pocket Drop home" data-testid="landing-logo"><LogoMark size={28} /><span>Pocket Drop</span></a>
        <nav className="pd-nav__links" aria-label="Main">{LINKS.map(([l, h]) => <Item key={h} l={l} h={h} />)}</nav>
        <div className="pd-nav__end">
          <span className="pd-nav__net"><i className="pd-dot" />Diana testnet</span>
          <Link className="pd-btn pd-btn--primary pd-btn--sm" to={APP_PATH} data-testid="nav-open-app"><span>Open the app</span></Link>
          <button className="pd-nav__menu" aria-expanded={open} aria-label="Menu" onClick={() => setOpen(!open)}><i /><i /></button>
        </div>
      </motion.header>
      <AnimatePresence>
        {open && (
          <motion.div className="pd-sheet" initial={{ clipPath: 'circle(0% at 92% 4%)' }} animate={{ clipPath: 'circle(150% at 92% 4%)' }} exit={{ clipPath: 'circle(0% at 92% 4%)' }} transition={{ duration: 0.55, ease: [0.65, 0, 0.35, 1] }}>
            <button className="pd-sheet__close" onClick={() => setOpen(false)} aria-label="Close menu">Close</button>
            {LINKS.map(([l, h], i) => (
              <motion.div key={h} className="pd-sheet__item" initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.15 + i * 0.06 }}><Item l={l} h={h} onClick={() => setOpen(false)} /></motion.div>
            ))}
            <Link className="pd-btn pd-btn--light" to={APP_PATH}><span>Open the app</span></Link>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

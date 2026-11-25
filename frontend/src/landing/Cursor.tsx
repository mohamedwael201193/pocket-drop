import { motion, useMotionValue, useSpring } from 'framer-motion';
import { useEffect, useState } from 'react';

/** A trailing ring that grows over links (follower-ring idea from Cursify; own code). Mouse only; the system cursor stays. */
export function Cursor() {
  const x = useMotionValue(-100), y = useMotionValue(-100);
  const sx = useSpring(x, { stiffness: 500, damping: 40, mass: 0.5 }), sy = useSpring(y, { stiffness: 500, damping: 40, mass: 0.5 });
  const [big, setBig] = useState(false);
  const [on, setOn] = useState(false);
  const [dark, setDark] = useState(false);
  useEffect(() => {
    if (!matchMedia('(pointer: fine)').matches || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    setOn(true);
    const mv = (e: PointerEvent) => {
      x.set(e.clientX); y.set(e.clientY);
      const t = e.target as HTMLElement;
      setBig(!!t.closest('a,button,[data-cursor]'));
      setDark(!!t.closest('[data-dark]'));
    };
    addEventListener('pointermove', mv, { passive: true });
    return () => removeEventListener('pointermove', mv);
  }, [x, y]);
  if (!on) return null;
  return <motion.div className={`pd-cursor ${dark ? 'is-dark' : ''}`} style={{ x: sx, y: sy }} animate={{ scale: big ? 1.9 : 1 }} transition={{ type: 'spring', stiffness: 300, damping: 22 }} aria-hidden />;
}

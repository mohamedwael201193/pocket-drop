/**
 * The Pocket Drop mark: an emerald hexagon (the Pocket) holding a white droplet (the drop).
 * Micro-interaction: on hover the hexagon turns a sixth and the droplet falls back into place;
 * `pulse` replays a short drip whenever it changes (the shell passes the route). Static for reduced motion.
 */
import { motion, useReducedMotion } from 'framer-motion';

const HEX = 'M16 2.6 27.6 9.3v13.4L16 29.4 4.4 22.7V9.3Z';
const DROP = 'M16 8.4c2.9 3.6 4.9 6.2 4.9 8.9a4.9 4.9 0 1 1-9.8 0c0-2.7 2-5.3 4.9-8.9Z';

export function LogoMark({ size = 32, pulse, className }: { size?: number; pulse?: string; className?: string }) {
  const still = useReducedMotion();
  return (
    <motion.svg viewBox="0 0 32 32" width={size} height={size} className={className} aria-hidden data-testid="logo-mark"
      initial={false} whileHover={still ? undefined : 'hover'}>
      <defs>
        <linearGradient id="pd-hex" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#14915F" /><stop offset=".55" stopColor="#0F6B4A" /><stop offset="1" stopColor="#0A4E36" />
        </linearGradient>
        <linearGradient id="pd-shine" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity=".35" /><stop offset=".6" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <motion.g style={{ originX: '50%', originY: '50%' }} variants={{ hover: { rotate: 60 } }} transition={{ type: 'spring', stiffness: 260, damping: 18 }}>
        <path d={HEX} fill="url(#pd-hex)" />
        <path d={HEX} fill="url(#pd-shine)" />
      </motion.g>
      <motion.path key={pulse} d={DROP} fill="#fff"
        initial={still ? false : { y: -5, scaleY: 1.15, opacity: 0 }} animate={{ y: 0, scaleY: 1, opacity: 1 }}
        variants={{ hover: { y: [0, -2.5, 0], transition: { duration: 0.5 } } }}
        transition={{ type: 'spring', stiffness: 420, damping: 16 }} style={{ originX: '50%', originY: '100%' }} />
    </motion.svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return <span className={['font-display text-[19px] font-semibold tracking-[-0.03em] text-zinc-900', className].filter(Boolean).join(' ')}>Pocket Drop</span>;
}

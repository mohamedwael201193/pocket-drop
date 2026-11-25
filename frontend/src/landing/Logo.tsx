import { motion, useReducedMotion } from 'framer-motion';
// Same geometry as frontend/src/components/logo.tsx (emerald hexagon, white droplet).
export const HEX = 'M16 2.6 27.6 9.3v13.4L16 29.4 4.4 22.7V9.3Z';
export const DROP = 'M16 8.4c2.9 3.6 4.9 6.2 4.9 8.9a4.9 4.9 0 1 1-9.8 0c0-2.7 2-5.3 4.9-8.9Z';
export function LogoMark({ size = 30, light }: { size?: number; light?: boolean }) {
  const still = useReducedMotion();
  return (
    <motion.svg viewBox="0 0 32 32" width={size} height={size} aria-hidden whileHover={still ? undefined : 'h'} initial={false}>
      <defs><linearGradient id="pdx" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#14915F" /><stop offset=".55" stopColor="#0F6B4A" /><stop offset="1" stopColor="#0A4E36" /></linearGradient></defs>
      <motion.path d={HEX} fill={light ? '#fff' : 'url(#pdx)'} style={{ originX: '50%', originY: '50%' }} variants={{ h: { rotate: 60 } }} transition={{ type: 'spring', stiffness: 260, damping: 18 }} />
      <motion.path d={DROP} fill={light ? '#0B6B4B' : '#fff'} variants={{ h: { y: [0, -2.5, 0], transition: { duration: 0.5 } } }} />
    </motion.svg>
  );
}

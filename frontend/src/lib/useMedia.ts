import { useEffect, useState } from 'react';

export type Bp = 'mobile' | 'tablet' | 'desktop';
const read = (): Bp => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'desktop';
  if (window.matchMedia('(min-width: 1024px)').matches) return 'desktop';
  if (window.matchMedia('(min-width: 768px)').matches) return 'tablet';
  return 'mobile';
};

/** Which shell to render: bottom tab bar (< 768 px), collapsible rail (768-1023 px) or the full sidebar (>= 1024 px). */
export function useBreakpoint(): Bp {
  const [bp, setBp] = useState<Bp>(read);
  useEffect(() => {
    const f = () => setBp(read());
    window.addEventListener('resize', f);
    return () => window.removeEventListener('resize', f);
  }, []);
  return bp;
}

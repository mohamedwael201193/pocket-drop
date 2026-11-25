/**
 * The landing at "/". A separate lazy chunk: it imports nothing from the dashboard (no viem, no account, no vault),
 * and the dashboard never imports this folder. Hero and the live strip render first; the sections below the fold
 * (pinned story, shatter, Q-Day, proof, judges, CTA, footer) are a second chunk fetched right after.
 */
import { MotionConfig } from 'framer-motion';
import { Suspense, lazy, useEffect } from 'react';
import './landing.css';
import { Cursor } from './Cursor';
import { Lattice } from './Lattice';
import { Nav } from './Nav';
import { LiveCtx, useLive } from './live';
import { Hero } from './sections/Hero';
import { LiveStrip } from './sections/LiveStrip';
import { titleFor } from '../lib/titles';

const Rest = lazy(() => import('./Rest'));

/** Lenis smooth scroll (MIT), loaded on demand. Off for reduced motion, for automated browsers and with ?nolenis. */
function useSmoothScroll() {
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches || navigator.webdriver || location.search.includes('nolenis')) return;
    let stop = () => {};
    let dead = false;
    void import('lenis').then(({ default: Lenis }) => {
      if (dead) return;
      const lenis = new Lenis({ lerp: 0.1, anchors: { offset: -80 } });
      let r = requestAnimationFrame(function raf(t) { lenis.raf(t); r = requestAnimationFrame(raf); });
      stop = () => { cancelAnimationFrame(r); lenis.destroy(); };
    });
    return () => { dead = true; stop(); };
  }, []);
}

export default function LandingPage() {
  const live = useLive();
  useSmoothScroll();
  useEffect(() => { document.title = titleFor('/'); window.scrollTo(0, 0); }, []);
  return (
    <MotionConfig reducedMotion="user">
      <LiveCtx.Provider value={live}>
        <div className="pd-root" data-testid="landing">
          <div className="pd-bg" aria-hidden><Lattice /></div>
          <div className="pd-grain" aria-hidden />
          <Cursor />
          <Nav />
          <main>
            <Hero />
            <LiveStrip />
            <Suspense fallback={<div className="pd-rest-wait" aria-hidden />}>
              <Rest />
            </Suspense>
          </main>
        </div>
      </LiveCtx.Provider>
    </MotionConfig>
  );
}

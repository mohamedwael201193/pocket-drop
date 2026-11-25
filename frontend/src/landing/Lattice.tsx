import { useEffect, useRef } from 'react';

/**
 * A living lattice: points of a triangular (hexagonal) lattice, the picture behind ML-DSA's module lattices.
 * - drifts on a slow wave, shifted by scroll position;
 * - near the pointer the points part and their lattice edges light up in emerald;
 * - a click sends a ring through the lattice.
 * Canvas 2D only, DPR capped at 1.5, ~30 fps on touch devices, paused off screen. Static single frame under reduced motion.
 * Idea from React Bits backgrounds ("Dot Grid", "Grid Distortion"); this is our own implementation.
 */
type V = 'paper' | 'emerald' | 'dark';
const PAL: Record<V, { dot: string; edge: string; hot: string }> = {
  paper: { dot: '24,24,27', edge: '11,107,75', hot: '16,185,129' },
  emerald: { dot: '255,255,255', edge: '255,255,255', hot: '190,255,225' },
  dark: { dot: '255,255,255', edge: '16,185,129', hot: '110,231,183' },
};

export function Lattice({ variant = 'paper', spacing, intensity = 1, scrollFollow = true }: { variant?: V; spacing?: number; intensity?: number; scrollFollow?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current!; const ctx = cv.getContext('2d')!;
    const pal = PAL[variant];
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const touch = matchMedia('(pointer: coarse)').matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    let W = 0, H = 0, raf = 0, visible = true, last = 0;
    const S = spacing ?? (touch ? 34 : 28);
    const RY = S * 0.866;
    const mouse = { x: -9999, y: -9999, on: false };
    const rings: { x: number; y: number; t: number }[] = [];
    const resize = () => {
      const r = cv.parentElement!.getBoundingClientRect(); W = r.width; H = r.height;
      cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (still) draw(0);
    };
    const local = (e: PointerEvent) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top, inside: e.clientY >= r.top && e.clientY <= r.bottom }; };
    const move = (e: PointerEvent) => { if (e.pointerType !== 'mouse') return; const p = local(e); mouse.x = p.x; mouse.y = p.y; mouse.on = p.inside; };
    const click = (e: PointerEvent) => { const p = local(e); if (p.inside && rings.length < 4) rings.push({ x: p.x, y: p.y, t: performance.now() }); };
    const R = 150;
    function draw(now: number) {
      ctx.clearRect(0, 0, W, H);
      const t = now / 1000;
      const sy = scrollFollow ? window.scrollY * 0.18 : 0;
      const oy = -(sy % (RY * 2));
      const cols = Math.ceil(W / S) + 2, rows = Math.ceil(H / RY) + 3;
      const px: number[] = [], py: number[] = [], heat: number[] = [];
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          let x = (i - 1) * S + (j % 2 ? S / 2 : 0), y = (j - 1) * RY + oy;
          const w = still ? 0 : Math.sin(x * 0.012 + t * 0.6 + sy * 0.01) * Math.cos(y * 0.014 - t * 0.45);
          x += w * 2.2; y += w * 2.2;
          let h = 0;
          if (mouse.on) {
            const dx = x - mouse.x, dy = y - mouse.y, d = Math.hypot(dx, dy);
            if (d < R) { const f = 1 - d / R; h = f; x += (dx / (d || 1)) * f * f * 16; y += (dy / (d || 1)) * f * f * 16; }
          }
          for (const r of rings) {
            const rad = (now - r.t) * 0.55, d = Math.hypot(x - r.x, y - r.y), band = Math.abs(d - rad);
            if (band < 26) h = Math.max(h, (1 - band / 26) * Math.max(0, 1 - rad / 900));
          }
          px.push(x); py.push(y); heat.push(h);
        }
      }
      // edges near the pointer or on a ring
      ctx.lineWidth = 1;
      for (let j = 0; j < rows - 1; j++) for (let i = 0; i < cols; i++) {
        const k = j * cols + i; const hk = heat[k]; if (hk <= 0.02) continue;
        const b = (j + 1) * cols, odd = j % 2 === 1;
        const nb = [i + 1 < cols ? k + 1 : -1, odd ? b + i : i > 0 ? b + i - 1 : -1, odd ? (i + 1 < cols ? b + i + 1 : -1) : b + i];
        for (const n of nb) {
          if (n < 0 || n >= px.length) continue; const a = Math.min(hk, heat[n]); if (a <= 0.02) continue;
          ctx.strokeStyle = `rgba(${pal.edge},${(a * 0.55 * intensity).toFixed(3)})`;
          ctx.beginPath(); ctx.moveTo(px[k], py[k]); ctx.lineTo(px[n], py[n]); ctx.stroke();
        }
      }
      for (let k = 0; k < px.length; k++) {
        const h = heat[k];
        ctx.fillStyle = h > 0.05 ? `rgba(${pal.hot},${(0.35 + h * 0.6) * intensity})` : `rgba(${pal.dot},${0.2 * intensity})`;
        const s = 1.1 + h * 1.6; ctx.fillRect(px[k] - s / 2, py[k] - s / 2, s, s);
      }
      while (rings.length && now - rings[0].t > 1800) rings.shift();
    }
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (!visible || document.hidden) return;
      if (touch && now - last < 33) return; last = now;
      draw(now);
    };
    const ro = new ResizeObserver(resize); ro.observe(cv.parentElement!); resize();
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; }); io.observe(cv);
    if (!still) { raf = requestAnimationFrame(loop); addEventListener('pointermove', move, { passive: true }); addEventListener('pointerdown', click); }
    else addEventListener('scroll', () => draw(0), { passive: true });
    return () => { cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); removeEventListener('pointermove', move); removeEventListener('pointerdown', click); };
  }, [variant, spacing, intensity, scrollFollow]);
  return <canvas ref={ref} className="pd-lattice" aria-hidden />;
}

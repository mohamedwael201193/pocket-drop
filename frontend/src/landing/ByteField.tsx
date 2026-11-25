import { useEffect, useRef, useState } from 'react';
import sig from './data/signature.json';
import { DROP, HEX } from './Logo';

/**
 * The hero mark, made of data: every cell is one byte of a real 4,627-byte ML-DSA-87 signature
 * (contracts-v4/test/fixtures/pool/claim_2_1.json). Cells inside the droplet are paper, the rest emerald,
 * shaded by the byte's value. Cells fly in, blink, show their byte under the pointer and scatter on scroll.
 */
const BYTES = (() => { const h = sig.sig.replace(/^0x/, ''); const a = new Uint8Array(h.length / 2); for (let i = 0; i < a.length; i++) a[i] = parseInt(h.substr(i * 2, 2), 16); return a; })();

type Cell = { x: number; y: number; drop: boolean; b: number; sx: number; sy: number; d: number; vx: number; vy: number; blink: number; rgb: string; base: number };

export function ByteField({ progress }: { progress: { get(): number } }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState<{ x: number; y: number; i: number } | null>(null);
  useEffect(() => {
    const cv = ref.current!; const ctx = cv.getContext('2d')!;
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const touch = matchMedia('(pointer: coarse)').matches;
    const dpr = Math.min(devicePixelRatio || 1, touch ? 1.5 : 2);
    let lastDraw = 0;
    const t0 = performance.now();
    let size = 0, pitch = 0, cells: Cell[] = [], raf = 0, hi = -1, visible = true;
    const build = () => {
      size = cv.parentElement!.clientWidth;
      cv.width = size * dpr; cv.height = size * dpr; cv.style.width = cv.style.height = size + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const k = size / 32, hex = new Path2D(), drop = new Path2D();
      hex.addPath(new Path2D(HEX), new DOMMatrix([k, 0, 0, k, 0, 0])); drop.addPath(new Path2D(DROP), new DOMMatrix([k, 0, 0, k, 0, 0]));
      const inside = (p: number) => { const out: { x: number; y: number }[] = []; for (let y = 2.6 * k + p / 2; y < 29.4 * k; y += p) for (let x = 4.4 * k + p / 2; x < 27.6 * k; x += p) if (ctx.isPointInPath(hex, x * dpr, y * dpr)) out.push({ x, y }); return out; };
      // the largest pitch that still fits all 4,627 bytes
      const area = 2.598 * (13.4 * k) ** 2;
      let p = Math.sqrt(area / BYTES.length) * 1.03, pts = inside(p); while (pts.length < BYTES.length && p > 1) { p -= 0.01; pts = inside(p); }
      pitch = p; pts = pts.slice(0, BYTES.length);
      cells = pts.map((q, i) => {
        const a = Math.random() * Math.PI * 2, r = size * (0.35 + Math.random() * 0.5);
        const b = BYTES[i], dr = ctx.isPointInPath(drop, q.x * dpr, q.y * dpr);
        return { x: q.x, y: q.y, drop: dr, b, rgb: dr ? '255,255,255' : `${11 + (b >> 4)},${90 + (b >> 2)},${62 + (b >> 3)}`, base: dr ? 0.75 + (b / 255) * 0.25 : 0.55 + (b / 255) * 0.45, sx: size / 2 + Math.cos(a) * r, sy: size / 2 + Math.sin(a) * r, d: (q.y / size) * 0.9 + Math.random() * 0.5, vx: Math.cos(a), vy: Math.sin(a) - 0.4, blink: 0 };
      });
    };
    const ease = (x: number) => 1 - Math.pow(1 - Math.min(Math.max(x, 0), 1), 4);
    let settled: HTMLCanvasElement | null = null; const maxD = 1.5 + 1.5 + 0.1;
    const draw = (now: number) => {
      const t = still ? 99 : (now - t0) / 1000;
      const sc = still ? 0 : progress.get();
      // After the intro, with no scroll-out and no hover, paint a cached frame and only the blinking cells on top.
      if (t > maxD && sc === 0 && hi < 0) {
        if (!settled) { settled = document.createElement('canvas'); settled.width = cv.width; settled.height = cv.height; const sv = { hi }; hi = -2; drawAll(99, 0, settled.getContext('2d')!, true); hi = sv.hi; }
        ctx.clearRect(0, 0, size, size); ctx.drawImage(settled, 0, 0, size, size);
        const s = pitch * 0.78;
        if (!still && Math.random() < 0.6) { const c = cells[(Math.random() * cells.length) | 0]; if (c) c.blink = 1; }
        for (const c of cells) if (c.blink > 0) { c.blink -= 0.02; ctx.fillStyle = `rgba(110,231,183,${c.blink.toFixed(2)})`; ctx.fillRect(c.x - s / 2, c.y - s / 2, s, s); }
        return;
      }
      drawAll(t, sc, ctx, false);
    };
    const drawAll = (t: number, sc: number, g: CanvasRenderingContext2D, cache: boolean) => {
      const ctx = g; if (cache) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);
      const s = pitch * 0.78;
      if (!cache && !still && Math.random() < 0.6) { const c = cells[(Math.random() * cells.length) | 0]; if (c) c.blink = 1; }
      for (let i = 0; i < cells.length; i++) {
        const c = cells[i]; const e = ease((t - c.d) / 1.5);
        let x = c.sx + (c.x - c.sx) * e, y = c.sy + (c.y - c.sy) * e;
        if (sc > 0) { const f = sc * sc * size * 0.6 * (0.4 + (c.b / 255)); x += c.vx * f; y += c.vy * f; }
        const a = e * (1 - sc * 0.9);
        if (a <= 0.01) continue;
        if (!cache && c.blink > 0) c.blink -= 0.02;
        if (i === hi) ctx.fillStyle = '#18181B';
        else if (!cache && c.blink > 0) ctx.fillStyle = `rgba(110,231,183,${a})`;
        else ctx.fillStyle = `rgba(${c.rgb},${(a * c.base).toFixed(3)})`;
        ctx.fillRect(x - s / 2, y - s / 2, s, s);
      }
    };
    const loop = (now: number) => { raf = requestAnimationFrame(loop); if (!visible || document.hidden) return; if (touch && now - lastDraw < 33) return; lastDraw = now; draw(now); };
    const ro = new ResizeObserver(() => { build(); settled = null; if (still) draw(0); }); ro.observe(cv.parentElement!);
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; }); io.observe(cv);
    build();
    if (still) draw(0); else raf = requestAnimationFrame(loop);
    const mv = (e: PointerEvent) => {
      const r = cv.getBoundingClientRect(); const x = e.clientX - r.left, y = e.clientY - r.top;
      let best = -1, bd = pitch * pitch; for (let i = 0; i < cells.length; i++) { const dx = cells[i].x - x, dy = cells[i].y - y, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = i; } }
      hi = best; setHover(best >= 0 ? { x, y, i: best } : null); if (still) draw(0);
    };
    const lv = () => { hi = -1; setHover(null); if (still) draw(0); };
    cv.addEventListener('pointermove', mv); cv.addEventListener('pointerleave', lv);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); cv.removeEventListener('pointermove', mv); cv.removeEventListener('pointerleave', lv); };
  }, [progress]);
  return (
    <div className="pd-bytes">
      <canvas ref={ref} role="img" aria-label="The Pocket Drop mark drawn with the 4,627 bytes of a real ML-DSA-87 signature" />
      {hover && (
        <div className="pd-bytes__probe" style={{ transform: `translate(${hover.x}px, ${hover.y}px)` }}>
          byte {(hover.i + 1).toLocaleString('en-US')} <b>0x{BYTES[hover.i].toString(16).padStart(2, '0').toUpperCase()}</b>
        </div>
      )}
    </div>
  );
}

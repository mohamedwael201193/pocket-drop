/**
 * The one 3D object: a slowly turning obsidian Pocket (the brand hexagon as a prism) with a green drop inside
 * and a key ring around it. Plain three.js, loaded in its own chunk after the page is idle. Decoration only.
 * Pauses off-screen and in hidden tabs; calls onSlow() and stops if the device cannot hold ~36 fps.
 */
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export default function Pocket3D({ onReady, onSlow }: { onReady?: () => void; onSlow?: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = host.current; if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' }); } catch { onSlow?.(); return; }
    const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
    renderer.setPixelRatio(dpr);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.domElement.setAttribute('aria-hidden', 'true');
    renderer.domElement.style.width = '100%'; renderer.domElement.style.height = '100%'; renderer.domElement.style.display = 'block';
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
    camera.position.set(0, 0.35, 6.2);

    const rig = new THREE.Group(); scene.add(rig);
    // Obsidian Pocket: a hexagonal prism with bevel-like softness from a slight scale on a second shell.
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(1.25, 1.25, 0.62, 6, 1),
      new THREE.MeshPhysicalMaterial({ color: 0x1c1c20, metalness: 0.55, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.12, envMapIntensity: 1.25 }),
    );
    body.rotation.x = Math.PI / 2; rig.add(body);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(body.geometry), new THREE.LineBasicMaterial({ color: 0x6ee7b7, transparent: true, opacity: 0.45 }));
    edges.rotation.x = Math.PI / 2; edges.scale.setScalar(1.002); rig.add(edges);
    // Stone face plate (the owner's titanium) on the front.
    const plate = new THREE.Mesh(
      new THREE.CylinderGeometry(0.98, 0.98, 0.04, 6, 1),
      new THREE.MeshPhysicalMaterial({ color: 0xd9d4ca, metalness: 0.85, roughness: 0.32, envMapIntensity: 1 }),
    );
    plate.rotation.x = Math.PI / 2; plate.position.z = 0.33; rig.add(plate);
    // The drop: the QOR that lands in the Pocket.
    const drop = new THREE.Mesh(
      new THREE.SphereGeometry(0.34, 48, 32),
      new THREE.MeshPhysicalMaterial({ color: 0x10b981, emissive: 0x0b6b4b, emissiveIntensity: 0.55, metalness: 0.1, roughness: 0.08, transmission: 0.2, clearcoat: 1 }),
    );
    drop.scale.set(1, 1.18, 1); drop.position.z = 0.62; rig.add(drop);
    // Key ring: the quantum-safe key orbiting the Pocket.
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.75, 0.018, 12, 160), new THREE.MeshBasicMaterial({ color: 0x6ee7b7, transparent: true, opacity: 0.55 }));
    ring.rotation.x = 1.15; ring.rotation.y = 0.25; scene.add(ring);
    const bead = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 12), new THREE.MeshBasicMaterial({ color: 0xf6f5f3 }));
    ring.add(bead);

    scene.add(new THREE.AmbientLight(0xffffff, 0.25));
    const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(3, 4, 5); scene.add(key);
    const rim = new THREE.PointLight(0x10b981, 14, 12); rim.position.set(-3, -1.5, 2); scene.add(rim);

    const resize = () => {
      const w = el.clientWidth || 1, h = el.clientHeight || 1;
      renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize); ro.observe(el);

    let tx = 0, ty = 0, px = 0, py = 0;
    const fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    const pm = (e: PointerEvent) => { tx = (e.clientX / window.innerWidth - 0.5) * 0.5; ty = (e.clientY / window.innerHeight - 0.5) * 0.3; };
    if (fine) window.addEventListener('pointermove', pm, { passive: true });

    let visible = true; let raf = 0; let last = performance.now(); let t = 0; let frames = 0; const dts: number[] = []; let ready = false; let dead = false;
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible && !raf && !dead) { last = performance.now(); raf = requestAnimationFrame(loop); } });
    io.observe(el);
    function loop(now: number) {
      raf = 0;
      if (dead || !visible || document.hidden) return;
      const dt = Math.min(0.05, (now - last) / 1000); last = now; t += dt; frames++;
      if (frames > 20 && frames <= 110) dts.push(dt);
      if (frames === 110) {
        const sorted = [...dts].sort((a, b) => a - b); const med = sorted[Math.floor(sorted.length / 2)];
        if (med > 1 / 36) { dead = true; onSlow?.(); return; }
      }
      px += (tx - px) * 0.06; py += (ty - py) * 0.06;
      rig.rotation.y = Math.sin(t * 0.35) * 0.55 + px;
      rig.rotation.x = -0.12 + Math.sin(t * 0.27) * 0.08 + py;
      rig.position.y = Math.sin(t * 0.9) * 0.06;
      drop.position.y = Math.sin(t * 1.6) * 0.05;
      ring.rotation.z += dt * 0.25;
      bead.position.set(Math.cos(t * 0.9) * 1.75, Math.sin(t * 0.9) * 1.75, 0);
      renderer.render(scene, camera);
      if (!ready) { ready = true; onReady?.(); }
      raf = requestAnimationFrame(loop);
    }
    const vis = () => { if (!document.hidden && visible && !raf && !dead) { last = performance.now(); raf = requestAnimationFrame(loop); } };
    document.addEventListener('visibilitychange', vis);
    raf = requestAnimationFrame(loop);

    return () => {
      dead = true; if (raf) cancelAnimationFrame(raf);
      io.disconnect(); ro.disconnect(); document.removeEventListener('visibilitychange', vis);
      if (fine) window.removeEventListener('pointermove', pm);
      scene.traverse((o) => { const m = o as THREE.Mesh; m.geometry?.dispose?.(); const mat = m.material as THREE.Material | THREE.Material[] | undefined; if (Array.isArray(mat)) mat.forEach((x) => x.dispose()); else mat?.dispose?.(); });
      env.dispose(); pmrem.dispose(); renderer.dispose(); renderer.domElement.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <div ref={host} className="absolute inset-0" />;
}

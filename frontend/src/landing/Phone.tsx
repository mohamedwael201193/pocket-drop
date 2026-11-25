import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { Count, Tag } from './bits';
import { LogoMark } from './Logo';

const HEXC = '0123456789abcdef';
function KeyRain() {
  const [s, setS] = useState(() => Array.from({ length: 168 }, () => HEXC[(Math.random() * 16) | 0]));
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const t = setInterval(() => setS((a) => a.map((c) => (Math.random() < 0.3 ? HEXC[(Math.random() * 16) | 0] : c))), 70);
    return () => clearInterval(t);
  }, []);
  return <div className="pd-rain" aria-hidden>{s.map((c, i) => <span key={i} style={{ opacity: 0.25 + ((i * 37) % 10) / 14 }}>{c}</span>)}</div>;
}

const tick = (d: number) => ({ initial: { opacity: 0, x: -8 }, animate: { opacity: 1, x: 0 }, transition: { delay: d } });

function Chat() {
  return (
    <div className="pd-scr pd-scr--chat">
      <div className="pd-chat__head"><span className="pd-ava">M</span><b>Maya</b><small>online</small></div>
      <motion.div className="pd-bub pd-bub--in" {...tick(0.1)}>Did you get set up for the demo?</motion.div>
      <motion.div className="pd-bub pd-bub--out" {...tick(0.35)}>Not yet, I don’t have a wallet</motion.div>
      <motion.div className="pd-bub pd-bub--in pd-bub--link" {...tick(0.7)}>
        <div className="pd-linkcard"><LogoMark size={22} /><div><b>2.00 QOR for you</b><small>pocketdrop-app.vercel.app</small></div></div>
        <span>You don’t need one. Tap this.</span>
      </motion.div>
    </div>
  );
}
function Keygen() {
  return (
    <div className="pd-scr pd-scr--key">
      <p className="pd-scr__k">Making your key</p>
      <KeyRain />
      <ul className="pd-steps">
        <motion.li {...tick(0.3)}><i />ML-DSA-87 key made in this browser</motion.li>
        <motion.li {...tick(0.9)}><i />Public key sent, 2,592 bytes</motion.li>
        <motion.li {...tick(1.5)}><i />Proof of possession checked by the chain</motion.li>
      </ul>
    </div>
  );
}
function Pocket() {
  return (
    <div className="pd-scr pd-scr--pocket">
      <div className="pd-pocket__top"><LogoMark size={26} light /><span>Your Pocket</span></div>
      <p className="pd-pocket__bal"><Count to={2} format={(n) => n.toFixed(2)} /> <small>QOR</small></p>
      <div className="pd-pocket__rows">
        <motion.div {...tick(0.2)}><span>Moves with</span><b>ML-DSA-87 only</b></motion.div>
        <motion.div {...tick(0.35)}><span>Spend limit</span><b>Larger sends wait in a queue</b></motion.div>
        <motion.div {...tick(0.5)}><span>Guardians</span><b>2 of 3 can freeze</b></motion.div>
      </div>
      <motion.div className="pd-pocket__send" {...tick(0.7)}>Send it on</motion.div>
    </div>
  );
}

const SCREENS = [Chat, Keygen, Pocket];
export function Phone({ step }: { step: number }) {
  const S = SCREENS[step];
  return (
    <div className="pd-phone" data-cursor>
      <div className="pd-phone__notch" />
      <AnimatePresence mode="wait">
        <motion.div key={step} className="pd-phone__screen" initial={{ opacity: 0, y: 30, filter: 'blur(6px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} exit={{ opacity: 0, y: -30, filter: 'blur(6px)' }} transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}>
          <S />
        </motion.div>
      </AnimatePresence>
      <div className="pd-phone__tag"><Tag kind="ILLUSTRATION" /></div>
    </div>
  );
}

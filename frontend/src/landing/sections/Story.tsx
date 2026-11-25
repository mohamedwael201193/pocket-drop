import { motion, useMotionValueEvent, useScroll, useTransform } from 'framer-motion';
import { useRef, useState } from 'react';
import { Phone } from '../Phone';

const STEPS = [
  ['Put QOR in a link and paste it into any chat.', 'Your Pocket signs a drop with your ML-DSA-87 key. The secret half of the link stays after the #, so it never reaches a server.'],
  ['Their browser makes the key.', 'Nothing to install and no seed phrase. The browser generates an ML-DSA-87 key and proves to the chain that it holds it.'],
  ['The QOR lands in a Pocket.', 'A smart account that answers only to that key, with a daily limit and guardians who can freeze it. They can send it on the same way.'],
];

/** Pinned: the phone stays while three steps scroll past. */
export function Story() {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end end'] });
  const [step, setStep] = useState(0);
  useMotionValueEvent(scrollYProgress, 'change', (p) => setStep(Math.min(2, Math.floor(p * 3.0001))));
  const bar = useTransform(scrollYProgress, [0, 1], [0, 1]);
  return (
    <section ref={ref} className="pd-story" id="story">
      <div className="pd-story__pin">
        <div className="pd-wrap pd-story__grid">
          <div className="pd-story__copy">
            <h2 className="pd-h2">How a drop works</h2>
            <div className="pd-story__track">
              <motion.div className="pd-story__bar" style={{ scaleY: bar }} />
              {STEPS.map(([h, p], i) => (
                <motion.div key={h} className={`pd-story__step ${i === step ? 'is-on' : ''}`} animate={{ opacity: i === step ? 1 : 0.28 }} transition={{ duration: 0.4 }}>
                  <span className="pd-story__n">{i + 1}</span>
                  <h3>{h}</h3>
                  <motion.p initial={false} animate={{ height: i === step ? 'auto' : 0, opacity: i === step ? 1 : 0 }} transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}>{p}</motion.p>
                </motion.div>
              ))}
            </div>
          </div>
          <Phone step={step} />
        </div>
      </div>
    </section>
  );
}

import { motion, useScroll, useTransform } from 'framer-motion';
import { useRef } from 'react';
import { Btn, Rise } from '../bits';
import { Lattice } from '../Lattice';
import { SAMPLE_PATH } from '../links';

/** An inset emerald card that opens to full width as it arrives. */
export function FinalCta() {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'start start'] });
  const inset = useTransform(scrollYProgress, [0, 0.85], ['5%', '0%']);
  const radius = useTransform(scrollYProgress, [0, 0.85], [40, 0]);
  return (
    <section ref={ref} className="pd-final">
      <motion.div className="pd-final__card" style={{ marginInline: inset, borderRadius: radius }} data-dark>
        <div className="pd-final__img" aria-hidden />
        <Lattice variant="emerald" spacing={30} intensity={0.9} scrollFollow={false} />
        <div className="pd-final__in">
          <Rise as="h2" className="pd-final__h" text="Send the first link." />
          <p>A chat app and a browser are enough on the other end.</p>
          <div className="pd-final__cta">
            <Btn href="/send" kind="light" testId="final-send">Send a link</Btn>
            <Btn href={SAMPLE_PATH} kind="outline-light" testId="final-sample">Claim a sample slot</Btn>
          </div>
        </div>
      </motion.div>
    </section>
  );
}

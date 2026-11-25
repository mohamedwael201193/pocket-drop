import { Count, Go, Rise, Tag } from '../bits';
import { COUNTS, RECORDED_ON, TXS, type Tx } from '../data/recorded';
import { explorerTx as explorer } from '../links';

const MARK: Record<Tx['result'], string> = { accepted: 'accepted', reverted: 'reverted', queued: 'queued', verified: 'verified', refused: 'refused' };
function Chip({ t }: { t: Tx }) {
  const h = t.hash.replace(/^0x/, '').toLowerCase();
  return (
    <a className={`pd-chip pd-chip--${t.result}`} href={explorer(t.hash)} target="_blank" rel="noreferrer">
      <span className="pd-chip__h">{h.slice(0, 6)}…{h.slice(-4)}</span>
      <span className="pd-chip__w">{t.what}</span>
      <span className="pd-chip__r">{MARK[t.result]}</span>
    </a>
  );
}
function Row({ list, rev }: { list: Tx[]; rev?: boolean }) {
  return (
    <div className={`pd-marquee ${rev ? 'is-rev' : ''}`}>
      <div className="pd-marquee__track">{[...list, ...list].map((t, i) => <Chip key={i} t={t} />)}</div>
    </div>
  );
}

const PARTS = ['pqcVerify at 0x0A01', 'pqcKeyStatus at 0x0A02', 'hybrid MsgCrossVMCall relays', 'QoreSign', 'QoreSeal with ML-KEM-1024', 'QoreScan CBOM', 'QCAI audit', 'QoreX'];

export function Proof() {
  const a = TXS.slice(0, 7), b = TXS.slice(7);
  return (
    <section className="pd-proof" id="proof">
      <div className="pd-wrap">
        <Rise className="pd-h2" text="Every claim has a transaction you can open." />
      </div>
      <div className="pd-proof__rows" data-cursor>
        <Row list={a} />
        <Row list={b} rev />
      </div>
      <div className="pd-wrap pd-proof__body">
        <p className="pd-editorial">
          The contracts carry <Count to={COUNTS.foundry} className="pd-inl" /> Foundry tests, <Count to={COUNTS.realCrypto} className="pd-inl" /> with real ML-DSA-87 signatures and <Count to={COUNTS.livePrecompile} className="pd-inl" /> against the live precompile. One script re-checks <Count to={COUNTS.reverify} className="pd-inl" /> facts on Diana and none fail. The app and API add <Count to={COUNTS.appTests} className="pd-inl" /> more.
        </p>
        <p className="pd-proof__src"><Tag kind="RECORDED" /> Repository data files, {RECORDED_ON}. Hashes re-checked by <code>reverify.mjs</code>. <Go to="/proof" className="pd-textlink" testId="proof-link">Every requirement, mapped on the Proof page</Go></p>
        <div className="pd-parts"><span>Built on QoreChain</span>{PARTS.map((p) => <i key={p}>{p}</i>)}</div>
      </div>
    </section>
  );
}

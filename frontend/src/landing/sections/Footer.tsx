import { LogoMark } from '../Logo';
import { Go } from '../bits';
import { APP_PATH, EXPLORER, SAMPLE_PATH, SOURCE_URL } from '../links';

const COLS: [string, [string, string][]][] = [
  ['Product', [['Open the app', APP_PATH], ['Send a link', '/send'], ['Receive', '/receive'], ['Claim a sample slot', SAMPLE_PATH], ['Your Pocket', '/pocket']]],
  ['Check', [['Proof', '/proof'], ['Q-Day drill', '/qday'], ['Check a transaction', '/check'], ['For judges', '/judges'], ['Radar', '/radar']]],
  ['Source', [['Repository', SOURCE_URL], ['Explorer', EXPLORER]]],
];
export function Footer() {
  return (
    <footer className="pd-footer">
      <div className="pd-wrap pd-footer__grid">
        <div className="pd-footer__brand">
          <a href="#top" className="pd-nav__brand"><LogoMark size={30} /><span>Pocket Drop</span></a>
          <p>Send QOR by link. The receiver gets a Pocket only an ML-DSA-87 key can move.</p>
        </div>
        {COLS.map(([h, ls]) => (
          <div key={h} className="pd-footer__col"><h4>{h}</h4>{ls.map(([l, u]) => <Go key={l} to={u}>{l}</Go>)}</div>
        ))}
      </div>
      <div className="pd-wrap pd-footer__base">
        <span>Diana testnet · QOR here has no monetary value · <Go to={`${SOURCE_URL}/blob/main/docs/AUDIT.md`} testId="landing-audit">QCAI automated audit only, no human audit</Go></span>
        <span>Background images were generated for this page; every number is labelled with where it comes from.</span>
      </div>
    </footer>
  );
}

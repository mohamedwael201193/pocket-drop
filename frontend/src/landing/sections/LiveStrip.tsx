import { Count, Tag } from '../bits';
import { useLiveData } from '../live';
import { Link } from 'react-router-dom';

export function LiveStrip() {
  const l = useLiveData();
  const intact = l.baits.filter((b) => b.alarm.length === 0).length;
  const items: [number, string][] = [[l.pockets, 'Pockets created'], [l.linksClaimed, 'links claimed'], [l.slotsClaimed, 'pool slots claimed'], [l.hybridEvents, 'relays signed with both keys']];
  return (
    <section className="pd-strip" aria-label="Network numbers">
      <div className="pd-wrap">
        <div className="pd-strip__row">
          {items.map(([n, label]) => (
            <div className="pd-strip__item" key={label}><Count to={n} className="pd-num" /><span>{label}</span></div>
          ))}
          <div className="pd-strip__item pd-strip__item--q"><span className="pd-num">{intact}<small>/{l.baits.length || 5}</small></span><span>bait Pockets untouched</span></div>
        </div>
        <p className="pd-strip__note">
          <Tag kind={l.source === 'live' ? 'LIVE' : 'SNAPSHOT'} /> From the v5 and v4 contracts on Diana testnet. Most accounts are ours or test runs; <Link to="/radar">Radar lists every one</Link>.
        </p>
      </div>
    </section>
  );
}

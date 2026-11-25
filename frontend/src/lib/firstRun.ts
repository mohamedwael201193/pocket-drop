// First-run state kept in this browser only (no account data): which guide steps the visitor has seen, and whether they hid the guide.
const SEEN_QDAY = 'pd.seen.qday';
const HIDE = 'pd.starthere.hidden';
const get = (k: string) => { try { return localStorage.getItem(k) === '1'; } catch { return false; } };
const set = (k: string) => { try { localStorage.setItem(k, '1'); } catch { /* private mode */ } };
export const markDrillSeen = () => set(SEEN_QDAY);
export const drillSeen = () => get(SEEN_QDAY);
export const hideStartHere = () => set(HIDE);
export const startHereHidden = () => get(HIDE);

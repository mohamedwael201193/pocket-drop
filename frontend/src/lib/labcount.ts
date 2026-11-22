import v4 from '../data/v4.json';

/** Attacks on the v4 contracts that the chain refused (reverted when mined, or refused at broadcast), as recorded in
 *  contracts-v4/LIVE_RESULTS.md. The /lab headline and the landing card both use this, so they always agree. */
export const LAB_REFUSED = (v4.liveRows as { status: string }[]).filter((r) => r.status === 'reverted' || r.status === 'refused').length;

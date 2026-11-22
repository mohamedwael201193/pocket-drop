// The delivery fee (PocketDrop relayerFee) is set from what the relays of one link really cost on Diana (RECORDED,
// src/data/relayCosts.json built from the QA evidence), so the relayer is paid back for the relays the receiver's side
// needs: bind and claim, plus the sender's confirm in Confirmed mode. Everything else is relayed at the team's cost.
import { parseEther } from 'viem';
import costs from '../data/relayCosts.json';

export interface RelayCost { id: string; label: string; who: string; payer: string; n: number; minUqor: number; maxUqor: number; example: string; exampleCode: number; source: string }
export const RELAY_COSTS = costs.rows as RelayCost[];
export const COSTS_NOTE = costs.note;
const cost = (id: string) => { const r = RELAY_COSTS.find((x) => x.id === id); if (!r) throw new Error(`no recorded cost for ${id}`); return r.maxUqor; };

/** The relays a link needs after it is created, in this mode. */
export const deliverySteps = (mode: 'Confirmed' | 'Open') => (mode === 'Confirmed' ? ['bind', 'confirm', 'claim'] : ['bind', 'claim']);
/** Highest recorded cost of those relays, in uqor. */
export const deliveryCostUqor = (mode: 'Confirmed' | 'Open') => deliverySteps(mode).reduce((s, id) => s + cost(id), 0);
/** Margin over the highest recorded cost: fees move with gas use (a first bind writes more state than a later one). */
export const FEE_MARGIN = 1.15;
/** relayerFee in wei: recorded cost x margin, rounded up to 0.01 QOR. */
export function deliveryFeeWei(mode: 'Confirmed' | 'Open'): bigint {
  const centi = Math.ceil((deliveryCostUqor(mode) * FEE_MARGIN) / 10_000); // 1 centi-QOR = 10,000 uqor
  return parseEther('0.01') * BigInt(centi);
}

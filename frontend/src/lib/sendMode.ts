import { parseEther } from 'viem';

/** Confirmed mode is the default for every link. Above this amount an Open (first to open it) link needs an explicit
 *  acknowledgement, because anyone who sees the link before the friend does can take the money. */
export const OPEN_ACK_ABOVE_WEI = parseEther('0.5');

export type SendMode = 'Confirmed' | 'Open';

/** True when this mode and amount need the "anyone with the link can take it" acknowledgement before the link is created. */
export function openNeedsAck(mode: SendMode, amountWei: bigint | null): boolean {
  return mode === 'Open' && amountWei !== null && amountWei > OPEN_ACK_ABOVE_WEI;
}

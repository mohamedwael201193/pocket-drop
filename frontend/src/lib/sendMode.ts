import { parseEther } from 'viem';

/** Confirmed mode is the default for every link. Above this amount an Open (first to open it) link needs an explicit
 *  acknowledgement, because anyone who sees the link before the friend does can take the money. */
export const OPEN_ACK_ABOVE_WEI = parseEther('0.5');

export type SendMode = 'Confirmed' | 'Open';

/** True when this mode and amount need the "anyone with the link can take it" acknowledgement before the link is created. */
export function openNeedsAck(mode: SendMode, amountWei: bigint | null): boolean {
  return mode === 'Open' && amountWei !== null && amountWei > OPEN_ACK_ABOVE_WEI;
}

/** Right after a drop link is made, the Pocket balance drops and the same amount usually no longer fits. That is the
 *  expected result of sending, not an input error: the red "fix the amount" alert stays hidden until the amount is edited. */
export function justMadeDrop(made: { kind: string; amountInput?: string } | null, amount: string): boolean {
  return made?.kind === 'drop' && made.amountInput === amount;
}

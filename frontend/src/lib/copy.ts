/** Claim header line: the mode, plus the LIVE state. "Confirmed" mode is not "confirmed by the sender" until the chain says so. */
export function modeLine(mode: 'Confirmed' | 'Open', state: string): string {
  if (mode === 'Open') return state === 'Claimed' ? 'Giveaway · claimed' : 'Giveaway';
  const live = state === 'Open' ? 'waiting for you to open it'
    : state === 'Bound' ? 'waiting for the sender to confirm'
    : state === 'Confirmed' ? 'confirmed by the sender'
    : state === 'Claimed' ? 'claimed' : state.toLowerCase();
  return `Confirmed mode · ${live}`;
}

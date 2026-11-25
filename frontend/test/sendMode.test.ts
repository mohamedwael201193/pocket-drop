import { describe, expect, it } from 'vitest';
import { parseEther } from 'viem';
import { OPEN_ACK_ABOVE_WEI, openNeedsAck } from '../src/lib/sendMode';

describe('send mode: Confirmed by default, Open above a small amount needs an explicit OK', () => {
  it('the threshold is 0.5 QOR', () => expect(OPEN_ACK_ABOVE_WEI).toBe(parseEther('0.5')));
  it('Confirmed never needs the acknowledgement', () => {
    for (const a of ['0.01', '0.5', '5']) expect(openNeedsAck('Confirmed', parseEther(a))).toBe(false);
  });
  it('Open up to the threshold needs none; above it, it does', () => {
    expect(openNeedsAck('Open', parseEther('0.1'))).toBe(false);
    expect(openNeedsAck('Open', parseEther('0.5'))).toBe(false);
    expect(openNeedsAck('Open', parseEther('0.500001'))).toBe(true);
    expect(openNeedsAck('Open', parseEther('3'))).toBe(true);
  });
  it('an unparsable amount does not ask (the amount error shows instead)', () => expect(openNeedsAck('Open', null)).toBe(false));
});

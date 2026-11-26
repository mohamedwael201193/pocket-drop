import { describe, expect, it } from 'vitest';
import { showAmountProblem, showSpendProblem } from '../src/lib/formHints';

describe('showSpendProblem', () => {
  it('no red amount alert right after pasting an address, before any amount is typed', () => {
    expect(showSpendProblem('Enter an amount like 0.1.', false, '0x31d7972b6603e341785577f15E6E28315f7D063B', '')).toBe(false);
  });
  it('shows the amount problem once an amount is typed', () => {
    expect(showSpendProblem('Enter an amount like 0.1.', false, '0x31d7', '0')).toBe(true);
    expect(showSpendProblem('Your Pocket holds 0.1 QOR.', false, '0x31d7', '5')).toBe(true);
  });
  it('shows an address problem as soon as an address is entered', () => {
    expect(showSpendProblem('Not an address.', true, '0x12', '')).toBe(true);
    expect(showSpendProblem('Not an address.', true, '', '')).toBe(false);
  });
  it('nothing to show without a problem', () => {
    expect(showSpendProblem(null, false, '0x31d7', '0.05')).toBe(false);
  });
});

describe('showAmountProblem', () => {
  it('hides a fixable-by-typing problem while the field has focus, shows it after blur', () => {
    expect(showAmountProblem(true, true)).toBe(false);
    expect(showAmountProblem(true, false)).toBe(true);
  });
  it('shows a too-high amount at once, even while typing', () => {
    expect(showAmountProblem(false, true)).toBe(true);
  });
});

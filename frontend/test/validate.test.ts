import { describe, expect, it } from 'vitest';
import { amountFormatProblem, countProblem } from '../src/lib/validate';

describe('amount and count validation say what is wrong (B-13)', () => {
  it('names each kind of mistake', () => {
    expect(amountFormatProblem('')).toMatch(/Enter an amount/);
    expect(amountFormatProblem('-1')).toMatch(/negative/);
    expect(amountFormatProblem('abc')).toMatch(/digits only/);
    expect(amountFormatProblem('1e3')).toMatch(/plain digits/);
    expect(amountFormatProblem('0.1.2')).toMatch(/one dot/);
    expect(amountFormatProblem('0,5')).toMatch(/dot for decimals/);
    expect(amountFormatProblem('0.0000001')).toMatch(/6 decimals/);
    expect(amountFormatProblem('0.3')).toBeNull();
    expect(amountFormatProblem('5')).toBeNull();
  });
  it('counts', () => {
    expect(countProblem('', 1, 50, 'slots')).toMatch(/Enter the number of slots/);
    expect(countProblem('2.5', 1, 50, 'slots')).toMatch(/whole number/);
    expect(countProblem('0', 1, 50, 'slots')).toMatch(/1 to 50/);
    expect(countProblem('3', 1, 50, 'slots')).toBeNull();
  });
});

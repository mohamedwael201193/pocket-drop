import { describe, expect, it } from 'vitest';
import { titleFor } from '../src/lib/titles';

describe('document titles', () => {
  it('names each route', () => {
    expect(titleFor('/')).toBe('Send QOR by link, guarded by ML-DSA-87 · Pocket Drop');
    expect(titleFor('/app')).toBe('Overview · Pocket Drop');
    expect(titleFor('/check/0xabc')).toBe('Check a transaction · Pocket Drop');
    expect(titleFor('/send/inbox')).toBe('Your links · Pocket Drop');
    expect(titleFor('/qday')).toBe('Q-Day Drill · Pocket Drop');
    expect(titleFor('/proof')).toBe('Proof · Pocket Drop');
    expect(titleFor('/proof/testers')).toBe('Outside testers · Pocket Drop');
    expect(titleFor('/pool')).toBe('Drop Pool · Pocket Drop');
    expect(titleFor('/pool/p14')).toBe('Drop Pool · Pocket Drop');
    expect(titleFor('/pool/s5')).toBe('Drop Pool · Pocket Drop');
    expect(titleFor('/nope')).toBe('Page not found · Pocket Drop');
  });
});

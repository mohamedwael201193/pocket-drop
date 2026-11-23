import { describe, expect, it } from 'vitest';
import { titleFor } from '../src/lib/titles';

describe('document titles', () => {
  it('names each route', () => {
    expect(titleFor('/')).toBe('Overview · Pocket Drop');
    expect(titleFor('/about')).toBe('Quantum-safe QOR through a single link · Pocket Drop');
    expect(titleFor('/check/0xabc')).toBe('Check a transaction · Pocket Drop');
    expect(titleFor('/send/inbox')).toBe('Your links · Pocket Drop');
    expect(titleFor('/qday')).toBe('Q-Day Drill · Pocket Drop');
    expect(titleFor('/pool/p14')).toBe('Drop Pool · Pocket Drop');
    expect(titleFor('/nope')).toBe('Page not found · Pocket Drop');
  });
});

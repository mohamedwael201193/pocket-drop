import { describe, expect, it } from 'vitest';
import { parseClaimInput } from '../src/pages/ReceivePage';

describe('parseClaimInput', () => {
  const k = 'ab'.repeat(32);
  it('accepts a full link and a bare path', () => {
    expect(parseClaimInput(`https://pocket-drop.vercel.app/c/17#k=${k}`)).toBe(`/c/17#k=${k}`);
    expect(parseClaimInput(`/c/3#k=${k.toUpperCase()}`)).toBe(`/c/3#k=${k}`);
  });
  it('rejects links without a full key', () => {
    expect(parseClaimInput('https://x/c/17#k=abc')).toBeNull();
    expect(parseClaimInput('hello')).toBeNull();
  });
});

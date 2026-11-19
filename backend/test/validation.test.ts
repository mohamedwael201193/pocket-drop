import { describe, expect, it } from 'vitest';
import { bindSchema, claimSchema, formatIssues, linkIdSchema, addressSchema } from '../src/validation.js';
import { ADDR, bindBody, claimBody, hexBytes } from './helpers.js';

describe('validation', () => {
  it('accepts a well-formed bind body and normalises types', () => {
    const r = bindSchema.parse(bindBody());
    expect(r.linkId).toBe(7n);
    expect(r.recipient).toBe(ADDR);
  });
  it('rejects wrong pk length (2591 bytes)', () => {
    const r = bindSchema.safeParse(bindBody({ linkPk: hexBytes(2591) }));
    expect(r.success).toBe(false);
    if (!r.success) expect(formatIssues(r.error)[0]).toMatchObject({ path: 'linkPk' });
  });
  it('rejects wrong sig length and non-hex', () => {
    expect(bindSchema.safeParse(bindBody({ linkSig: hexBytes(4626) })).success).toBe(false);
    expect(bindSchema.safeParse(bindBody({ linkSig: '0x' + 'zz'.repeat(4627) })).success).toBe(false);
    expect(claimSchema.safeParse(claimBody({ recipientSig: hexBytes(10) })).success).toBe(false);
  });
  it('rejects a bad address checksum but accepts lowercase', () => {
    expect(addressSchema.safeParse('0x8ab5CE4fcd45cC69FEe31Ea6E9e6222C1e18bBDD').success).toBe(false);
    expect(addressSchema.safeParse(ADDR.toLowerCase()).success).toBe(true);
    expect(addressSchema.safeParse('0x123').success).toBe(false);
  });
  it('rejects unknown fields (strict) and bad bytes32', () => {
    expect(bindSchema.safeParse(bindBody({ extra: 1 })).success).toBe(false);
    expect(bindSchema.safeParse(bindBody({ recipientKeyHash: hexBytes(31) })).success).toBe(false);
  });
  it('linkId: decimal string or integer, > 0', () => {
    expect(linkIdSchema.parse('12')).toBe(12n);
    expect(linkIdSchema.parse(3)).toBe(3n);
    for (const bad of ['0', '-1', '1.5', 'abc', '', 1.5, -2, 0, '9'.repeat(78)]) expect(linkIdSchema.safeParse(bad).success, String(bad)).toBe(false);
  });
  it('claim body', () => {
    expect(claimSchema.parse(claimBody()).linkId).toBe(7n);
    expect(claimSchema.safeParse({ linkId: 1 }).success).toBe(false);
  });
});

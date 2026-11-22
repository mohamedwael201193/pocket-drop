import { describe, expect, it } from 'vitest';
import type { Hex } from 'viem';
import { checkRecipient, lookalike, type RecipientContext } from '../src/lib/recipientCheck';

const POCKET = '0x8ddCBc9c95a2C58EC5a8e72d15a8EE6F20038B71' as Hex;
const KEY = '0x339f926D2250BEA4f520513e8CDf1f2d64947D40' as Hex;
const FRIEND = '0x392f50b1955a827458A320205e19acf7C664f116' as Hex;
const TWIN = '0x392f0000000000000000000000000000c664f116' as Hex; // same first 4 and last 4 hex
const DROP = '0xbc13b9EE91f31eD56932abDb796693515C351f00';
const ctx = (o: Partial<RecipientContext> = {}): RecipientContext => ({ pocket: POCKET, keyAccount: KEY, known: [FRIEND], protocol: { [DROP.toLowerCase()]: 'PocketDrop' }, code: { isContract: false, isPocket: false }, ...o });

describe('lookalike', () => {
  it('same first and last 4 hex, different middle', () => {
    expect(lookalike(FRIEND, TWIN)).toBe(true);
    expect(lookalike(FRIEND, FRIEND.toLowerCase())).toBe(false);
    expect(lookalike(FRIEND, KEY)).toBe(false);
  });
});

describe('checkRecipient', () => {
  it('blocks a malformed address and a broken checksum', () => {
    expect(checkRecipient('0x1234', ctx()).block).toMatch(/40 hex/);
    const broken = FRIEND.replace('f50b', 'F50b'); // flips the case of one letter
    expect(checkRecipient(broken, ctx()).block).toMatch(/checksum/);
    expect(checkRecipient(FRIEND.toLowerCase(), ctx()).block).toBeNull(); // all lower case carries no checksum: accepted
  });
  it('blocks the Pocket itself and Pocket Drop contracts', () => {
    expect(checkRecipient(POCKET.toLowerCase(), ctx()).block).toMatch(/your Pocket itself/);
    expect(checkRecipient(DROP.toLowerCase(), ctx()).block).toMatch(/PocketDrop contract/);
  });
  it('asks to confirm a lookalike of a known address', () => {
    const r = checkRecipient(TWIN, ctx());
    expect(r.block).toBeNull();
    expect(r.confirm).toMatch(/starts and ends like 0x392f50b1955a827458A320205e19acf7C664f116/);
  });
  it('asks to confirm a non-Pocket contract, informs for a Pocket, the own key account and a known address', () => {
    expect(checkRecipient(FRIEND, ctx({ known: [], code: { isContract: true, isPocket: false } })).confirm).toMatch(/is a contract/);
    expect(checkRecipient(FRIEND, ctx({ known: [], code: { isContract: true, isPocket: true } })).info.join(' ')).toMatch(/another Pocket/);
    expect(checkRecipient(KEY, ctx()).info.join(' ')).toMatch(/your own key account/);
    const r = checkRecipient(FRIEND, ctx());
    expect(r.confirm).toBeNull();
    expect(r.info.join(' ')).toMatch(/used this address before/);
  });
});

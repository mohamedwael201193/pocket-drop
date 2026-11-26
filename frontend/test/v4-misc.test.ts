import { describe, expect, it } from 'vitest';
import { parseLinkId, linkId4, claimUrl4 } from '../src/lib/claim4';
import { parseClaimInput } from '../src/pages/ReceivePage';
import { modeLine } from '../src/lib/copy';
import { decodeCode, encodeCode } from '../src/lib/actions';
import { toEvmAddress } from '../src/components/rescue';
import { defaultCfg, ZERO_SALT } from '../src/lib/v4';

describe('link ids: v3 numbers keep working, v4 and v5 carry the instance', () => {
  it('parses', () => {
    expect(parseLinkId('17')).toEqual({ v: 3, id: '17' });
    // links shared before v5 keep resolving to the v4 contracts
    expect(parseLinkId('p12')).toEqual({ v: 4, env: 'prodV4', id: 12n });
    expect(parseLinkId('l3')).toEqual({ v: 4, env: 'labV4', id: 3n });
    // links shared before v5.1 keep resolving to the v5 contracts
    expect(parseLinkId('q12')).toEqual({ v: 4, env: 'prodV5', id: 12n });
    expect(parseLinkId('k3')).toEqual({ v: 4, env: 'labV5', id: 3n });
    // v5.1 (current) links
    expect(parseLinkId('r12')).toEqual({ v: 4, env: 'prod', id: 12n });
    expect(parseLinkId('m3')).toEqual({ v: 4, env: 'lab', id: 3n });
    expect(parseLinkId('r0')).toBeNull();
    expect(parseLinkId('p0')).toBeNull();
    expect(parseLinkId('q0')).toBeNull();
    expect(parseLinkId('x1')).toBeNull();
    expect(linkId4('prod', 5n)).toBe('r5');
    expect(linkId4('lab', 5n)).toBe('m5');
    expect(linkId4('prodV5', 5n)).toBe('q5');
    expect(linkId4('labV5', 5n)).toBe('k5');
    expect(linkId4('prodV4', 5n)).toBe('p5');
    expect(linkId4('labV4', 5n)).toBe('l5');
  });
  it('builds and re-parses claim URLs', () => {
    const seed = new Uint8Array(32).fill(7);
    const u = claimUrl4('https://app.test', 'lab', 4n, seed, 'pool');
    expect(u).toBe(`https://app.test/pool/m4#k=${'07'.repeat(32)}`);
    expect(parseClaimInput(u)).toBe(`/pool/m4#k=${'07'.repeat(32)}`);
    const old = claimUrl4('https://app.test', 'labV4', 4n, seed, 'pool');
    expect(old).toBe(`https://app.test/pool/l4#k=${'07'.repeat(32)}`);
    expect(parseClaimInput(old)).toBe(`/pool/l4#k=${'07'.repeat(32)}`);
  });
  it('the receive box accepts v3, v4 drop and v4 pool links, and rejects a pool without an instance', () => {
    const k = 'ab'.repeat(32);
    expect(parseClaimInput(`https://x/c/17#k=${k}`)).toBe(`/c/17#k=${k}`);
    expect(parseClaimInput(`/c/p9#k=${k}`)).toBe(`/c/p9#k=${k}`);
    expect(parseClaimInput(`/pool/9#k=${k}`)).toBeNull();
  });
});

describe('claim header copy', () => {
  it('says "Confirmed mode" plus the live state, never "confirmed by the sender" while waiting', () => {
    expect(modeLine('Confirmed', 'Bound')).toBe('Confirmed mode · waiting for the sender to confirm');
    expect(modeLine('Confirmed', 'Open')).toContain('Confirmed mode');
    expect(modeLine('Confirmed', 'Confirmed')).toBe('Confirmed mode · confirmed by the sender');
    expect(modeLine('Confirmed', 'Bound')).not.toMatch(/confirmed by the sender/);
    expect(modeLine('Open', 'Bound')).toBe('Giveaway');
  });
});

describe('guardian codes and addresses', () => {
  it('round-trips a request code', () => {
    const r = { v: 1, kind: 'freeze', env: 'lab', pocket: '0x' + '11'.repeat(20), nonce: '0', deadline: '1900000000' };
    expect(decodeCode('pdreq1', `here: ${encodeCode('pdreq1', r)} thanks`)).toEqual(r);
    expect(() => decodeCode('pdreq1', 'nothing')).toThrow();
  });
  it('reads 0x and qor1 addresses', () => {
    const a = '0x8ab5CE4fcd45cC69FEe31Ea6E9e6222C1e18bBDd';
    expect(toEvmAddress(a)).toBe(a);
    expect(toEvmAddress('qor1x')).toBeNull();
    expect(toEvmAddress('nope')).toBeNull();
  });
  it('a default Pocket has no guardians, a zero salt and a 5 QOR limit', () => {
    const c = defaultCfg('0x8ab5CE4fcd45cC69FEe31Ea6E9e6222C1e18bBDd');
    expect(c.guardians).toEqual([]); expect(c.threshold).toBe(0); expect(c.userSalt).toBe(ZERO_SALT); expect(c.limit).toBe(5n * 10n ** 18n);
  });
});

describe('receive box explains a bad paste in plain words (UX-7)', () => {
  it('names what is wrong', async () => {
    const { claimInputProblem } = await import('../src/pages/ReceivePage');
    expect(claimInputProblem('')).toMatch(/Paste the link/);
    expect(claimInputProblem('hello')).toMatch(/not a Pocket Drop link/);
    expect(claimInputProblem('https://x/c/p3')).toMatch(/cut short/);
    expect(claimInputProblem('https://x/c/p3#k=abc')).toMatch(/damaged/);
  });
});

describe('network failures are told apart from chain errors (B-08)', () => {
  it('matches browser fetch failures only', async () => {
    const { isNetworkFailure } = await import('../src/lib/chain');
    expect(isNetworkFailure(new TypeError('Fetch API cannot load https://evm-testnet.qore.host/ due to access control checks.'))).toBe(true);
    expect(isNetworkFailure(new TypeError('Failed to fetch'))).toBe(true);
    expect(isNetworkFailure(new TypeError('Load failed'))).toBe(true);
    expect(isNetworkFailure(new Error('execution reverted: NotOwner()'))).toBe(false);
  });
});

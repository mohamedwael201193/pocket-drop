import { describe, expect, it } from 'vitest';
import { unifiedAccountFromSeed } from '@qorechain/sdk';
import { mldsa } from '@qorechain/pqc';
import { bindMessage, claimMessage, fingerprint, buildClaimUrl, parseClaimFragment, whatsappUrl, shareMessage, hexToBytes, bytesToHex, keyHashOf } from '../src/lib/protocol';
import { cosmosAddressOf, parseQor, fmtQor } from '../src/lib/chain';

const C = '0x29f53b4b8031e7ba1785dc8c7a1c0be413a4bd97' as const;
const R = '0xbeCce1e181BD39C0E2aD32E82D71DF04b7a701AE' as const;

describe('message encoding', () => {
  it('bind message layout is abi.encode(string,uint256,address,uint256,address,bytes32)', () => {
    const rkh = ('0x' + '11'.repeat(32)) as `0x${string}`;
    const m = bindMessage(C, 7n, R, rkh);
    expect(m.startsWith('0x')).toBe(true);
    expect((m.length - 2) / 2 % 32).toBe(0);
    // chain id 9800 = 0x2648 sits in word 2 (after the string offset word)
    expect(m.slice(2 + 64, 2 + 128)).toBe((9800).toString(16).padStart(64, '0'));
    expect(m.toLowerCase()).toContain(C.slice(2));
    expect(m.toLowerCase()).toContain(R.slice(2).toLowerCase());
  });
  it('claim message differs from bind and binds the link id', () => {
    expect(claimMessage(C, 1n, R)).not.toBe(claimMessage(C, 2n, R));
    expect(claimMessage(C, 1n, R)).not.toBe(claimMessage('0xce1912ed9d310f1973a88e7ff6aa56f6d76c9a67', 1n, R));
  });
});

describe('fingerprint', () => {
  it('is 4 words, deterministic, and sensitive to the first 44 bits', () => {
    const h = ('0x' + 'ab'.repeat(32)) as `0x${string}`;
    const w = fingerprint(h);
    expect(w).toHaveLength(4);
    expect(fingerprint(h)).toEqual(w);
    const h2 = ('0x' + 'ab'.repeat(5) + '1b' + 'ab'.repeat(26)) as `0x${string}`;
    expect(fingerprint(h2)).not.toEqual(w);
    expect(() => fingerprint('0x1234')).toThrow();
  });
});

describe('link url + whatsapp', () => {
  const seed = Uint8Array.from({ length: 32 }, (_, i) => (i * 7 + 3) & 255);
  const link = buildClaimUrl('https://pocket-drop.vercel.app', 12n, seed);
  it('carries the seed only in the #fragment and parses back', () => {
    const u = new URL(link);
    expect(u.pathname).toBe('/c/12');
    expect(u.search).toBe('');
    expect(u.hash).toMatch(/^#k=[0-9a-f]{64}$/);
    expect(parseClaimFragment(u.hash)).toEqual(seed);
    expect(parseClaimFragment('#k=zz')).toBeNull();
  });
  it('wa.me url encodes the full link and the fragment round-trips', () => {
    const wa = whatsappUrl(shareMessage('0.3'), link);
    expect(wa.startsWith('https://wa.me/?text=')).toBe(true);
    const text = decodeURIComponent(wa.slice('https://wa.me/?text='.length));
    expect(text.endsWith(link)).toBe(true);
    expect(wa).toContain(encodeURIComponent('#k='));
    expect(wa).not.toContain('#');
    expect(new URL(new URLSearchParams(wa.split('?')[1]).get('text')!.split(' ').pop()!).hash).toBe(new URL(link).hash);
  });
});

describe('account helpers', () => {
  it('cosmosAddressOf equals the SDK derivation', async () => {
    const seed = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
    const a = await unifiedAccountFromSeed(seed, { pqcSecret: Uint8Array.from({ length: 32 }, (_, i) => 100 + i) });
    expect(cosmosAddressOf(a.evm)).toBe(a.cosmos);
  });
  it('QOR amount parsing', () => {
    expect(parseQor('0.3')).toBe(300000000000000000n);
    expect(parseQor('abc')).toBeNull();
    expect(parseQor('1.1234567')).toBeNull();
    expect(fmtQor(300000000000000000n)).toBe('0.3');
    expect(fmtQor(2000000000000000000n)).toBe('2');
  });
  it('ML-DSA-87 sign/verify round trip over the bind message from a seed', () => {
    const seed = Uint8Array.from({ length: 32 }, (_, i) => 255 - i);
    const k1 = mldsa.keygen(seed); const k2 = mldsa.keygen(seed);
    expect(bytesToHex(k1.publicKey)).toBe(bytesToHex(k2.publicKey)); // link key is reproducible from the seed in the fragment
    expect(keyHashOf(k1.publicKey)).toMatch(/^0x[0-9a-f]{64}$/);
    const msg = hexToBytes(bindMessage(C, 1n, R, keyHashOf(k1.publicKey)));
    expect(mldsa.verify(k1.publicKey, msg, mldsa.sign(k1.secretKey, msg))).toBe(true);
  });
});

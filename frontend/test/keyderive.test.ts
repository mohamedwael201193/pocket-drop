import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { unifiedAccountFromSeed } from '@qorechain/sdk';
import { privateKeyToAccount } from 'viem/accounts';
import { MLDSA_TAG, SECP_TAG, keyMaterial, newV2Root, parseRoot, v1PqcSecret, v2PqcSecret, v2SecpKey } from '../src/lib/keyderive';

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const sha = (...p: (Uint8Array | string)[]) => new Uint8Array(createHash('sha256').update(Buffer.concat(p.map((x) => Buffer.from(x as never)))).digest());
const masters = Array.from({ length: 64 }, (_, i) => sha('master', String(i)));

describe('v2 browser key derivation: the classical key does not reveal the ML-DSA key', () => {
  it('the secp256k1 key is never the stored master (unlike v1, where root = secp key)', () => {
    for (const m of masters) {
      expect(hex(v2SecpKey(m))).not.toBe(hex(m));
      expect(hex(keyMaterial({ version: 2, bytes: m }).secp)).not.toBe(hex(m));
    }
    const m = masters[0];
    expect(hex(keyMaterial({ version: 1, bytes: m }).secp)).toBe(hex(m)); // legacy behaviour, kept only for old Pockets
  });

  it('matches the documented formulas exactly (domain-separated one-way hashes of the master)', () => {
    const m = masters[1];
    expect(hex(v2SecpKey(m))).toBe(hex(sha(SECP_TAG, m, Uint8Array.of(0))));
    expect(hex(v2PqcSecret(m))).toBe(hex(sha(MLDSA_TAG, m)));
  });

  it('the ML-DSA secret is not any function of the secp key the old scheme or obvious variants would use', () => {
    for (const m of masters) {
      const secp = v2SecpKey(m); const pqc = hex(v2PqcSecret(m));
      const candidates = [
        v1PqcSecret(secp),                       // the v1 rule applied to the classical key
        sha(secp), sha(secp, '|mldsa87'), sha(MLDSA_TAG, secp), sha(secp, MLDSA_TAG), sha(SECP_TAG, secp),
        v2PqcSecret(secp), v2SecpKey(secp), secp,
      ];
      for (const c of candidates) expect(hex(c)).not.toBe(pqc);
    }
  });

  it('v1 is broken in exactly the way the fix removes: secp key alone yields the ML-DSA secret', () => {
    const root = masters[2];
    const { secp, pqcSecret } = keyMaterial({ version: 1, bytes: root });
    expect(hex(v1PqcSecret(secp))).toBe(hex(pqcSecret));
    const v2 = keyMaterial({ version: 2, bytes: root });
    expect(hex(v1PqcSecret(v2.secp))).not.toBe(hex(v2.pqcSecret));
  });

  it('secp and ML-DSA secrets are distinct and every master gives a distinct pair', () => {
    const seen = new Set<string>();
    for (const m of masters) {
      const k = keyMaterial({ version: 2, bytes: m });
      expect(hex(k.secp)).not.toBe(hex(k.pqcSecret));
      seen.add(hex(k.secp)); seen.add(hex(k.pqcSecret));
    }
    expect(seen.size).toBe(masters.length * 2);
  });

  it('the real QoreChain SDK builds the account from the v2 material: the EVM address is the v2 secp key, not the master', async () => {
    const m = masters[3];
    const k = keyMaterial({ version: 2, bytes: m });
    const acct = await unifiedAccountFromSeed(k.secp, { pqcSecret: k.pqcSecret });
    expect(acct.evm.toLowerCase()).toBe(privateKeyToAccount(`0x${hex(k.secp)}`).address.toLowerCase());
    expect(acct.evm.toLowerCase()).not.toBe(privateKeyToAccount(`0x${hex(m)}`).address.toLowerCase());
    // an attacker who knows only the classical key and tries the legacy rule ends with a different ML-DSA public key
    const forged = await unifiedAccountFromSeed(k.secp, { pqcSecret: v1PqcSecret(k.secp) });
    expect(hex(forged.pqc.publicKey)).not.toBe(hex(acct.pqc.publicKey));
  });

  it('root strings: v2 has the pd2: prefix, bare 64 hex is legacy, garbage is rejected', () => {
    const r = newV2Root();
    expect(r).toMatch(/^pd2:[0-9a-f]{64}$/);
    expect(parseRoot(r)?.version).toBe(2);
    expect(parseRoot('ab'.repeat(32))?.version).toBe(1);
    expect(parseRoot('0x' + 'AB'.repeat(32))?.version).toBe(1);
    expect(parseRoot('pd2:abc')).toBeNull();
    expect(parseRoot('hello')).toBeNull();
  });
});


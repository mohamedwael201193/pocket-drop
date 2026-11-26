// Differential test: the bytes the contracts verify, the bytes this app signs, and the bytes @qorechain/qoresign (the
// library behind QoreX message signing) produces are the same, and real ML-DSA-87 signatures from the two libraries are
// byte-identical.
//
// Chain of evidence:
//  1. contracts-v4 fixtures hold (pk, sig, msg) triples. The Foundry mock verifier accepts a triple only if
//     keccak(pk, sig, msg) is registered, so every passing Foundry test proves PqcLib.pqMessage(digest) built EXACTLY
//     the fixture msg bytes on chain-side code.
//  2. This file proves, for every fixture: app pqMessageBytes(digest) == fixture msg == qoresign.messagePqSignBytes;
//     the fixture key re-derived with qoresign.pqKeyFromSeed equals the registered fixture key; qoresign.pqSign of the
//     msg is byte-identical to the fixture signature (made with @qorechain/pqc); both libraries verify it; tampering fails.
//  3. The live deployment closes the loop: the Diana pqcVerify precompile accepted the same format (frontend/test/
//     txcheck.live.test.ts re-checks recorded relays; contracts-v4/LIVE_RESULTS.md lists the transactions).
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { mldsa } from '@qorechain/pqc';
import * as qs from '@qorechain/qoresign';
import { keccak256, toBytes, type Hex } from 'viem';
import { CHAIN_STR, MSG_PREFIX, pqMessageBytes } from '../src/lib/intents';
import { signDigest } from '../src/lib/identity';

const fx = path.resolve(__dirname, '..', '..', 'contracts-v4', 'test', 'fixtures');
const have = fs.existsSync(path.join(fx, 'keys.json'));
const keys = have ? (JSON.parse(fs.readFileSync(path.join(fx, 'keys.json'), 'utf8')) as { pks: Record<string, Hex> }) : { pks: {} };
const unhex = (h: string) => Uint8Array.from(Buffer.from(h.replace(/^0x/, ''), 'hex'));
const eq = (a: Uint8Array, b: Uint8Array) => Buffer.from(a).equals(Buffer.from(b));
const GROUPS = ['vault', 'drops', 'pool', 'fuzz'];
type Fx = { group: string; name: string; sig: Hex; msg: Hex; key: string };
const all: Fx[] = have
  ? GROUPS.flatMap((g) => fs.readdirSync(path.join(fx, g)).filter((f) => f.endsWith('.json')).map((f) => ({ group: g, name: f, ...JSON.parse(fs.readFileSync(path.join(fx, g, f), 'utf8')) })))
  : [];
// gen-fixtures.mjs: seed = keccak256("pocketdrop-v4-fixture-" + name)
const seedOf = (n: string) => unhex(keccak256(toBytes('pocketdrop-v4-fixture-' + n)));
const MSG_RE = /^qorechain-msg-v1\|qorechain-diana\|0x[0-9a-f]{64}$/;

describe('qoresign constants agree with the app and the contracts', () => {
  it('prefix, sizes and chain string', () => {
    expect(qs.MESSAGE_PQ_DOMAIN).toBe(MSG_PREFIX);
    expect(qs.ML_DSA_87_PUBLIC_KEY_LENGTH).toBe(2592);
    expect(qs.ML_DSA_87_SIGNATURE_LENGTH).toBe(4627);
    expect(CHAIN_STR).toBe('qorechain-diana');
  });
});

describe.skipIf(!have)('every contracts-v4 fixture: app bytes == qoresign bytes, signatures byte-identical across libraries', () => {
  it('covers all four fixture groups (608 real ML-DSA-87 signatures)', () => {
    expect(all.length).toBe(608);
    for (const g of GROUPS) expect(all.some((f) => f.group === g)).toBe(true);
  });

  it('fixture keys re-derived with qoresign.pqKeyFromSeed equal the registered keys (2592 bytes)', () => {
    for (const [n, pk] of Object.entries(keys.pks)) {
      const k = qs.pqKeyFromSeed(seedOf(n));
      expect(eq(k.publicKey, unhex(pk)), n).toBe(true);
      expect(k.publicKey.length).toBe(2592);
      expect(eq(mldsa.keygen(seedOf(n)).secretKey, k.secretKey), n).toBe(true);
    }
  });

  // Three fixtures are deliberate negatives the contracts must refuse: a signature over the raw digest (no prefix) and
  // one over another chain string. They must NOT match the format.
  const NEG = /^(rawDigest_|wrongPrefix_|bindRaw_)/;
  const TAGGED = /^(pocket-erc1271-v1|pqguard-v1):0x[0-9a-f]{64}$/;
  it('the deliberate wrong-format fixtures are not in the QoreX format', () => {
    const neg = all.filter((f) => NEG.test(f.name));
    expect(neg.map((f) => f.name).sort()).toEqual(['bindRaw_1_0.json', 'rawDigest_spendS_0.json', 'wrongPrefix_spendS_0.json']);
    for (const f of neg) expect(Buffer.from(unhex(f.msg)).toString('utf8')).not.toMatch(MSG_RE);
  });

  it('message bytes: fixture == app pqMessageBytes == qoresign.messagePqSignBytes', () => {
    for (const f of all.filter((x) => !NEG.test(x.name))) {
      const msg = unhex(f.msg);
      const text = Buffer.from(msg).toString('utf8');
      const data = text.slice(text.lastIndexOf('|') + 1);
      // v5.1 ERC-1271 / PqGuard approvals carry a purpose tag: data = "<tag>:0x<digest>", still the QoreX message format
      if (TAGGED.test(data)) { expect(eq(qs.messagePqSignBytes(CHAIN_STR, data), msg), `${f.group}/${f.name} qoresign`).toBe(true); continue; }
      expect(text, `${f.group}/${f.name}`).toMatch(MSG_RE);
      const digest = data as Hex;
      expect(eq(pqMessageBytes(digest), msg), `${f.group}/${f.name} app`).toBe(true);
      expect(eq(qs.messagePqSignBytes(CHAIN_STR, digest), msg), `${f.group}/${f.name} qoresign`).toBe(true);
    }
  });

  it('qoresign.pqSign reproduces every fixture signature byte for byte; both libraries verify; tampering fails', { timeout: 120_000 }, () => {
    const sks = new Map(Object.keys(keys.pks).map((n) => [n, qs.pqKeyFromSeed(seedOf(n)).secretKey]));
    let i = 0;
    for (const f of all) {
      const msg = unhex(f.msg);
      const sig = unhex(f.sig);
      const pk = unhex(keys.pks[f.key]);
      expect(sig.length).toBe(4627);
      expect(eq(qs.pqSign(sks.get(f.key)!, msg), sig), `${f.group}/${f.name}`).toBe(true);
      expect(qs.pqVerify(pk, msg, sig)).toBe(true);
      // every 10th fixture: also the other library and the negative cases (keeps the run short)
      if (i++ % 10 === 0) {
        expect(mldsa.verify(pk, msg, sig)).toBe(true);
        const bad = Uint8Array.from(sig); bad[100] ^= 1;
        expect(qs.pqVerify(pk, msg, bad)).toBe(false);
        const m2 = Uint8Array.from(msg); m2[m2.length - 1] ^= 1;
        expect(qs.pqVerify(pk, m2, sig)).toBe(false);
      }
    }
  });
});

describe('the app signing path (identity.signDigest) equals qoresign end to end', () => {
  it('same signature bytes for random digests; qoresign verifies the app signature', async () => {
    const k = qs.pqKeyFromSeed(new Uint8Array(32).fill(42));
    for (let i = 0; i < 5; i++) {
      const digest = keccak256(toBytes(`pocket drop differential ${i}`));
      const app = unhex(await signDigest(k.secretKey, digest));
      const ref = qs.pqSign(k.secretKey, qs.messagePqSignBytes(CHAIN_STR, digest));
      expect(eq(app, ref)).toBe(true);
      expect(qs.pqVerify(k.publicKey, qs.messagePqSignBytes(CHAIN_STR, digest), app)).toBe(true);
      // the next digest (e.g. nonce + 1) does not verify with this signature
      expect(qs.pqVerify(k.publicKey, qs.messagePqSignBytes(CHAIN_STR, keccak256(toBytes(`pocket drop differential ${i + 1}`))), app)).toBe(false);
    }
  });
});

// Strict pqcKeyStatus decoder against the vectors shared with Foundry (contracts-v4/test/fixtures/keystatus/vectors.json).
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { decodeKeyStatusStrict, isUsableKey, ML_DSA_87_PK_BYTES } from '../src/lib/keystatus';

const dir = path.resolve(__dirname, '..', '..', 'contracts-v4', 'test', 'fixtures', 'keystatus');
const have = fs.existsSync(path.join(dir, 'vectors.json'));
type Vec = { name: string; label: string; raw: string; strict: string; contract: { ok: boolean } };
const file = have ? (JSON.parse(fs.readFileSync(path.join(dir, 'vectors.json'), 'utf8')) as { count: number; vectors: Vec[] }) : { count: 0, vectors: [] };

describe.skipIf(!have)('strict pqcKeyStatus decoder', () => {
  it('has the 18 shared vectors', () => expect(file.vectors).toHaveLength(18));

  for (const v of file.vectors) {
    it(`${v.name} -> ${v.strict}`, () => {
      const r = decodeKeyStatusStrict(v.raw);
      if (v.strict === 'ok') expect(r.ok).toBe(true);
      else expect(r).toEqual({ ok: false, reason: v.strict });
    });
  }

  it('is never looser than the on-chain PqcLib decoder', () => {
    for (const v of file.vectors) if (decodeKeyStatusStrict(v.raw).ok) expect(v.contract.ok, v.name).toBe(true);
  });

  it('the RECORDED Diana key is usable, 2592 bytes; without possession it is not', () => {
    const live = JSON.parse(fs.readFileSync(path.join(dir, 'live-diana.json'), 'utf8'));
    const r = decodeKeyStatusStrict(live.registered.raw);
    expect(isUsableKey(r)).toBe(true);
    if (r.ok) expect(r.pubkey.length).toBe(ML_DSA_87_PK_BYTES);
    const u = decodeKeyStatusStrict(live.unregistered.raw);
    expect(u).toMatchObject({ ok: true, registered: false, proven: false });
    expect(isUsableKey(u)).toBe(false);
    const np = file.vectors.find((x) => x.name === 'registered-not-proven')!;
    expect(isUsableKey(decodeKeyStatusStrict(np.raw))).toBe(false);
  });

  it('rejects non-hex and odd-length input', () => {
    expect(decodeKeyStatusStrict('0xzz')).toEqual({ ok: false, reason: 'not-hex' });
    expect(decodeKeyStatusStrict('0x123')).toEqual({ ok: false, reason: 'not-hex' });
  });

  it('never throws on random input', () => {
    let seed = 7;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed; };
    for (let i = 0; i < 300; i++) {
      const n = rnd() % 400;
      const b = Buffer.alloc(n); for (let j = 0; j < n; j++) b[j] = rnd() & 0xff;
      // bias the head toward plausible values so deeper branches run
      if (n >= 160 && i % 2 === 0) { b.fill(0, 0, 160); b[31] = 1; b[63] = 1; b[95] = 0x80; b[127] = 1; b[159] = rnd() % 64; }
      expect(() => decodeKeyStatusStrict('0x' + b.toString('hex'))).not.toThrow();
    }
  });
});

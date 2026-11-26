// v4 intents against fixtures from contracts-v4 (signature-real ML-DSA-87 triples made by gen-fixtures.mjs): the message this app
// builds from its digest must equal the fixture message, and the fixture signature must verify over exactly those bytes.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { mldsa } from '@qorechain/pqc';
import { keccak256, toBytes, toHex, type Hex } from 'viem';
import { ACT, freezeDigest, intentDigest, params, pqMessageBytes, pqMessageHex, pqMessageText, recoveryDigest } from '../src/lib/intents';

const root = path.resolve(__dirname, '..', '..', 'contracts-v4');
const fx = path.join(root, 'test', 'fixtures');
const have = fs.existsSync(path.join(fx, 'keys.json'));
const lib = have ? await import(pathToFileURL(path.join(root, 'script', 'fixtures-lib.mjs')).href) : null;
const keys = have ? JSON.parse(fs.readFileSync(path.join(fx, 'keys.json'), 'utf8')) : null;
const fixture = (group: string, name: string) => JSON.parse(fs.readFileSync(path.join(fx, group, `${name}.json`), 'utf8')) as { sig: Hex; h: Hex; key: string; msg: Hex };
const pk = (n: string) => Uint8Array.from(Buffer.from(keys.pks[n].slice(2), 'hex'));
const khash = (n: string) => keccak256(keys.pks[n]);
const sigOk = (f: { sig: Hex; key: string }, digest: Hex) => mldsa.verify(pk(f.key), pqMessageBytes(digest), Uint8Array.from(Buffer.from(f.sig.slice(2), 'hex')));

describe('pqMessage', () => {
  it('is "qorechain-msg-v1|qorechain-diana|0x" + lowercase hex(digest)', () => {
    const d = ('0x' + 'AB'.repeat(32)) as Hex;
    expect(pqMessageText(d)).toBe(`qorechain-msg-v1|qorechain-diana|0x${'ab'.repeat(32)}`);
    expect(pqMessageHex(d)).toBe(toHex(toBytes(`qorechain-msg-v1|qorechain-diana|0x${'ab'.repeat(32)}`)));
  });
  it('action tags are keccak256 of the contract constant names', () => {
    expect(ACT.SPEND).toBe(keccak256(toBytes('POCKET_SPEND_V1')));
    expect(ACT.GUARDIAN_FREEZE).toBe(keccak256(toBytes('POCKET_GUARDIAN_FREEZE_V1')));
    expect(ACT.FINALIZE_RECOVERY).toBe(keccak256(toBytes('POCKET_FINALIZE_RECOVERY_V1')));
    expect(ACT.FINALIZE_RECOVERY_UNANIMOUS).toBe(keccak256(toBytes('POCKET_FINALIZE_RECOVERY_UNANIMOUS_V1')));
    expect(new Set(Object.values(ACT)).size).toBe(16);
  });
});

describe.skipIf(!have)('v4 intents equal the contracts-v4 fixtures', () => {
  const PA = () => lib.POCKETS.PA as Hex;
  const ETH = 10n ** 18n;
  const intent = (action: Hex, nonce: number, p: Hex) => intentDigest({ action, vault: PA(), nonce: BigInt(nonce), deadline: BigInt(lib.DL), params: p });

  it('spend, veto, setLimit, cancelPending', () => {
    for (let n = 0; n < 5; n++) {
      const cases: [string, Hex][] = [
        [`spendS_${n}`, intent(ACT.SPEND, n, params.spend(lib.ADDR.SINK, (8n * ETH) / 10n))],
        [`spendB_${n}`, intent(ACT.SPEND, n, params.spend(lib.ADDR.SINK, 5n * ETH))],
        [`vetoQ1_${n}`, intent(ACT.VETO_QUEUED, n, params.id(1n))],
        [`limLow_${n}`, intent(ACT.SET_LIMIT, n, params.limit(ETH))],
        [`limHigh_${n}`, intent(ACT.SET_LIMIT, n, params.limit(9n * ETH))],
        [`cancelPending_${n}`, intent(ACT.CANCEL_PENDING, n, params.none())],
      ];
      for (const [name, d] of cases) {
        const f = fixture('vault', name);
        expect(f.msg, name).toBe(pqMessageHex(d));
        expect(sigOk(f, d), `${name} signature verifies over our message`).toBe(true);
      }
    }
  });
  it('guardian freeze (digest + signature of guardians G0..G2)', () => {
    for (let n = 0; n < 5; n++) for (const g of ['G0', 'G1', 'G2']) {
      const f = fixture('vault', `frz_${g}_${n}`);
      const d = freezeDigest({ vault: PA(), nonce: BigInt(n), deadline: BigInt(lib.DL) });
      expect(f.msg).toBe(pqMessageHex(d));
      expect(sigOk(f, d)).toBe(true);
    }
  });
  it('threshold recovery and unanimous recovery (new owner OB)', () => {
    for (let n = 0; n < 2; n++) for (const g of ["G0", "G1", "G2"]) {
      const base = { vault: PA(), recNonce: BigInt(n), newOwner: keys.addrs.OB as Hex, newKeyHash: khash('OB'), deadline: BigInt(lib.DL) };
      const r = fixture('vault', `rec_${g}_${n}`); const u = fixture('vault', `unan_${g}_${n}`);
      expect(r.msg).toBe(pqMessageHex(recoveryDigest(base))); expect(sigOk(r, recoveryDigest(base))).toBe(true);
      expect(u.msg).toBe(pqMessageHex(recoveryDigest({ ...base, unanimous: true }))); expect(sigOk(u, recoveryDigest({ ...base, unanimous: true }))).toBe(true);
      expect(r.msg).not.toBe(u.msg);
    }
  });
});

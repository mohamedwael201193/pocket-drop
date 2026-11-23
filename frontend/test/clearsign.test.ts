// Clear signing: readable lines come from the same fields as the signed digest, and match the contracts-v4 fixtures.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseEther, type Hex } from 'viem';
import { describeIntent } from '../src/lib/clearsign';
import { ACT, intentDigest, params, pqMessageText } from '../src/lib/intents';

const root = path.resolve(__dirname, '..', '..', 'contracts-v4');
const fx = path.join(root, 'test', 'fixtures');
const have = fs.existsSync(path.join(fx, 'keys.json'));
const lib = have ? await import(pathToFileURL(path.join(root, 'script', 'fixtures-lib.mjs')).href) : null;
const V = '0x00000000000000000000000000000000000a0a01' as Hex;
const TO = '0x0000000000000000000000000000000000005151' as Hex;

describe('describeIntent', () => {
  it('spend: recipient, amount, contract, chain, nonce, deadline; digest equals intentDigest', () => {
    const p = params.spend(TO, parseEther('0.8'));
    const c = describeIntent({ action: ACT.SPEND, vault: V, nonce: 3n, deadline: 1_900_000_000n, params: p });
    const m = Object.fromEntries(c.lines.map((l) => [l.k, l.v]));
    expect(c.title).toBe('Send QOR from your Pocket');
    expect(m.Recipient).toBe(TO);
    expect(m.Amount).toBe('0.8 QOR (800000000000000000 wei)');
    expect(m['Pocket (contract)']).toBe(V);
    expect(m.Chain).toContain('9800');
    expect(m['Intent number (nonce)']).toBe('3');
    expect(m['Valid until']).toBe('2030-03-17T17:46:40Z (unix 1900000000)');
    expect(c.digest).toBe(intentDigest({ action: ACT.SPEND, vault: V, nonce: 3n, deadline: 1_900_000_000n, params: p }));
    expect(c.signedText).toBe(pqMessageText(c.digest));
  });

  it('createDrop separates link amount, starter gas and delivery fee, and they add up to what leaves the Pocket', () => {
    const p = params.createDrop(TO, ('0x' + '11'.repeat(32)) as Hex, 1, 1_800_604_800n, parseEther('0.05'), parseEther('0.26'), parseEther('1.31'));
    const m = Object.fromEntries(describeIntent({ action: ACT.CREATE_DROP, vault: V, nonce: 0n, deadline: 1n, params: p }).lines.map((l) => [l.k, l.v]));
    expect(m['Link amount']).toMatch(/^1 QOR/);
    expect(m['Starter gas for recipient']).toMatch(/^0\.05 QOR/);
    expect(m['Delivery fee']).toMatch(/^0\.26 QOR/);
    expect(m['Total leaving the Pocket']).toMatch(/^1\.31 QOR/);
    expect(m.Mode).toMatch(/^Open/);
  });

  it('every owner action has a description; unknown or non-owner actions throw', () => {
    const cases: [Hex, Hex][] = [
      [ACT.VETO_QUEUED, params.id(1n)], [ACT.SET_LIMIT, params.limit(1n)], [ACT.SET_GUARDIANS, params.guardians([TO, V], 2)],
      [ACT.CANCEL_PENDING, '0x'], [ACT.VETO_RECOVERY, '0x'], [ACT.CONFIRM_DROP, params.confirm(TO, 1n, ('0x' + '22'.repeat(32)) as Hex)],
      [ACT.CANCEL_DROP, params.cancel(TO, 1n)], [ACT.CREATE_POOL, params.createPool(TO, ('0x' + '33'.repeat(32)) as Hex, 3, 10n ** 17n, 2n)], [ACT.CLOSE_POOL, params.closePool(TO, 1n)],
    ];
    for (const [action, p] of cases) expect(describeIntent({ action, vault: V, nonce: 0n, deadline: 1n, params: p }).lines.length).toBeGreaterThanOrEqual(4);
    expect(() => describeIntent({ action: ('0x' + '00'.repeat(32)) as Hex, vault: V, nonce: 0n, deadline: 1n, params: '0x' })).toThrow();
    expect(() => describeIntent({ action: ACT.RECOVER, vault: V, nonce: 0n, deadline: 1n, params: '0x' })).toThrow();
  });

  it.skipIf(!have)('the digest of a described spend equals the fixture the contract accepted (spendS_n)', () => {
    for (let n = 0; n < 5; n++) {
      const f = JSON.parse(fs.readFileSync(path.join(fx, 'vault', `spendS_${n}.json`), 'utf8')) as { msg: Hex };
      const c = describeIntent({ action: ACT.SPEND, vault: lib.POCKETS.PA as Hex, nonce: BigInt(n), deadline: BigInt(lib.DL), params: params.spend(TO, parseEther('0.8')) });
      expect(Buffer.from(f.msg.slice(2), 'hex').toString('utf8')).toBe(c.signedText);
    }
  });
});

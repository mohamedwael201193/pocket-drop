import { describe, expect, it } from 'vitest';
import { defenceFor, intruderFile, whenLine, type AttemptRow, type QdayState } from '../src/lib/qday';

const row = (o: Partial<AttemptRow>): AttemptRow => ({ tx: '0x' + 'ab'.repeat(32), height: 100, from: '0x1', bait: 'B1', call: 'spend', failed: true, error: 'execution reverted', source: 'try-it', explorer: '', ...o });
const state = (on: AttemptRow[], bot: AttemptRow[], refused: QdayState['log']['relayerRefused']['rows'] = []): Pick<QdayState, 'log'> => ({
  log: { onChain: { label: '', rows: on, scanOk: true }, relayerRefused: { label: '', rows: refused }, teamBot: { label: '', runs: [], rows: bot } },
});

describe('intruder file', () => {
  it('lists mined reverts from every source and relayer refusals, newest block first, team setup excluded', () => {
    const f = intruderFile(state(
      [row({ tx: 'A', height: 10 }), row({ tx: 'S', height: 50, source: 'team-setup', failed: false, call: 'drop.bind' })],
      [row({ tx: 'H'.repeat(64), height: 30, source: 'team-bot', lane: 'hybrid', time: '2026-11-22T03:40:00Z' })],
      [{ at: '2026-11-22T03:50:00Z', bait: 'B2', call: 'guardianFreeze', error: 'execution reverted: BadSignature', via: 'qday' }],
    ));
    expect(f.rows.map((r) => [r.bait, r.where, r.who])).toEqual([
      ['B2', 'refused before sending', 'a visitor (Try it)'],
      ['B1', 'on chain (hybrid lane)', 'our attacker bot'],
      ['B1', 'on chain (EVM)', 'a visitor (Try it)'],
    ]);
    expect(f.refused).toBe(3);
    expect(f.succeeded).toBe(0);
    expect(f.rows[0].tx).toBeNull();
    expect(f.rows[1].defence).toMatch(/4,627-byte ML-DSA-87/);
  });
  it('counts a stranger success and a WOULD SUCCEED refusal as succeeded, harmless funding not', () => {
    const f = intruderFile(state([row({ failed: false, source: 'anyone' }), row({ tx: 'F', failed: false, source: 'anyone', call: 'fund' })], [],
      [{ at: 'x', bait: 'B1', call: 'spend', error: 'WOULD SUCCEED (not sent by us; please report it)', via: 'qday' }]));
    expect(f.succeeded).toBe(2);
    expect(f.refused).toBe(0);
  });
  it('counts a mined tx once even if two source lists carry it, and reports distinct sending accounts', () => {
    const f = intruderFile(state(
      [row({ tx: '0xAA', from: '0xF1' }), row({ tx: '0xbb', from: '0xf1' }), row({ tx: '0xcc', from: '0xF2' })],
      [row({ tx: 'aa', from: '0xF1', source: 'team-bot' })],
    ));
    expect(f.refused).toBe(3);
    expect(f.fromAccounts).toBe(2);
  });
  it('names a defence for every call the classifier can return', () => {
    for (const c of ['spend', 'setLimit', 'setGuardians', 'guardianFreeze', 'proposeRecovery', 'finalizeRecovery', 'executeQueued', 'drop.claim', 'fund', 'deploy']) expect(defenceFor(c).length).toBeGreaterThan(20);
    expect(defenceFor('guardianFreeze')).toMatch(/guardians/);
    expect(defenceFor('drop.bind')).toMatch(/recipient/);
  });
});

describe('whenLine', () => {
  const fmt = (t: string | number) => `T(${t})`;
  it('shows time and block on a mined row', () => expect(whenLine({ when: '2026-11-22T05:00:00Z', height: 10532170 }, fmt)).toBe('T(2026-11-22T05:00:00Z) · block 10,532,170'));
  it('says a row refused before sending was never mined', () => expect(whenLine({ when: '2026-11-22T05:00:00Z', height: null }, fmt)).toBe('T(2026-11-22T05:00:00Z) · not mined'));
  it('never leaves the slot empty', () => expect(whenLine({ when: null, height: 5 }, fmt)).toBe('time not recorded · block 5'));
});

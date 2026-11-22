// LIVE (Diana testnet): the transaction checker re-verifies the ML-DSA-87 signatures of recorded hybrid-lane relays with keys read
// from the chain, and a changed intent (amount, payout, next nonce) is rejected by the same signature.
import { describe, expect, it } from 'vitest';
import { checkTx, verdict } from '../src/lib/txcheck';
import { liveDeps } from '../src/lib/txcheckChain';

const CASES: [string, string, string, string[]][] = [
  ['600BE0CF0FA16927D9E2C9C08285E504EF028BFE71A5CB6431483639A1E561A8', 'deployAndRelay', 'createDrop', ['owner']],
  ['B5C0F87E7DD0CDD87CD4FE6A1B5BF9A37C8964BB23A0F18F47EA9FA879798348', 'relay', 'bind', ['link key']],
  ['9EC512273BD97B520F3B058BB30AA42E1CE82815FCDA99C16D932DB2422D820B', 'relay', 'confirmDrop', ['owner']],
  ['E64662F8E0503C8A2C18E267A52ABE2670958E22A8BF6B10C6563FEFB9864FC8', 'relay', 'claim', ['recipient']],
  ['13E0443F28C3E4ABA61F8AF83C1C6EDEB5CA67E59AEA8B07F255154F03D34B94', 'deployAndRelay', 'spend', ['owner']],
];
// Recorded EVM-lane relays (before the hybrid lane): pool, guardians, freeze, unanimous recovery, the QoreX-format intent.
const EVM: [string, string, string, string[]][] = [
  ['0x4bb7274991c0cdf63ab0391f2bbaa62878ca995771e326d20232e652d0c12f61', 'deployAndRelay', 'createPool', ['owner']],
  ['0x7902a9608c49fff8a63f5823fe0993bbdf83dedb58cbe788a12b5f6194de131b', 'relay', 'claim', ['link key', 'recipient']],
  ['0x164b10b1b485cb996b7a57a311b2a33fd1368a6e967bdaaf7dd4a76bd889c816', 'relay', 'setGuardians', ['owner']],
  ['0x0c653400b781cf9501a28d76b1ace95dfb6398282b0f053e5d7c61a60e769007', 'relay', 'guardianFreeze', ['guardian', 'guardian']],
  ['0x2452055d3d58238709d79e4e2fffe98ff76d3981be09e5ce2c7e3f58a52b25be', 'relay', 'proposeRecoveryUnanimous', ['guardian', 'guardian', 'guardian']],
  ['0x36909c05a300789652254abcaad394d36ab1be2e37cd7c64090818eda61cd04d', 'deployAndRelay', 'spend', ['owner']],
];

describe('checkTx on recorded EVM-lane relays', () => {
  it.each(EVM)('%s', async (hash, action, fn, who) => {
    const r = await checkTx(hash, liveDeps);
    console.log(hash.slice(0, 10), r.action, r.fn, r.note, r.checks.map((c) => [c.who, c.valid, c.tamperedValid, c.pinned, c.nonce]));
    expect(r.tx.lane).toBe('evm');
    expect(r.action).toBe(action);
    expect(r.fn).toBe(fn);
    expect(r.checks.map((c) => c.who)).toEqual(who);
    expect(verdict(r)).toBe('verified');
  }, 60_000);
});

describe('checkTx on recorded hybrid relays', () => {
  it.each(CASES)('%s', async (hash, action, fn, who) => {
    const r = await checkTx(hash, liveDeps);
    console.log(hash.slice(0, 8), r.action, r.fn, r.checks.map((c) => [c.who, c.valid, c.tamperedValid, c.pinned, c.nonce, c.tamperedWhat]));
    expect(r.tx.lane).toBe('hybrid');
    expect(r.tx.relayerHybridVerified).toBe(true);
    expect(r.action).toBe(action);
    expect(r.fn).toBe(fn);
    expect(r.checks.map((c) => c.who)).toEqual(who);
    for (const c of r.checks) { expect(c.sigBytes).toBe(4627); expect(c.pkBytes).toBe(2592); }
    expect(verdict(r)).toBe('verified');
  }, 60_000);
});

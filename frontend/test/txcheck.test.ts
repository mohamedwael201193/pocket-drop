// Transaction checker, offline: real ML-DSA-87 keys and signatures from @qorechain/pqc, chain reads mocked.
import { describe, expect, it } from 'vitest';
import { encodeFunctionData, keccak256, toHex, type Hex } from 'viem';
import { mldsa } from '@qorechain/pqc';
import { routerAbi, vaultAbi } from '../src/lib/abi4';
import { ACT, intentDigest, params, pqMessageBytes } from '../src/lib/intents';
import { INST } from '../src/lib/v4';
import { b64ToHex, checkTx, fromCosmosTx, normalizeHash, verdict, type CheckDeps, type FetchedTx } from '../src/lib/txcheck';
import fixture from './fixtures/xvm-93FC5B4B.json';
import { withQoresign } from '../src/lib/txcheckChain';

const VAULT = '0xD6b6Fd3D68aD53E8FD6018099A32c01BaB4aa58b' as Hex;
const OWNER = '0x1111111111111111111111111111111111111111' as Hex;
const TO = '0x2222222222222222222222222222222222222222' as Hex;
const kp = mldsa.keygen(new Uint8Array(32).fill(7));
const other = mldsa.keygen(new Uint8Array(32).fill(9));
const PK = toHex(kp.publicKey);

function spendTx(nonce: bigint, signer = kp): FetchedTx {
  const deadline = 1_900_000_000n;
  const digest = intentDigest({ action: ACT.SPEND, vault: VAULT, nonce, deadline, params: params.spend(TO, 10n ** 16n) });
  const sig = toHex(mldsa.sign(signer.secretKey, pqMessageBytes(digest)));
  const inner = encodeFunctionData({ abi: vaultAbi, functionName: 'spend', args: [TO, 10n ** 16n, deadline, sig] });
  const payload = encodeFunctionData({ abi: routerAbi, functionName: 'relay', args: [VAULT, inner] });
  return { lane: 'hybrid', hash: 'AB'.repeat(32), height: 100n, ok: true, router: INST.prod.router, payload, relayerHybridVerified: true, relayer: 'qor1x' };
}

function deps(tx: FetchedTx, o: { nonce?: bigint; pinned?: Hex; key?: Hex | null } = {}): CheckDeps {
  return {
    fetchTx: async () => tx,
    hasCode: async () => true,
    read: async (_a, _abi, fn) => (fn === 'nonce' ? (o.nonce ?? 4n) : fn === 'owner' ? OWNER : fn === 'ownerKeyHash' ? (o.pinned ?? keccak256(PK)) : null),
    keyOf: async () => (o.key === undefined ? PK : o.key),
    verify: (pk, m, s) => mldsa.verify(pk, m, s),
  };
}

describe('normalizeHash', () => {
  it('accepts EVM and native hashes and rejects the rest', () => {
    expect(normalizeHash(' 0x' + 'AB'.repeat(32))).toBe('0x' + 'ab'.repeat(32));
    expect(normalizeHash('ab'.repeat(32))).toBe('AB'.repeat(32));
    expect(normalizeHash('0x1234')).toBeNull();
    expect(normalizeHash('zz'.repeat(32))).toBeNull();
  });
});

describe('fromCosmosTx', () => {
  it('reads the router, payload and the chain hybrid-verify event from a recorded native tx', () => {
    const t = fromCosmosTx(fixture as never)!;
    expect(t.lane).toBe('hybrid');
    expect(t.router).toBe('0xb0d8fd2379e06ed5d48371b41baa6dd0a31cf209');
    expect(t.relayerHybridVerified).toBe(true);
    expect(t.height).toBe(10527710n);
    expect(t.payload.slice(0, 10)).toBe('0xc28e83fd');
  });
  it('base64 to hex', () => expect(b64ToHex('AQL/')).toBe('0x0102ff'));
});

describe('checkTx', () => {
  it('a signature-free call (executeQueued) has nothing to check and says why', async () => {
    const t = fromCosmosTx(fixture as never)!;
    const r = await checkTx(t.hash, { ...deps(t) });
    expect(r.fn).toBe('executeQueued');
    expect(r.checks).toHaveLength(0);
    expect(r.note).toMatch(/no signature/);
    expect(verdict(r)).toBe('none');
  });
  it('verifies an owner spend at the nonce read from the chain; amount+1 and next nonce are rejected', async () => {
    const tx = spendTx(4n);
    const r = await checkTx(tx.hash, deps(tx));
    expect(r.fn).toBe('spend');
    expect(r.checks[0]).toMatchObject({ who: 'owner', valid: true, tamperedValid: false, pinned: true, nonce: 4n, pkBytes: 2592, sigBytes: 4627 });
    expect(r.checks[0].tamperedWhat).toMatch(/amount \+ 1 wei; next nonce \(replay\) rejected/);
    expect(verdict(r)).toBe('verified');
  });
  it('the QoreSign cross-check builds the same signed text and also verifies', async () => {
    const tx = spendTx(4n);
    const r = await checkTx(tx.hash, await withQoresign(deps(tx)));
    expect(r.checks[0].qoresign).toEqual({ sameText: true, valid: true });
    expect(verdict(r)).toBe('verified');
  });
  it('a QoreSign disagreement fails the verdict even when the first library says valid', async () => {
    const tx = spendTx(4n);
    const d = { ...deps(tx), qoresign: { messageBytes: () => new Uint8Array([1, 2, 3]), verify: () => false } };
    const r = await checkTx(tx.hash, d);
    expect(r.checks[0].valid).toBe(true);
    expect(r.checks[0].qoresign).toEqual({ sameText: false, valid: false });
    expect(verdict(r)).toBe('failed');
  });
  it('fails when the signature was made for another nonce', async () => {
    const tx = spendTx(3n);
    const r = await checkTx(tx.hash, deps(tx));
    expect(r.checks[0].valid).toBe(false);
    expect(verdict(r)).toBe('failed');
  });
  it('fails when another key signed', async () => {
    const tx = spendTx(4n, other);
    expect(verdict(await checkTx(tx.hash, deps(tx)))).toBe('failed');
  });
  it('fails when the key on chain does not match the pinned hash', async () => {
    const tx = spendTx(4n);
    const r = await checkTx(tx.hash, deps(tx, { pinned: keccak256('0x01') }));
    expect(r.checks[0]).toMatchObject({ valid: true, pinned: false });
    expect(verdict(r)).toBe('failed');
  });
  it('fails when the owner has no key on chain', async () => {
    const tx = spendTx(4n);
    const r = await checkTx(tx.hash, deps(tx, { key: null }));
    expect(r.checks[0]).toMatchObject({ valid: false, pkBytes: 0 });
  });
  it('a call to something that is not a v4 router is explained, not checked', async () => {
    const tx = { ...spendTx(4n), router: '0x3333333333333333333333333333333333333333' as Hex };
    const r = await checkTx(tx.hash, deps(tx));
    expect(r.note).toMatch(/does not call a Pocket Drop v4 router/);
  });
  it('rejects input that is not a hash', async () => {
    await expect(checkTx('hello', deps(spendTx(4n)))).rejects.toThrow(/64 hex/);
  });
});

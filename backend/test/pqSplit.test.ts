// The split signer must produce exactly what the SDK's in-process hybrid signer produces.
import { describe, expect, it } from 'vitest';
import { EthNativeSigner, crossvm, getNetwork, hybridSignBytes, pqcVerify, unifiedAccountFromSeed } from '@qorechain/sdk';
import { TxBody, TxRaw } from 'cosmjs-types/cosmos/tx/v1beta1/tx';
import { encodeFunctionData, parseAbi } from 'viem';
import { assembleHybrid, checkPolicy, crossVmParts, pqKeyFor, pqSign, relayerAddressOf, type PqPolicy } from '../src/pqSplit.js';

const SECP = '11'.repeat(32), SEED = '22'.repeat(32);
const ROUTER = '0xb0d8fd2379e06ed5d48371b41baa6dd0a31cf209';
const relay = encodeFunctionData({ abi: parseAbi(['function relay(address target, bytes data) returns (bytes)']), functionName: 'relay', args: ['0x0000000000000000000000000000000000000001', '0x'] });
const chainId = getNetwork('testnet').chainId;
const IN = { secp: SECP, contract: ROUTER, data: relay, memo: 'pd route prod relay 0x01', gas: 900_000n, feeUqor: '120000', accountNumber: 7n, sequence: 42n, version: 'v2' as const };
const me = relayerAddressOf(SECP);
const POL: PqPolicy = { relayer: me.cosmos, relayerPubkey: Buffer.from(me.pubkey).toString('hex'), targets: [ROUTER], selectors: [relay.slice(0, 10)], chainId, maxFeeUqor: 600_000n, maxGas: 4_000_000n };

function sdkTx() {
  const acct = unifiedAccountFromSeed(Buffer.from(SECP, 'hex'), { pqcSecret: Buffer.from(SEED, 'hex') });
  const signer = new EthNativeSigner(acct, { signMode: 'hybrid' });
  const msg = crossvm.crossVmCall({ sender: acct.cosmos, sourceVm: 'cosmwasm', targetVm: 'evm', targetContract: ROUTER, payload: Buffer.from(relay.slice(2), 'hex'), funds: [], async: false });
  const out = signer.sign({ chainId, accountNumber: IN.accountNumber, sequence: IN.sequence, memo: IN.memo, signBytesVersion: 'v2', fee: { amount: [{ denom: 'uqor', amount: IN.feeUqor }], gas: IN.gas }, messages: [msg] } as never) as unknown as { txRawBytes: Uint8Array };
  return { acct, raw: TxRaw.decode(out.txRawBytes), bytes: out.txRawBytes };
}

describe('split hybrid signing', () => {
  it('derives the same relayer address and ML-DSA key as the SDK, without the secp key on the signer side', () => {
    const { acct } = sdkTx();
    expect(me.cosmos).toBe(acct.cosmos);
    expect(Buffer.from(pqKeyFor(SEED, me.cosmos).publicKey)).toEqual(Buffer.from(acct.pqc!.publicKey));
  });

  it('builds the same AuthInfo and unsigned body as the SDK, and the same TxRaw for the same ML-DSA signature', () => {
    const { raw, bytes } = sdkTx();
    const p = crossVmParts(IN);
    expect(Buffer.from(p.authInfo, 'base64')).toEqual(Buffer.from(raw.authInfoBytes));
    const sdkBody = TxBody.decode(raw.bodyBytes);
    const b0 = TxBody.encode(TxBody.fromPartial({ messages: sdkBody.messages, memo: sdkBody.memo, timeoutHeight: sdkBody.timeoutHeight })).finish();
    expect(Buffer.from(p.b0, 'base64')).toEqual(Buffer.from(b0));
    // reuse the SDK's (randomized) ML-DSA signature: the secp half is deterministic, so the whole tx must match byte for byte
    const extValue = sdkBody.extensionOptions[0].value;
    const sdkPqSig = decodeHybridSig(extValue);
    expect(Buffer.from(assembleHybrid(SECP, p, Buffer.from(sdkPqSig).toString('base64')), 'base64')).toEqual(Buffer.from(bytes));
  });

  it('the isolated signer signs only after its policy passes, and the signature verifies', () => {
    const p = crossVmParts(IN);
    const key = pqKeyFor(SEED, me.cosmos);
    const { signature, checked } = pqSign(p, POL, key);
    expect(checked).toMatchObject({ target: ROUTER, selector: relay.slice(0, 10), feeUqor: 120000n, gas: 900000n });
    const msg = hybridSignBytes('v2', chainId, Buffer.from(p.b0, 'base64'), Buffer.from(p.authInfo, 'base64'));
    expect(pqcVerify(key.publicKey, msg, Buffer.from(signature, 'base64'))).toBe(true);
  });

  it('refuses anything that is not one relay by our relayer into an allowed target', () => {
    const ok = crossVmParts(IN);
    const bad = (o: Partial<typeof IN>, pol: Partial<PqPolicy> = {}) => () => checkPolicy(crossVmParts({ ...IN, ...o }), { ...POL, ...pol });
    expect(() => checkPolicy(ok, POL)).not.toThrow();
    expect(bad({ contract: '0x0000000000000000000000000000000000000bad' })).toThrow(/target .* not allowed/);
    expect(bad({ data: '0xdeadbeef' })).toThrow(/selector/);
    expect(bad({ memo: 'hello' })).toThrow(/memo/);
    expect(bad({ feeUqor: '700000' })).toThrow(/fee/);
    expect(bad({ gas: 5_000_000n })).toThrow(/gas/);
    expect(bad({ secp: '33'.repeat(32) })).toThrow(/sender is not the relayer/);
    expect(bad({}, { relayerPubkey: '02' + '00'.repeat(32) })).toThrow(/signer is not the relayer/);
    expect(bad({}, { chainId: 'other-1' })).toThrow(/chain/);
    // an extension already attached (someone replaying a signed body) is refused
    const withExt = { ...ok, b0: Buffer.from(TxBody.encode(TxBody.fromPartial({ ...TxBody.decode(Buffer.from(ok.b0, 'base64')), extensionOptions: [{ typeUrl: '/x', value: new Uint8Array() }] })).finish()).toString('base64') };
    expect(() => checkPolicy(withExt, POL)).toThrow(/extensions/);
    expect(() => checkPolicy({ ...ok, version: 'v9' as never }, POL)).toThrow(/version/);
  });
});

/** PQCHybridSignature{algorithm_id=1 (varint), pqc_signature=2 (bytes), ...}: read field 2. */
function decodeHybridSig(v: Uint8Array): Uint8Array {
  let i = 0;
  const varint = () => { let x = 0, s = 0; for (;;) { const b = v[i++]; x += (b & 0x7f) * 2 ** s; if (b < 0x80) return x; s += 7; } };
  while (i < v.length) {
    const tag = varint(); const f = tag >> 3, w = tag & 7;
    if (w === 0) { varint(); continue; }
    if (w === 2) { const n = varint(); const out = v.slice(i, i + n); i += n; if (f === 2) return out; continue; }
    throw new Error('unexpected wire type');
  }
  throw new Error('no signature');
}

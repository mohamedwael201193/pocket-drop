import { describe, expect, it } from 'vitest';
import { encodeErrorResult } from 'viem';
import { pocketDropAbi } from '../src/abi.js';
import { decodeRevert, extractRevertData, isWindowError } from '../src/errors.js';

const errAbi = [{ type: 'error', name: 'Error', inputs: [{ name: 'm', type: 'string' }] }] as const;
const panAbi = [{ type: 'error', name: 'Panic', inputs: [{ name: 'c', type: 'uint256' }] }] as const;

describe('decodeRevert', () => {
  it('decodes every custom error in the ABI with a human message', () => {
    const errs = pocketDropAbi.filter((x) => x.type === 'error');
    expect(errs.length).toBeGreaterThan(10);
    for (const e of errs) {
      const args = (e as any).inputs.map(() => 2n);
      const d = decodeRevert(encodeErrorResult({ abi: pocketDropAbi, errorName: (e as any).name, args } as any));
      expect(d.name).toBe((e as any).name);
      expect(d.known).toBe(true);
      expect(d.message.length).toBeGreaterThan(5);
    }
  });
  it('InvalidState reports the current state name', () => {
    expect(decodeRevert(encodeErrorResult({ abi: pocketDropAbi, errorName: 'InvalidState', args: [2] })).message).toContain('Bound');
    expect(decodeRevert(encodeErrorResult({ abi: pocketDropAbi, errorName: 'InvalidState', args: [42] })).message).toContain('42');
  });
  it('BadLinkSignature decodes by name', () => {
    expect(decodeRevert(encodeErrorResult({ abi: pocketDropAbi, errorName: 'BadLinkSignature' })).name).toBe('BadLinkSignature');
  });
  it('decodes Error(string) and Panic(uint256)', () => {
    expect(decodeRevert(encodeErrorResult({ abi: errAbi, errorName: 'Error', args: ['nope'] }))).toMatchObject({ name: 'Error', message: 'nope' });
    expect(decodeRevert(encodeErrorResult({ abi: panAbi, errorName: 'Panic', args: [0x11n] })).message).toContain('overflow');
    expect(decodeRevert(encodeErrorResult({ abi: panAbi, errorName: 'Panic', args: [0x99n] })).message).toContain('unknown');
  });
  it('falls back for unknown selectors, empty data and malformed payloads', () => {
    expect(decodeRevert('0xdeadbeef')).toMatchObject({ name: 'UnknownError', known: false, selector: '0xdeadbeef' });
    expect(decodeRevert('0x', 'boom')).toMatchObject({ name: 'Revert', message: 'boom' });
    expect(decodeRevert(null).name).toBe('Revert');
    expect(decodeRevert('0x08c379a0').name).toBe('UnknownError');
    expect(decodeRevert('0x08c379a0ff').name).toBe('UnknownError');
    expect(decodeRevert('0x4e487b71ff').name).toBe('UnknownError');
  });
});

describe('extractRevertData / isWindowError', () => {
  const data = encodeErrorResult({ abi: pocketDropAbi, errorName: 'NotSender' });
  it('walks the cause chain and nested data objects', () => {
    expect(extractRevertData({ cause: { cause: { data } } })).toBe(data);
    expect(extractRevertData({ data: { data } })).toBe(data);
  });
  it('falls back to hex in the message, else null', () => {
    expect(extractRevertData({ message: `execution reverted: ${data}` })).toBe(data);
    expect(extractRevertData({ message: 'nothing here' })).toBeNull();
    expect(extractRevertData(undefined)).toBeNull();
  });
  it('detects authorisation window failures', () => {
    expect(isWindowError({ details: 'the EVM authorisation window for qor1x does not admit this transaction' })).toBe(true);
    expect(isWindowError({ message: 'EVM authorization window exhausted' })).toBe(true);
    expect(isWindowError(new Error('nonce too low'))).toBe(false);
  });
});

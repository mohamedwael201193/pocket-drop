import { describe, expect, it, vi } from 'vitest';
import { encodeErrorResult } from 'viem';
import { pocketDropAbi } from '../src/abi.js';
import { createRelayer, evmToQor, makePublicClient } from '../src/relayer.js';
import { CONTRACT, KEY, cfg } from './helpers.js';

const HASH = ('0x' + 'ee'.repeat(32)) as `0x${string}`;
const mkClients = (over: any = {}) => ({
  pub: {
    call: vi.fn(async () => ({ data: '0x' })),
    getGasPrice: vi.fn(async () => 100n),
    waitForTransactionReceipt: vi.fn(async () => ({ status: 'success', blockNumber: 5n, gasUsed: 123n })),
    ...over.pub,
  } as any,
  wallet: { sendTransaction: vi.fn(async () => HASH), ...over.wallet } as any,
});

describe('createRelayer', () => {
  it('requires key and contract', () => {
    expect(() => createRelayer(cfg({ relayerKey: null }))).toThrow(/RELAYER_SECP_KEY/);
    expect(() => createRelayer(cfg({ contract: null }))).toThrow(/POCKETDROP_ADDRESS/);
  });
  it('derives address from the secp key only', () => {
    expect(createRelayer(cfg(), mkClients()).address).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });
  it('builds default clients when none injected', () => {
    expect(createRelayer(cfg()).contract).toBe(CONTRACT);
    expect(makePublicClient(cfg())).toBeTruthy();
  });
  it('simulate ok', async () => {
    const c = mkClients();
    expect(await createRelayer(cfg(), c).simulate('0x1234')).toEqual({ ok: true });
    expect(c.pub.call).toHaveBeenCalledWith(expect.objectContaining({ to: CONTRACT, data: '0x1234' }));
  });
  it('simulate decodes revert data from the error', async () => {
    const data = encodeErrorResult({ abi: pocketDropAbi, errorName: 'PossessionNotProven' });
    const c = mkClients({ pub: { call: vi.fn(async () => { throw Object.assign(new Error('execution reverted\nmore'), { cause: { data } }); }) } });
    const r = await createRelayer(cfg(), c).simulate('0x00');
    expect(r).toMatchObject({ ok: false, revert: { name: 'PossessionNotProven', known: true } });
  });
  it('simulate with no revert data uses the message; non-Error throw handled', async () => {
    const c = mkClients({ pub: { call: vi.fn(async () => { throw { shortMessage: 'execution reverted' }; }) } });
    expect(await createRelayer(cfg(), c).simulate('0x00')).toMatchObject({ ok: false, revert: { name: 'Revert', message: 'execution reverted' } });
    const c2 = mkClients({ pub: { call: vi.fn(async () => { throw {}; }) } });
    expect(await createRelayer(cfg(), c2).simulate('0x00')).toMatchObject({ ok: false });
  });
  it('send uses explicit gas, legacy gasPrice x1.3, and waits for receipt', async () => {
    const c = mkClients();
    const r = await createRelayer(cfg(), c).send('0xabcd', 900_000n);
    expect(r).toEqual({ ok: true, hash: HASH, lane: 'evm', status: 'success', blockNumber: 5n, gasUsed: 123n });
    expect(c.wallet.sendTransaction).toHaveBeenCalledWith(expect.objectContaining({ gas: 900_000n, gasPrice: 130n, type: 'legacy', to: CONTRACT, data: '0xabcd' }));
  });
  it('send classifies window errors and other failures', async () => {
    const w = mkClients({ wallet: { sendTransaction: vi.fn(async () => { throw { details: 'EVM authorisation window exhausted' }; }) } });
    expect(await createRelayer(cfg(), w).send('0x00', 1n)).toMatchObject({ ok: false, reason: 'window' });
    const o = mkClients({ wallet: { sendTransaction: vi.fn(async () => { throw new Error('x'.repeat(1000)); }) } });
    const r = await createRelayer(cfg(), o).send('0x00', 1n);
    expect(r).toMatchObject({ ok: false, reason: 'rpc' });
    expect((r as any).message.length).toBeLessThanOrEqual(400);
  });
});

describe('evmToQor', () => {
  it('bech32 encodes with qor prefix (matches the known relayer account)', () => {
    expect(evmToQor('0xF6e6fb2d33Bef3043682658E2b69F3a2F8616cCD')).toBe('qor17mn0ktfnhmesgd5zvk8zk60n5tuxzmxdc8ymnl');
    expect(KEY).toBeTruthy();
  });
});

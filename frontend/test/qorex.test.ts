import { afterEach, describe, expect, it, vi } from 'vitest';
import { QORECHAIN_TESTNET_CHAIN_ID, QORECHAIN_TESTNET_EVM_CHAIN_ID } from '@qorechain/qorex-types';
import { MsgSend } from 'cosmjs-types/cosmos/bank/v1beta1/tx';
import { COSMOS_CHAIN_ID } from '../src/lib/config';
import { QOREX_MAINNET_NOTE, connectQorex, fundFromQorex } from '../src/lib/qorex';

const QOR1 = 'qor17mn0ktfnhmesgd5zvk8zk60n5tuxzmxdc8ymnl';
function inject({ evmChain = '0x2648', caps = ['signAndBroadcast'] as string[], signDirect = true } = {}) {
  const signAndBroadcast = vi.fn(async () => ({ txHash: 'AB'.repeat(32), code: 0, height: 1, shield: 'shielded' }));
  const native: Record<string, unknown> = {
    isQoreX: true, capabilities: caps, enable: vi.fn(async () => null),
    getKey: vi.fn(async () => ({ bech32Address: QOR1 })), signAndBroadcast,
  };
  if (signDirect) native.signDirect = vi.fn();
  const evm = { isQoreX: true, request: vi.fn(async ({ method }: { method: string }) => (method === 'eth_chainId' ? evmChain : ['0xF6e6fb2d33Bef3043682658E2b69F3a2F8616cCD'])), on() {}, removeListener() {} };
  (globalThis as { window?: unknown }).window = { qorex: { native, evm } };
  return { signAndBroadcast };
}
afterEach(() => { delete (globalThis as { window?: unknown }).window; });

describe('QoreX through @qorechain/qorex-types', () => {
  it('the app chain is the testnet chain the official types name', () => {
    expect(COSMOS_CHAIN_ID).toBe(QORECHAIN_TESTNET_CHAIN_ID);
    expect(QORECHAIN_TESTNET_EVM_CHAIN_ID).toBe(9800);
  });
  it('connects on testnet; funding needs the signAndBroadcast capability, message signing is off unless advertised', async () => {
    inject();
    const id = await connectQorex();
    expect(id.cosmos).toBe(QOR1);
    expect(id.canFund).toBe(true);
    expect(id.canSignMessage).toBe(false);
  });
  it('works with builds that inject native without signDirect', async () => {
    inject({ signDirect: false });
    expect((await connectQorex()).cosmos).toBe(QOR1);
  });
  it('a wallet on mainnet (0x2649) gets the switch-to-testnet note', async () => {
    inject({ evmChain: '0x2649' });
    await expect(connectQorex()).rejects.toThrow(QOREX_MAINNET_NOTE);
  });
  it('funding sends one MsgSend through signAndBroadcast and returns the shield state', async () => {
    const { signAndBroadcast } = inject();
    const id = await connectQorex();
    const r = await fundFromQorex(id, 'qor1g0wwwmnww06d6ctu07vfwahnxksajfyysk9upc', 250000n);
    expect(r).toEqual({ txHash: 'AB'.repeat(32), shield: 'shielded' });
    const req = (signAndBroadcast.mock.calls[0] as unknown as [{ chainId: string; messages: { typeUrl: string; value: Uint8Array }[] }])[0];
    expect(req.chainId).toBe(QORECHAIN_TESTNET_CHAIN_ID);
    const m = MsgSend.decode(req.messages[0].value);
    expect(m).toMatchObject({ fromAddress: QOR1, toAddress: 'qor1g0wwwmnww06d6ctu07vfwahnxksajfyysk9upc', amount: [{ denom: 'uqor', amount: '250000' }] });
  });
  it('without the capability the app does not offer a send', async () => {
    inject({ caps: [] });
    const id = await connectQorex();
    expect(id.canFund).toBe(false);
    await expect(fundFromQorex(id, QOR1, 1n)).rejects.toThrow(/cannot send/);
  });
});

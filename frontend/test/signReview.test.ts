import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Hex } from 'viem';

const signDigest = vi.fn(async () => '0xsig' as Hex);
const relayToPocket = vi.fn(async () => ({ ok: true, txHash: '0xabc' }));
vi.mock('../src/lib/identity', () => ({ signDigest, keyHashOfAccount: () => '0x' }));
vi.mock('../src/lib/chain', () => ({ pub: {} }));
vi.mock('../src/lib/v4', () => ({
  INST: { prod: { drop: '0x00000000000000000000000000000000000000d1', pool: '0x00000000000000000000000000000000000000e1' } },
  nextNonce: async () => 7n, chainTimestamp: async () => 1_800_000_000,
  relayToPocket, relayTo: vi.fn(), vaultCall: (fn: string) => fn, dropCall: vi.fn(), poolCall: vi.fn(),
}));

const { spend } = await import('../src/lib/actions');
const { setReviewHost, isCancelled } = await import('../src/lib/signReview');
const { intentDigest, ACT, params } = await import('../src/lib/intents');

const vault = '0x00000000000000000000000000000000000000a1' as Hex;
const to = '0x00000000000000000000000000000000000000b2' as Hex;
const ctx = { env: 'prod', cfg: {}, address: vault, acct: { pqc: { secretKey: new Uint8Array(1) } } } as never;

describe('clear signing before every owner intent', () => {
  beforeEach(() => { signDigest.mockClear(); relayToPocket.mockClear(); });

  it('shows the readable intent, and signs exactly the digest of those fields when approved', async () => {
    let seen: { title: string; lines: { k: string; v: string }[]; digest: Hex } | null = null;
    const off = setReviewHost((r) => { seen = r.clear; r.resolve(true); });
    await spend(ctx, to, 10n ** 17n);
    off();
    expect(seen!.title).toBe('Send QOR from your Pocket');
    expect(seen!.lines.find((l) => l.k === 'Recipient')?.v).toBe(to);
    expect(seen!.lines.find((l) => l.k === 'Amount')?.v).toMatch(/^0\.1 QOR/);
    expect(seen!.lines.find((l) => l.k === 'Intent number (nonce)')?.v).toBe('7');
    const want = intentDigest({ action: ACT.SPEND, vault, nonce: 7n, deadline: 1_800_003_600n, params: params.spend(to, 10n ** 17n) });
    expect(seen!.digest).toBe(want);
    expect(signDigest).toHaveBeenCalledWith(expect.anything(), want);
    expect(relayToPocket).toHaveBeenCalledOnce();
  });

  it('signs and sends nothing when the user cancels', async () => {
    const off = setReviewHost((r) => r.resolve(false));
    const e = await spend(ctx, to, 1n).catch((x) => x);
    off();
    expect(isCancelled(e)).toBe(true);
    expect(signDigest).not.toHaveBeenCalled();
    expect(relayToPocket).not.toHaveBeenCalled();
  });
});

import { describe, expect, it, vi } from 'vitest';
import { encodeErrorResult, encodeFunctionData } from 'viem';
import { pocketDropAbi } from '../src/abi.js';
import { decodeRevert } from '../src/errors.js';
import { handleBind, handleClaim, handleLink, reply, type Deps } from '../src/handlers.js';
import { MemoryLimiter } from '../src/ratelimit.js';
import type { Relayer } from '../src/relayer.js';
import { setSink } from '../src/log.js';
import { ADDR, CONTRACT, bindBody, cfg, claimBody } from './helpers.js';

setSink(() => {});

const HASH = ('0x' + 'cd'.repeat(32)) as `0x${string}`;
function mk(over: Partial<Relayer> = {}, c = cfg(), pub: any = { readContract: vi.fn() }): { d: Deps; relayer: Relayer } {
  const relayer: Relayer = {
    mode: 'evm', address: ADDR, contract: CONTRACT as any,
    simulate: vi.fn(async () => ({ ok: true as const })),
    send: vi.fn(async () => ({ ok: true as const, hash: HASH, lane: 'evm' as const, status: 'success' as const, blockNumber: 12n, gasUsed: 500_000n })),
    ...over,
  };
  return { d: { cfg: c, limiter: new MemoryLimiter(), getRelayer: () => relayer, pub }, relayer };
}

describe('POST /api/bind', () => {
  it('validates, simulates, sends with explicit gas, returns hash + explorer link', async () => {
    const { d, relayer } = mk();
    const r = await handleBind(bindBody(), '1.2.3.4', d);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, network: 'diana-testnet', status: 'success', txHash: HASH, gasLimit: '900000', blockNumber: '12' });
    expect(r.body.explorer).toBe('https://explore.qore.network/tx/' + 'cd'.repeat(32));
    expect(relayer.simulate).toHaveBeenCalledTimes(1);
    expect(relayer.send).toHaveBeenCalledWith(expect.stringMatching(/^0x/), 900_000n, 'pd v3 bind 7');
    expect(r.body).toMatchObject({ lane: 'evm', signature: expect.stringMatching(/^secp256k1 \(EVM/) });
    const expected = encodeFunctionData({ abi: pocketDropAbi, functionName: 'bind', args: [7n, ADDR, bindBody().recipientKeyHash, bindBody().linkPk, bindBody().linkSig] });
    expect((relayer.send as any).mock.calls[0][0]).toBe(expected);
  });
  it('accepts a JSON string body', async () => {
    const { d } = mk();
    expect((await handleBind(JSON.stringify(bindBody()), 'ip', d)).status).toBe(200);
    expect((await handleBind('{nope', 'ip', d)).status).toBe(400);
  });
  it('returns 400 with issues on invalid shape and never calls the chain', async () => {
    const { d, relayer } = mk();
    const r = await handleBind(bindBody({ linkPk: '0x1234' }), 'ip', d);
    expect(r.status).toBe(400);
    expect((r.body.error as any).issues[0].path).toBe('linkPk');
    expect(relayer.simulate).not.toHaveBeenCalled();
  });
  it('returns the decoded custom error and does NOT send when the simulation reverts', async () => {
    const revert = decodeRevert(encodeErrorResult({ abi: pocketDropAbi, errorName: 'BadLinkSignature' }));
    const { d, relayer } = mk({ simulate: vi.fn(async () => ({ ok: false as const, revert })) });
    const r = await handleBind(bindBody(), 'ip', d);
    expect(r.status).toBe(422);
    expect(r.body).toMatchObject({ ok: false, sent: false, error: { name: 'BadLinkSignature', known: true } });
    expect(relayer.send).not.toHaveBeenCalled();
  });
  it('503 when window is exhausted, 502 on other send errors, 502 when mined but reverted', async () => {
    const w = mk({ send: vi.fn(async () => ({ ok: false as const, reason: 'window' as const, message: 'authorisation window exhausted' })) });
    const rw = await handleBind(bindBody(), 'ip', w.d);
    expect(rw.status).toBe(503);
    expect(rw.headers?.['retry-after']).toBe('60');
    expect((rw.body.error as any).name).toBe('RelayerWindowUnavailable');
    const x = mk({ send: vi.fn(async () => ({ ok: false as const, reason: 'rpc' as const, message: 'nonce too low' })) });
    expect((await handleBind(bindBody(), 'ip', x.d)).status).toBe(502);
    const y = mk({ send: vi.fn(async () => ({ ok: true as const, hash: HASH, lane: 'evm' as const, status: 'reverted' as const, blockNumber: 1n, gasUsed: 1n })) });
    const ry = await handleBind(bindBody(), 'ip', y.d);
    expect(ry.status).toBe(502);
    expect(ry.body).toMatchObject({ ok: false, status: 'reverted', txHash: HASH });
  });
  it('503 when contract or relayer key missing', async () => {
    expect((await handleBind(bindBody(), 'ip', mk({}, cfg({ contract: null })).d)).status).toBe(503);
    expect((await handleBind(bindBody(), 'ip', mk({}, cfg({ relayerKey: null })).d)).status).toBe(503);
  });
  it('rate limits per IP and per linkId', async () => {
    const { d } = mk();
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await handleBind(bindBody({ linkId: String(100 + i) }), 'same-ip', d)).status);
    expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
    const ipLimited = await handleBind(bindBody({ linkId: '999' }), 'same-ip', d);
    expect(ipLimited.status).toBe(429);
    expect(Number(ipLimited.headers?.['retry-after'])).toBeGreaterThan(0);
    const { d: d2 } = mk();
    const codes: number[] = [];
    for (let i = 0; i < 7; i++) codes.push((await handleBind(bindBody({ linkId: '5' }), `ip-${i}`, d2)).status);
    expect(codes.slice(0, 6).every((s) => s === 200)).toBe(true);
    expect(codes[6]).toBe(429);
  });
});

describe('POST /api/claim', () => {
  it('sends claim with the claim gas limit', async () => {
    const { d, relayer } = mk();
    const r = await handleClaim(claimBody(), 'ip', d);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ action: 'claim', gasLimit: '800000' });
    expect(relayer.send).toHaveBeenCalledWith(encodeFunctionData({ abi: pocketDropAbi, functionName: 'claim', args: [7n, claimBody().recipientSig] }), 800_000n, 'pd v3 claim 7');
  });
  it('surfaces BadRecipientSignature from simulation', async () => {
    const revert = decodeRevert(encodeErrorResult({ abi: pocketDropAbi, errorName: 'BadRecipientSignature' }));
    const { d } = mk({ simulate: vi.fn(async () => ({ ok: false as const, revert })) });
    const r = await handleClaim(claimBody(), 'ip', d);
    expect(r.status).toBe(422);
    expect((r.body.error as any).name).toBe('BadRecipientSignature');
  });
  it('validates and rate limits', async () => {
    const { d } = mk();
    expect((await handleClaim({ linkId: 1 }, 'ip', d)).status).toBe(400);
    for (let i = 0; i < 6; i++) await handleClaim(claimBody({ linkId: 9 }), `i${i}`, d);
    expect((await handleClaim(claimBody({ linkId: 9 }), 'other', d)).status).toBe(429);
  });
});

const linkTuple = (over: Record<string, unknown> = {}) => ({
  sender: ADDR, mode: 1, state: 2, amount: 10n ** 18n, drip: 5n, relayerFee: 2n, expiry: 99n, bindDeadline: 50n,
  linkKeyHash: ('0x' + '11'.repeat(32)) as `0x${string}`, recipient: '0x2222222222222222222222222222222222222222',
  recipientKeyHash: ('0x' + '33'.repeat(32)) as `0x${string}`, dripPaid: true, ...over,
});

describe('GET /api/link/:id', () => {
  it('reads and shapes the link', async () => {
    const pub = { readContract: vi.fn(async () => linkTuple()) };
    const r = await handleLink('3', 'ip', mk({}, cfg(), pub).d);
    expect(r.status).toBe(200);
    expect(r.body.link).toMatchObject({ id: '3', mode: 'Open', state: 'Bound', amount: '1000000000000000000', dripPaid: true });
    expect(pub.readContract).toHaveBeenCalledWith(expect.objectContaining({ functionName: 'getLink', args: [3n] }));
  });
  it('nulls unset recipient fields and tolerates unknown enum values', async () => {
    const zero = '0x0000000000000000000000000000000000000000';
    const pub = { readContract: vi.fn(async () => linkTuple({ recipient: zero, recipientKeyHash: '0x' + '00'.repeat(32), mode: 9, state: 19 })) };
    const r = await handleLink('3', 'ip', mk({}, cfg(), pub).d);
    expect(r.body.link).toMatchObject({ recipient: null, recipientKeyHash: null, mode: 'unknown(9)', state: 'unknown(19)' });
  });
  it('404 for nonexistent (zero sender or UnknownLink revert), 400 bad id, 503 unconfigured', async () => {
    const zero = '0x0000000000000000000000000000000000000000';
    expect((await handleLink('1', 'ip', mk({}, cfg(), { readContract: async () => linkTuple({ sender: zero }) }).d)).status).toBe(404);
    expect((await handleLink('1', 'ip', mk({}, cfg(), { readContract: async () => linkTuple({ state: 0 }) }).d)).status).toBe(404);
    expect((await handleLink('1', 'ip', mk({}, cfg(), { readContract: async () => null }).d)).status).toBe(404);
    const unk = { data: encodeErrorResult({ abi: pocketDropAbi, errorName: 'LinkNotFound' }) };
    expect((await handleLink('1', 'ip', mk({}, cfg(), { readContract: async () => { throw unk; } }).d)).status).toBe(404);
    expect((await handleLink('abc', 'ip', mk().d)).status).toBe(400);
    expect((await handleLink(undefined, 'ip', mk().d)).status).toBe(400);
    expect((await handleLink('1', 'ip', mk({}, cfg({ contract: null })).d)).status).toBe(503);
  });
  it('502 on other read failures; rate limited', async () => {
    const bad = mk({}, cfg(), { readContract: async () => { throw new Error('rpc down'); } });
    expect((await handleLink('1', 'ip', bad.d)).status).toBe(502);
    const { d } = mk({}, cfg(), { readContract: async () => linkTuple() });
    let last = 0;
    for (let i = 0; i < 121; i++) last = (await handleLink('1', 'ip', d)).status;
    expect(last).toBe(429);
  });
});

describe('reply', () => {
  it('always carries network', () => expect(reply(200, { a: 1 }).body.network).toBe('diana-testnet'));
});

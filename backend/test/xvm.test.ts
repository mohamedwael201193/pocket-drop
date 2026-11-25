import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import { encodeAbiParameters, encodeFunctionData, encodeFunctionResult, type Hex } from 'viem';
import { routerAbi } from '../src/abi4.js';
import { V4_INSTANCES } from '../src/v4.js';
import { DROP_CALLS, POOL_CALLS, VAULT_CALLS, decodeHybridRelay, eventsOf, hybridRelays, clearXvmCache, jsonSafe, searchRouterTxs, type HybridRelay } from '../src/xvm.js';
import { mergeHybrid } from '../src/statsv4.js';

const OK = JSON.parse(fs.readFileSync(new URL('./fixtures/xvm-93FC5B4B.json', import.meta.url), 'utf8')).tx_response;
const P = V4_INSTANCES.prodV4; // the recorded fixtures are relays into the v4 (previous) router
const POCKET = '0x00000000000000000000000000000000000000AA' as Hex; // checksummed, as viem decodes it
const OWNER = '0x00000000000000000000000000000000000000bb' as Hex;
const REC = '0x00000000000000000000000000000000000000cc' as Hex;
const H32 = ('0x' + '11'.repeat(32)) as Hex;

// minimal protobuf writer for a TxMsgData with one MsgCrossVMCallResponse
const vint = (n: number) => { const o: number[] = []; while (n > 0x7f) { o.push((n & 0x7f) | 0x80); n >>>= 7; } o.push(n); return o; };
const ld = (field: number, b: Uint8Array) => Uint8Array.from([...vint((field << 3) | 2), ...vint(b.length), ...b]);
const cat = (...xs: Uint8Array[]) => Uint8Array.from(xs.flatMap((x) => [...x]));
const txData = (ret: Hex) => {
  const resp = cat(ld(1, new TextEncoder().encode('id')), Uint8Array.from([0x10, 1]), ld(3, Buffer.from(ret.slice(2), 'hex')), Uint8Array.from([0x20, 5]));
  const any = cat(ld(1, new TextEncoder().encode('/qorechain.crossvm.v1.MsgCrossVMCallResponse')), ld(2, resp));
  return Buffer.from(ld(2, any)).toString('hex').toUpperCase();
};
const fakeTx = (payload: Hex, ret: Hex, over: Record<string, unknown> = {}) => ({
  txhash: 'AB'.repeat(32), height: '100', code: 0, timestamp: '2026-11-22T00:00:00Z', data: txData(ret), events: OK.events,
  tx: { body: { memo: 'pd route prod', messages: [{ '@type': '/qorechain.crossvm.v1.MsgCrossVMCall', sender: 'qor1relayer', target_contract: P.router.toLowerCase(), payload: Buffer.from(payload.slice(2), 'hex').toString('base64') }] } },
  ...over,
});

describe('decodeHybridRelay', () => {
  it('decodes the real relay(V, executeQueued(1)) from Diana', () => {
    const r = decodeHybridRelay(OK, P.router)!;
    expect(r).toMatchObject({ action: 'relay', target: '0xD6b6Fd3D68aD53E8FD6018099A32c01BaB4aa58b', hybridVerified: true, height: 10527710n, memo: 'pd relay executeQueued V#1' });
    expect(r.inner.slice(0, 10)).toBe('0x1eb2149b'); // executeQueued(uint256)
  });
  it('decodes a lazy deployAndRelay(createDrop) with the Pocket and link id from the return value', () => {
    const inner = encodeFunctionData({ abi: VAULT_CALLS, functionName: 'createDrop', args: [P.drop as Hex, H32, 1, 9n, 2n, 3n, 105n, 1n, '0x'] });
    const payload = encodeFunctionData({ abi: routerAbi, functionName: 'deployAndRelay', args: [OWNER, [], 0, 5n, H32, inner] });
    const ret = encodeFunctionResult({ abi: routerAbi, functionName: 'deployAndRelay', result: [POCKET, encodeAbiParameters([{ type: 'uint256' }], [77n])] });
    const r = decodeHybridRelay(fakeTx(payload, ret) as never, P.router)!;
    expect(r).toMatchObject({ action: 'deployAndRelay', target: POCKET, owner: OWNER, result: { pocket: POCKET, linkId: '77' } });
  });
  it('skips failed txs, other contracts and undecodable payloads', () => {
    expect(decodeHybridRelay({ ...OK, code: 14 }, P.router)).toBeNull();
    expect(decodeHybridRelay(OK, P.pool)).toBeNull();
    expect(decodeHybridRelay(fakeTx('0xdeadbeef', '0x') as never, P.router)).toBeNull();
    const noPocket = encodeFunctionData({ abi: routerAbi, functionName: 'deployAndRelay', args: [OWNER, [], 0, 5n, H32, '0x'] });
    expect(decodeHybridRelay(fakeTx(noPocket, '0x') as never, P.router)).toBeNull();
  });
});

const R = (over: Partial<HybridRelay>): HybridRelay => ({ hash: 'H', height: 1n, time: '', sender: 'qor1relayer', memo: '', hybridVerified: true, action: 'relay', target: POCKET, inner: '0x', result: {}, ...over });

describe('eventsOf', () => {
  it('rebuilds every stats event from hybrid relays, reading claim/cancel fields from state', async () => {
    const readLink = vi.fn(async () => ({ recipient: REC, payTo: POCKET, amount: 100n }));
    const relays = [
      R({ height: 1n, action: 'deployAndRelay', owner: OWNER, userSalt: H32, inner: encodeFunctionData({ abi: VAULT_CALLS, functionName: 'createDrop', args: [P.drop as Hex, H32, 0, 9n, 2n, 3n, 105n, 1n, '0x'] }), result: { linkId: '5' } }),
      R({ height: 2n, target: P.drop as Hex, inner: encodeFunctionData({ abi: DROP_CALLS, functionName: 'bind', args: [5n, REC, H32, POCKET, '0x', '0x'] }) }),
      R({ height: 3n, inner: encodeFunctionData({ abi: VAULT_CALLS, functionName: 'confirmDrop', args: [P.drop as Hex, 5n, H32, 1n, '0x'] }) }),
      R({ height: 4n, target: P.drop as Hex, inner: encodeFunctionData({ abi: DROP_CALLS, functionName: 'claim', args: [5n, '0x'] }) }),
      R({ height: 5n, action: 'deployAndRelay', owner: OWNER, inner: encodeFunctionData({ abi: VAULT_CALLS, functionName: 'createPool', args: [P.pool as Hex, H32, 3, 7n, 9n, 1n, '0x'] }), result: { poolId: '8' } }),
      R({ height: 6n, target: P.pool as Hex, inner: encodeFunctionData({ abi: POOL_CALLS, functionName: 'claim', args: [8n, REC, POCKET, '0x', '0x', '0x'] }) }),
      R({ height: 7n, inner: encodeFunctionData({ abi: VAULT_CALLS, functionName: 'cancelDrop', args: [P.drop as Hex, 6n, 1n, '0x'] }) }),
      R({ height: 8n, inner: '0x1eb2149b' + '00'.repeat(31) + '01' as Hex }), // executeQueued: no stats event
    ];
    const ev = await eventsOf('prodV4', relays, new Set(), readLink);
    expect(ev.map((e) => e.eventName)).toEqual(['PocketDeployed', 'LinkCreated', 'LinkBound', 'LinkConfirmed', 'LinkClaimed', 'PoolCreated', 'PoolClaimed', 'LinkCancelled']);
    expect(ev[1].args).toMatchObject({ linkId: 5n, sender: POCKET, amount: 100n, drip: 2n, relayerFee: 3n, mode: 0 });
    expect(ev[3].args).toMatchObject({ linkId: 5n, recipient: REC });
    expect(ev[4].args).toMatchObject({ recipient: REC, payTo: POCKET, amount: 100n });
    expect(ev[5].args).toMatchObject({ poolId: 8n, host: POCKET, slots: 3, perSlot: 7n });
    expect(ev[7].args).toMatchObject({ linkId: 6n, refunded: 100n });
    expect(ev.every((e) => e.lane === 'hybrid')).toBe(true);
  });
  it('never re-deploys a Pocket already seen in logs, and survives state read failures', async () => {
    const relays = [R({ action: 'deployAndRelay', owner: OWNER }), R({ target: P.drop as Hex, inner: encodeFunctionData({ abi: DROP_CALLS, functionName: 'claim', args: [1n, '0x'] }) })];
    const ev = await eventsOf('prodV4', relays, new Set([POCKET.toLowerCase()]), async () => { throw new Error('rpc'); });
    expect(ev.map((e) => e.eventName)).toEqual(['LinkClaimed']);
    expect(ev[0].args.amount).toBeUndefined();
  });
});

describe('mergeHybrid', () => {
  it('appends hybrid events and drops a duplicate Pocket deployment', () => {
    const empty = { PocketDeployed: [{ args: { pocket: POCKET, owner: OWNER }, blockNumber: 1n, transactionHash: '0x1' as Hex }], LinkCreated: [], LinkBound: [], LinkConfirmed: [], LinkClaimed: [], LinkCancelled: [], PoolCreated: [], PoolClaimed: [] };
    const m = mergeHybrid(empty as never, [
      { eventName: 'PocketDeployed', args: { pocket: POCKET }, blockNumber: 2n, transactionHash: 'A' as Hex },
      { eventName: 'LinkCreated', args: { linkId: 1n }, blockNumber: 2n, transactionHash: 'A' as Hex },
      { eventName: 'Nope', args: {}, blockNumber: 2n, transactionHash: 'A' as Hex },
    ]);
    expect(m.PocketDeployed).toHaveLength(1);
    expect(m.LinkCreated).toHaveLength(1);
    expect(empty.LinkCreated).toHaveLength(0); // input untouched
  });
});

describe('searchRouterTxs / hybridRelays', () => {
  it('pages the crossvm_request search until the total is reached, then caches', async () => {
    const page = (n: number) => Array.from({ length: n }, () => OK);
    const f = vi.fn(async (url: string) => new Response(JSON.stringify({ tx_responses: url.includes('page=1&') ? page(2) : page(1), total: '3' })));
    const txs = await searchRouterTxs('http://rest', P.router, f as never, 2);
    expect(txs).toHaveLength(3);
    expect(decodeURIComponent(f.mock.calls[0][0])).toContain(`crossvm_request.target_contract='${P.router.toLowerCase()}'`);
    clearXvmCache();
    const g = vi.fn(async () => new Response(JSON.stringify({ tx_responses: [OK], total: '1' })));
    expect(await hybridRelays('prodV4', 'http://rest/', g as never)).toHaveLength(1);
    await hybridRelays('prodV4', 'http://rest/', g as never);
    expect(g).toHaveBeenCalledTimes(1);
    await expect(searchRouterTxs('http://rest', P.router, (async () => new Response('x', { status: 500 })) as never)).rejects.toThrow(/HTTP 500/);
    expect(jsonSafe({ a: 1n })).toEqual({ a: '1' });
  });
});

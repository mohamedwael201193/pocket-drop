import { describe, expect, it, vi } from 'vitest';
import { encodeFunctionData, getAddress, parseAbi, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { routerAbi } from '../src/abi4.js';
import { classify, getQday, hybridAttempts, handleAttempt, listRefusals, loadQdayConfig, markerOf, MARKERS, noteRouteRefusal, publishedKeys, resetQdayCache, type Chain } from '../src/qday.js';
import { MemoryLimiter } from '../src/ratelimit.js';
import { setSink } from '../src/log.js';
import type { Relayer } from '../src/relayer.js';
import { ADDR, CONTRACT, cfg } from './helpers.js';

setSink(() => {});
const qcfg = loadQdayConfig();
const B1 = qcfg.baits.find((b) => b.id === 'B1')!;
const VAULT = parseAbi(['function spend(address,uint256,uint256,bytes)']);
const spendData = encodeFunctionData({ abi: VAULT, functionName: 'spend', args: [ADDR, 1n, 0n, '0x1234'] });
const relayData = encodeFunctionData({ abi: routerAbi, functionName: 'relay', args: [B1.pocket, spendData] });
const HASH = ('0x' + 'ef'.repeat(32)) as Hex;

describe('qday config', () => {
  it('has five baits, each with an independent key hash and a deployed or counterfactual Pocket', () => {
    expect(qcfg.baits.map((b) => b.id)).toEqual(['B1', 'B2', 'B3', 'B4', 'B5']);
    expect(new Set(qcfg.baits.map((b) => b.ownerKeyHash)).size).toBe(5);
    expect(JSON.stringify(qcfg)).not.toMatch(/"(secp|pq|root|classicalKey)"/);
  });
});

describe('publishedKeys', () => {
  const k = ('0x' + '22'.repeat(32)) as Hex;
  const fake = [{ ...B1, keyAccount: privateKeyToAccount(k).address }];
  it('serves nothing unless QDAY_PUBLISH_KEYS is exactly true', () => {
    expect(publishedKeys({ QDAY_BAIT_KEYS: JSON.stringify({ B1: k }) }, fake)).toBeNull();
    expect(publishedKeys({ QDAY_PUBLISH_KEYS: 'false', QDAY_BAIT_KEYS: JSON.stringify({ B1: k }) }, fake)).toBeNull();
    expect(publishedKeys({ QDAY_PUBLISH_KEYS: 'true', QDAY_BAIT_KEYS: JSON.stringify({ B1: k }) }, fake)).toEqual({ B1: k });
  });
  it('never serves a key that does not belong to the bait key account', () => {
    expect(publishedKeys({ QDAY_PUBLISH_KEYS: 'true', QDAY_BAIT_KEYS: JSON.stringify({ B1: '0x' + '33'.repeat(32) }) }, fake)).toEqual({});
    expect(publishedKeys({ QDAY_PUBLISH_KEYS: 'true', QDAY_BAIT_KEYS: 'not json' }, fake)).toBeNull();
  });
});

describe('classify + markers', () => {
  it('maps router relays to a bait and its call', () => {
    expect(classify(qcfg.router, relayData, qcfg)).toEqual({ bait: 'B1', call: 'spend' });
    expect(classify(qcfg.router, encodeFunctionData({ abi: routerAbi, functionName: 'relay', args: [CONTRACT, spendData] }), qcfg)).toBeNull();
    expect(classify(B1.pocket, spendData, qcfg)).toEqual({ bait: 'B1', call: 'spend' });
  });
  it('maps a claim on the B4 drop link only', () => {
    const DROP = parseAbi(['function claim(uint256,bytes)']);
    const link = (qcfg.baits.find((b) => b.id === 'B4')!.planned as any).drop.linkId;
    expect(classify(qcfg.drop, encodeFunctionData({ abi: DROP, functionName: 'claim', args: [BigInt(link), '0x12'] }), qcfg)).toEqual({ bait: 'B4', call: 'drop.claim' });
    expect(classify(qcfg.drop, encodeFunctionData({ abi: DROP, functionName: 'claim', args: [999999n, '0x12'] }), qcfg)).toBeNull();
  });
  it('reads the bot and try-it markers from the input tail', () => {
    expect(markerOf(relayData + MARKERS.bot.slice(2))).toBe('bot');
    expect(markerOf(relayData + MARKERS.try.slice(2))).toBe('try');
    expect(markerOf(relayData)).toBeNull();
  });
  it('records a /api/route refusal only when it targets a bait', () => {
    const n = listRefusals().length;
    noteRouteRefusal(encodeFunctionData({ abi: routerAbi, functionName: 'relay', args: [CONTRACT, spendData] }), qcfg.router, 'BadSignature');
    expect(listRefusals().length).toBe(n);
    noteRouteRefusal(relayData, qcfg.router, 'BadSignature');
    expect(listRefusals()[0]).toMatchObject({ bait: 'B1', call: 'spend', error: 'BadSignature', via: 'route' });
  });
});

function relayer(over: Partial<Relayer> = {}): Relayer {
  return {
    address: ADDR, contract: CONTRACT as any,
    simulate: vi.fn(async () => ({ ok: false as const, revert: { name: 'BadSignature', message: 'bad', selector: '0x', known: true } as any })),
    estimate: vi.fn(async () => 400_000n),
    send: vi.fn(async () => ({ ok: true as const, hash: HASH, status: 'reverted' as const, blockNumber: 1n, gasUsed: 225_000n })),
    ...over,
  } as Relayer;
}

describe('handleAttempt', () => {
  const base = (r: Relayer, extra = {}) => ({ cfg: cfg(), limiter: new MemoryLimiter(), relayer: r, qcfg, env: {}, botToken: 'tok', ...extra });
  it('mines a reverting attempt with the try-it marker and tight gas', async () => {
    const r = relayer();
    const out = await handleAttempt({ to: qcfg.router, data: relayData }, '1.1.1.1', base(r));
    expect(out.status).toBe(200);
    expect((r.send as any).mock.calls[0][0]).toBe(relayData + MARKERS.try.slice(2));
    expect((r.send as any).mock.calls[0][1]).toBe(450_000n);
    expect((out.body as any).expectedRevert).toBe('BadSignature');
  });
  it('uses the bot marker only with the bot token', async () => {
    const r = relayer();
    await handleAttempt({ to: qcfg.router, data: relayData, botToken: 'tok' }, '1.1.1.1', base(r));
    expect((r.send as any).mock.calls[0][0]).toBe(relayData + MARKERS.bot.slice(2));
  });
  it('never sends a call that would succeed', async () => {
    const r = relayer({ simulate: vi.fn(async () => ({ ok: true as const })) });
    const out = await handleAttempt({ to: qcfg.router, data: relayData }, '1.1.1.1', base(r));
    expect(out.status).toBe(409);
    expect(r.send).not.toHaveBeenCalled();
    expect(listRefusals()[0].error).toMatch(/WOULD SUCCEED/);
  });
  it('rejects non-bait targets, non-router destinations and bad hex', async () => {
    const r = relayer();
    expect((await handleAttempt({ to: qcfg.router, data: encodeFunctionData({ abi: routerAbi, functionName: 'relay', args: [CONTRACT, spendData] }) }, 'x', base(r))).status).toBe(400);
    expect((await handleAttempt({ to: CONTRACT, data: relayData }, 'x', base(r))).status).toBe(400);
    expect((await handleAttempt({ to: qcfg.router, data: 'zz' }, 'x', base(r))).status).toBe(400);
    expect(r.send).not.toHaveBeenCalled();
  });
  it('limits visitors to three on-chain attempts per hour', async () => {
    const d = base(relayer());
    for (let i = 0; i < 3; i++) expect((await handleAttempt({ to: qcfg.router, data: relayData }, '9.9.9.9', d)).status).toBe(200);
    expect((await handleAttempt({ to: qcfg.router, data: relayData }, '9.9.9.9', d)).status).toBe(429);
  });
});

function chain(over: Partial<Chain> = {}): Chain {
  return {
    getBalance: async (a) => (a.toLowerCase() === B1.pocket.toLowerCase() ? 2n * 10n ** 17n : 2n * 10n ** 17n),
    call: async () => '0x' as Hex, getLogs: async () => [], getTx: async () => null, getCode: async () => '0x6001' as Hex,
    readNonce: async () => 0n, windowLive: async () => false, txSearch: async () => [], botRuns: async () => [], ...over,
  };
}

describe('getQday', () => {
  it('hides keys by default and raises no alarm on a quiet chain', async () => {
    resetQdayCache();
    const s: any = await getQday(chain(), {}, qcfg, 1);
    expect(s.keysPublished).toBe(false);
    expect(s.baits.every((b: any) => b.classicalKey === null)).toBe(true);
    expect(s.alarm.reasons.filter((r: string) => !/key changed/.test(r))).toEqual([]);
    expect(s.log.teamBot.label).toMatch(/OURS/);
  });
  it('raises the alarm when a window opens, a balance drops, or a stranger succeeds', async () => {
    resetQdayCache();
    const stranger = '0x000000000000000000000000000000000000dEaD';
    const s: any = await getQday(chain({
      windowLive: async (c) => c === B1.keyAccountCosmos,
      getBalance: async (a) => (a.toLowerCase() === B1.pocket.toLowerCase() ? 0n : 2n * 10n ** 17n),
      txSearch: async (q) => (q.includes(getAddress(qcfg.router)) ? [{ height: String(qcfg.fromBlock + 10), events: [{ type: 'ethereum_tx', attributes: [{ key: 'ethereumTxHash', value: HASH }] }, { type: 'ethereum_tx', attributes: [{ key: 'ethereumTxHash', value: HASH }, { key: 'recipient', value: qcfg.router }] }] }] : []),
      getTx: async () => ({ input: relayData, from: stranger, to: qcfg.router }),
      receiptOk: async () => true,
    }), {}, qcfg, 2);
    const r = s.alarm.reasons.join('\n');
    expect(s.alarm.raised).toBe(true);
    expect(r).toMatch(/B1: an EVM window is live/);
    expect(r).toMatch(/B1: Pocket balance dropped/);
    expect(r).toMatch(/SUCCEEDED/);
    expect(s.log.onChain.rows[0]).toMatchObject({ bait: 'B1', call: 'spend', source: 'anyone', failed: false });
  });
  it('trusts the receipt over a missing failure attribute (no false breach)', async () => {
    resetQdayCache();
    const s: any = await getQday(chain({
      txSearch: async (q) => (q.includes(getAddress(qcfg.router)) ? [{ height: String(qcfg.fromBlock + 10), events: [{ type: 'ethereum_tx', attributes: [{ key: 'ethereumTxHash', value: HASH }, { key: 'recipient', value: qcfg.router }] }] }] : []),
      getTx: async () => ({ input: relayData, from: '0x000000000000000000000000000000000000dEaD' as any, to: qcfg.router }),
      receiptOk: async () => false,
    }), {}, qcfg, 4);
    expect(s.alarm.raised).toBe(false);
    expect(s.log.onChain.rows[0]).toMatchObject({ failed: true, source: 'anyone' });
  });
  it('sorts marked attempts into the team-bot and try-it columns', async () => {
    resetQdayCache();
    const s: any = await getQday(chain({
      txSearch: async (q) => (q.includes(getAddress(qcfg.router)) ? [{ height: String(qcfg.fromBlock + 10), events: [{ type: 'ethereum_tx', attributes: [{ key: 'ethereumTxHash', value: HASH }] }, { type: 'ethereum_tx', attributes: [{ key: 'ethereumTxHash', value: HASH }, { key: 'recipient', value: qcfg.router }, { key: 'ethereumTxFailed', value: 'execution reverted' }] }] }] : []),
      getTx: async () => ({ input: (relayData + MARKERS.bot.slice(2)) as Hex, from: ADDR as any, to: qcfg.router }),
    }), {}, qcfg, 3);
    expect(s.log.teamBot.rows).toHaveLength(1);
    expect(s.log.onChain.rows).toHaveLength(0);
    expect(s.alarm.reasons.join()).not.toMatch(/SUCCEEDED/);
  });
  it('gives EVM rows the time of their block, so every refused row shows time and block', async () => {
    resetQdayCache();
    const asked: number[] = [];
    const s: any = await getQday(chain({
      txSearch: async (q) => (q.includes(getAddress(qcfg.router)) ? [{ height: String(qcfg.fromBlock + 10), events: [{ type: 'ethereum_tx', attributes: [{ key: 'ethereumTxHash', value: HASH }, { key: 'recipient', value: qcfg.router }, { key: 'ethereumTxFailed', value: 'execution reverted' }] }] }] : []),
      getTx: async () => ({ input: (relayData + MARKERS.bot.slice(2)) as Hex, from: ADDR as any, to: qcfg.router }),
      blockTime: async (h) => { asked.push(h); return '2026-11-22T05:00:00.000Z'; },
    }), {}, qcfg, 4);
    expect(s.log.teamBot.rows[0]).toMatchObject({ height: qcfg.fromBlock + 10, time: '2026-11-22T05:00:00.000Z' });
    expect(asked).toEqual([qcfg.fromBlock + 10]);
  });
  it('finds bait attempts relayed on the hybrid lane (no EVM tx), failed ones included, and sorts them by marker', async () => {
    resetQdayCache();
    const nat = (hash: string, data: Hex, code: number, height = qcfg.fromBlock + 20) => ({
      txhash: hash, height: String(height), code, raw_log: code ? 'failed to execute message; message index: 0: execution reverted: EVM contract execution failed' : '', timestamp: '2026-11-22T03:40:00Z',
      tx: { body: { memo: 'pd qday', messages: [{ '@type': '/qorechain.crossvm.v1.MsgCrossVMCall', sender: 'qor1relayer', target_contract: qcfg.router.toLowerCase(), payload: Buffer.from(data.slice(2), 'hex').toString('base64') }] } },
      events: [{ type: 'pqc_hybrid_verify', attributes: [{ key: 'status', value: 'verified' }] }],
    });
    const txs = [
      nat('AA'.repeat(32), (relayData + MARKERS.bot.slice(2)) as Hex, 14),
      nat('BB'.repeat(32), (relayData + MARKERS.try.slice(2)) as Hex, 14, qcfg.fromBlock + 30),
      nat('CC'.repeat(32), encodeFunctionData({ abi: routerAbi, functionName: 'relay', args: [ADDR, spendData] }), 0), // not a bait
      nat('DD'.repeat(32), relayData, 14, qcfg.fromBlock - 5), // before the drill
    ];
    const rows = hybridAttempts(txs as never, qcfg);
    expect(rows.map((r) => [r.tx.slice(0, 4), r.source, r.failed, r.lane, r.hybridVerified, r.error])).toEqual([
      ['AAAA', 'team-bot', true, 'hybrid', true, 'execution reverted'], ['BBBB', 'try-it', true, 'hybrid', true, 'execution reverted'],
    ]);
    const s: any = await getQday(chain({ relayerNativeTxs: async () => txs as never }), {}, qcfg, 5);
    expect(s.log.teamBot.rows[0]).toMatchObject({ tx: 'AA'.repeat(32), lane: 'hybrid', bait: 'B1', call: 'spend' });
    expect(s.log.onChain.rows[0]).toMatchObject({ tx: 'BB'.repeat(32), source: 'try-it', failed: true });
    expect(s.alarm.raised).toBe(false);
  });
  it('a hybrid-lane attempt by a stranger that succeeded raises the alarm', async () => {
    resetQdayCache();
    const t = { txhash: 'EE'.repeat(32), height: String(qcfg.fromBlock + 9), code: 0, tx: { body: { messages: [{ '@type': '/qorechain.crossvm.v1.MsgCrossVMCall', sender: 'qor1x', target_contract: qcfg.router, payload: Buffer.from(relayData.slice(2), 'hex').toString('base64') }] } } };
    const s: any = await getQday(chain({ relayerNativeTxs: async () => [t] as never }), {}, qcfg, 6);
    expect(s.alarm.reasons.join()).toMatch(/SUCCEEDED/);
  });
});

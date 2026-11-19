import { describe, expect, it, vi } from 'vitest';
import { ApiError, RELAYER_PAUSED, explainError, fetchHealth } from '../src/lib/api';
import { parseClaimInput } from '../src/pages/ReceivePage';

describe('relayer window expiry message', () => {
  it('says the window expired and that funds are safe and still in escrow', () => {
    const m = explainError(new ApiError('RelayerWindowUnavailable', 'closed', 503));
    expect(m).toBe(RELAYER_PAUSED);
    expect(m).toMatch(/window has expired/i);
    expect(m).toMatch(/safe and still in escrow/i);
    expect(m).toMatch(/retry/i);
  });
  it('treats an unknown 503 as the same outage, but keeps other errors specific', () => {
    expect(explainError(new ApiError('HttpError', 'HTTP 503', 503))).toBe(RELAYER_PAUSED);
    expect(explainError(new ApiError('BadLinkSignature', 'x', 422))).toMatch(/link key does not match/i);
  });
});

describe('fetchHealth', () => {
  it('returns the body of a 503 (window closed) instead of throwing', async () => {
    const body = { ok: false, network: 'diana-testnet', headBlock: '1', relayer: null, window: { queryable: true, live: false, remainingBlocks: '0' }, warning: { level: 'expired', message: 'm' } };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status: 503 })));
    const h = await fetchHealth();
    expect(h.window.live).toBe(false);
    expect(h.warning?.level).toBe('expired');
    vi.unstubAllGlobals();
  });
});

describe('parseClaimInput', () => {
  const k = 'a'.repeat(64);
  it('accepts full links and bare paths, rejects links without a key', () => {
    expect(parseClaimInput(`https://pocketdrop-app.vercel.app/c/17#k=${k}`)).toBe(`/c/17#k=${k}`);
    expect(parseClaimInput(`  /c/3#k=${k.toUpperCase()} `)).toBe(`/c/3#k=${k}`);
    expect(parseClaimInput('https://pocketdrop-app.vercel.app/c/17')).toBeNull();
    expect(parseClaimInput(`/c/x#k=${k}`)).toBeNull();
  });
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import LandingPage from '../src/landing/LandingPage';
import Rest from '../src/landing/Rest';
import { LiveCtx, SNAPSHOT, derive } from '../src/landing/live';
import { COUNTS, FOUNDRY, REVERIFY, TXS } from '../src/landing/data/recorded';
import v4 from '../src/data/v4.json';
import tests from '../src/data/tests.json';

// react-router's Link uses useLayoutEffect, which only warns under renderToString; keep the test output readable.
const consoleError = console.error.bind(console);
console.error = (...a: unknown[]) => { if (!String(a[0]).includes('useLayoutEffect does nothing on the server')) consoleError(...a); };
const html = (el: ReturnType<typeof createElement>) => renderToString(createElement(MemoryRouter, { initialEntries: ['/'] }, el));
const text = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');

describe('landing renders with the API down', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch')))); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('the first screen renders and labels its numbers as a recorded snapshot', () => {
    const h = html(createElement(LandingPage));
    expect(h).toContain('data-testid="landing"');
    expect(text(h)).toContain('Send QOR by link.');
    expect(text(h)).toContain('Recorded snapshot');
    expect(text(h)).not.toMatch(/NaN|undefined/);
  });
  it('the rest of the page renders from recorded data, every number labelled', () => {
    const h = html(createElement(LiveCtx.Provider, { value: SNAPSHOT }, createElement(Rest)));
    const t = text(h);
    expect(t).toContain(`${REVERIFY.passed} passed, ${REVERIFY.failed} failed`);
    expect(t).not.toMatch(/NaN|undefined/);
    for (const label of ['Recorded', 'Illustration']) expect(t).toContain(label);
  });
  it('the bait key is never in the bundle: without the API it shows placeholders', () => {
    const h = html(createElement(LiveCtx.Provider, { value: SNAPSHOT }, createElement(Rest)));
    expect(SNAPSHOT.baits.every((b) => !b.classicalKey)).toBe(true);
    expect(text(h)).toContain('loads from the API');
    const src = readFileSync(resolve(__dirname, '../src/landing/sections/Break.tsx'), 'utf8');
    expect(src).not.toMatch(/[0-9a-f]{64}/i);
  });
  it('a live API answer switches the source to live', () => {
    const live = derive({ ok: true, headBlock: '123', relay: { mode: 'hybrid', classicalPathOpen: false } }, { v4: { prod: { pockets: 2, drops: { claimed: 1, created: 3 }, pools: { created: 1, slotsClaimed: 4 } } } }, { baits: [] }, 'live', 'now');
    expect(live).toMatchObject({ source: 'live', headBlock: 123, relayHybrid: true, classicalOpen: false, pockets: 2, linksClaimed: 1, slotsClaimed: 4 });
  });
});

describe('recorded numbers on the landing match their sources', () => {
  it('Foundry count equals data/v4.json', () => {
    expect(FOUNDRY.passed).toBe(v4.tests.passed);
    expect(FOUNDRY.failed).toBe(v4.tests.failed);
  });
  it('app + API unit tests come from data/tests.json', () => {
    expect(COUNTS.appTests).toBe(tests.frontend.passed + tests.backend.passed);
  });
  it('real-crypto and live-precompile counts match the test files', () => {
    const count = (f: string) => (readFileSync(resolve(__dirname, '../../contracts-v4', f), 'utf8').match(/function test/g) ?? []).length;
    const real = count('test-real/RealCrypto.t.sol');
    expect(COUNTS.realCrypto).toBe(real);
    expect(COUNTS.livePrecompile).toBe(real + count('test-live/LiveDiana.t.sol'));
  });
  it('the reverify receipt adds up', () => {
    expect(REVERIFY.failed).toBe(0);
    expect(REVERIFY.evm + REVERIFY.cosmos).toBeLessThanOrEqual(REVERIFY.passed);
  });
  it('every transaction hash on the landing is one the repo already records', () => {
    const known = readFileSync(resolve(__dirname, '../src/data/requirements.ts'), 'utf8') + JSON.stringify(v4);
    expect(TXS.length).toBeGreaterThan(10);
    for (const t of TXS) expect(known.toLowerCase(), t.what).toContain(t.hash.toLowerCase());
  });
});

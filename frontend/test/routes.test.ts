import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createRoutesFromChildren, matchRoutes, type RouteObject } from 'react-router-dom';
import type { ReactElement } from 'react';
import { AppRoutes } from '../src/App';
import { TABS } from '../src/components/Layout';
import { SAMPLE_PATH, APP_PATH } from '../src/landing/links';
import { PUBLIC_POOL_PATH } from '../src/lib/publicPool';

const table: RouteObject[] = createRoutesFromChildren((AppRoutes() as ReactElement<{ children: unknown }>).props.children as never);
const leaf = (path: string) => {
  const m = matchRoutes(table, path);
  if (!m) throw new Error(`no route for ${path}`);
  return m[m.length - 1];
};
const pattern = (path: string) => leaf(path).route.path;
const redirect = (path: string) => (leaf(path).route.element as ReactElement<{ to?: string }>).props.to;
/** true when the matched route sits inside the dashboard shell (the layout route has no path). */
const inShell = (path: string) => (matchRoutes(table, path) ?? []).length > 1;

describe('route table: landing at /, dashboard at /app', () => {
  it('/ is the landing and is not inside the dashboard shell', () => {
    expect(pattern('/')).toBe('/');
    expect(inShell('/')).toBe(false);
  });
  it('/app is the dashboard Overview inside the shell', () => {
    expect(pattern('/app')).toBe('/app');
    expect(inShell('/app')).toBe(true);
    expect(APP_PATH).toBe('/app');
  });
  it('old dashboard-root links redirect sensibly', () => {
    expect(redirect('/about')).toBe('/');
    expect(redirect('/overview')).toBe('/app');
    expect(redirect('/dashboard')).toBe('/send');
    expect(redirect('/claim')).toBe('/receive');
    expect(redirect('/stats')).toBe('/radar');
  });
  it('every existing deep link still resolves to its page inside the shell', () => {
    const deep: [string, string][] = [
      ['/send', '/send'], ['/send/inbox', '/send/inbox'], ['/receive', '/receive'],
      ['/c/12', '/c/:id'], ['/c/p12', '/c/:id'], ['/c/l3', '/c/:id'], ['/c/q7', '/c/:id'], ['/c/k2', '/c/:id'],
      ['/pool/p14', '/pool/:id'], ['/pool/s5', '/pool/:id'], ['/pocket', '/pocket'], ['/proof', '/proof'], ['/proof/testers', '/proof/testers'], ['/lab', '/lab'], ['/radar', '/radar'],
      ['/judges', '/judges'], ['/qday', '/qday'], ['/check', '/check'], ['/check/0xabc', '/check/:hash'],
    ];
    for (const [url, pat] of deep) {
      expect(pattern(url), url).toBe(pat);
      expect(inShell(url), url).toBe(true);
    }
  });
  it('/claim/<id> is an alias of /c/<id>, outside the shell so it redirects first', () => {
    expect(pattern('/claim/p12')).toBe('/claim/:id');
    expect(inShell('/claim/p12')).toBe(false);
  });
  it('unknown paths fall to the not-found page inside the shell', () => {
    expect(pattern('/nope/at/all')).toBe('*');
  });
  it('/pool (no id) is a real page inside the shell, not a 404', () => {
    expect(pattern('/pool')).toBe('/pool');
    expect(inShell('/pool')).toBe(true);
  });
  it('the landing “Claim a sample slot” goes to /pool, which resolves the current public pool', () => {
    expect(SAMPLE_PATH).toBe(PUBLIC_POOL_PATH);
    expect(SAMPLE_PATH).toBe('/pool');
    expect(pattern(SAMPLE_PATH)).toBe('/pool');
  });
  it('every app path mentioned in requirements.ts and proofs.ts has a route', () => {
    const src = ['requirements.ts', 'proofs.ts'].map((f) => readFileSync(resolve(__dirname, '../src/data', f), 'utf8')).join('\n');
    const paths = [...src.matchAll(/[ '"`(](\/(?:c|pool|qday|check|judges|proof|lab|radar|pocket|receive|send|about|claim|app)(?:\/[A-Za-z0-9_-]+)?)(?=[^A-Za-z0-9_/-])/g)].map((m) => m[1]);
    expect(paths.length).toBeGreaterThan(0);
    for (const p of paths) expect(pattern(p), p).not.toBe('*');
  });
  it('the dashboard keeps exactly four primary tabs', () => {
    expect(TABS.map((t) => t.to)).toEqual(['/send', '/receive', '/pocket', '/proof']);
  });
});

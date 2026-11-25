import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));

describe('content security policy', () => {
  const csp = (JSON.parse(fs.readFileSync('vercel.json', 'utf8')) as { headers: { headers: { key: string; value: string }[] }[] }).headers
    .flatMap((h) => h.headers).find((h) => h.key === 'Content-Security-Policy')!.value;
  it('keeps inline styles and scripts blocked', () => {
    expect(csp).toMatch(/style-src 'self'/);
    expect(csp).not.toMatch(/unsafe-inline/);
  });
  it('uses no framer-motion feature that injects a <style> element (blocked by that CSP)', () => {
    const hits = walk('src').filter((f) => /\.(tsx?|css)$/.test(f) && /mode=["{]+.?popLayout/.test(fs.readFileSync(f, 'utf8')));
    expect(hits).toEqual([]);
  });
});

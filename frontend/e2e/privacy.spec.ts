// Deployed-site checks that cost nothing: link previews work without the fragment, and the seed in #fragment is never
// sent in any request (including the Referer of sub-requests). Uses an existing (already claimed) link id with a random seed.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const URL = process.env.E2E_URL ?? 'https://pocketdrop-app.vercel.app';
const EVID = path.resolve('evidence');

test('og: tags are served without any fragment, and the fragment is never requested', async ({ page, request, browserName }) => {
  // 1. What WhatsApp's preview crawler gets: the HTML of /c/1 with no fragment.
  const res = await request.get(`${URL}/c/1`);
  const html = await res.text();
  const tag = (p: string) => new RegExp(`<meta[^>]+(?:property|name)="${p}"[^>]+content="([^"]*)"`).exec(html)?.[1];
  const og = { title: tag('og:title'), description: tag('og:description'), image: tag('og:image'), type: tag('og:type'), twitterCard: tag('twitter:card') };
  expect(og.title).toBeTruthy();
  expect(og.image).toMatch(/^https:\/\/.+\/og\.png$/);
  const img = await request.get(og.image!);
  expect(img.status()).toBe(200);
  expect(img.headers()['content-type']).toContain('image/png');
  const size = (await img.body()).length;

  // 2. In a real browser: open /c/1#k=<random seed> and collect every request URL and referer.
  const seed = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('');
  const seen: string[] = [];
  page.on('request', (r) => { seen.push(r.url(), r.headers()['referer'] ?? ''); });
  await page.goto(`${URL}/c/1#k=${seed}`, { waitUntil: 'networkidle' });
  await expect(page.getByTestId('claim-page')).toBeVisible();
  const leaked = seen.filter((u) => u.includes(seed) || u.includes('#k='));
  expect(leaked).toEqual([]);

  fs.writeFileSync(path.join(EVID, `privacy-${browserName}.json`), JSON.stringify({
    url: URL, ogTags: og, ogImageBytes: size, requestsObserved: seen.filter(Boolean).length, requestsContainingSeedOrFragment: leaked.length,
  }, null, 1));
});

// Gaps closed on 22 Nov 2026 (RESCORE items 2-6): v3 hybrid claims in /api/stats, current API names on the landing cards,
// and the smaller UX items. Runs against the deployed app and API.
import { test, expect } from './fixtures';
const BASE = process.env.E2E_URL || 'https://pocketdrop-app.vercel.app';
const API = process.env.E2E_API || 'https://pocketdrop-api.vercel.app';

test('/api/stats counts v3 link #29, which was bound and claimed through hybrid relays', async ({ request }) => {
  const r = await request.get(`${API}/api/stats`, { timeout: 90_000 });
  expect(r.ok()).toBeTruthy();
  const s = await r.json();
  const rows = s.v3.recent as { kind: string; linkId: string; txHash: string; lane?: string }[];
  expect(rows).toContainEqual(expect.objectContaining({ kind: 'claimed', linkId: '29', txHash: 'CAFECB9ABD82E5715DAE1EB721D8332E10631370F62A15F26384825EAB98F71C', lane: 'hybrid' }));
  expect(s.v3.hybridRelayEvents).toBeGreaterThanOrEqual(2);
});

test('the landing technical cards name the current API and contract calls', async ({ page }) => {
  await page.goto(BASE);
  await page.getByTestId('landing-tech').locator('summary').click();
  const deck = page.getByTestId('stacked-deck');
  await deck.scrollIntoViewIfNeeded();
  const seen: string[] = [];
  for (let i = 0; i < 3; i++) {
    seen.push((await page.getByTestId('stack-desc').innerText()).trim());
    await deck.click();
  }
  const all = seen.join(' | ');
  expect(all).toContain('POST /api/route');
  expect(all).toContain('PocketDrop.confirmRecipient');
  expect(all).toContain('PocketDrop.claim');
  expect(all).not.toContain('/api/bind');
  expect(all).not.toContain('PoP Account');
});

test('a claimed link shows the same screen with or without its key', async ({ page }) => {
  const read = async (url: string) => {
    await page.goto(url);
    await expect(page.getByTestId('link-dead')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('incoming-amount')).not.toContainText('…');
    return { notice: (await page.getByTestId('link-dead').innerText()).trim(), amount: (await page.getByTestId('incoming-amount').innerText()).trim(), h1: (await page.locator('h1').first().innerText()).trim() };
  };
  const bare = await read(`${BASE}/c/p12`);
  const keyed = await read(`${BASE}/c/p12#k=badkey`);
  expect(bare).toEqual(keyed);
  expect(bare.h1).toBe('This link is already claimed');
  await expect(page.getByTestId('no-key')).toHaveCount(0);
});

test('every refused Q-Day row shows its time and its block (or that it was never mined)', async ({ page }) => {
  await page.goto(`${BASE}/qday`);
  const rows = page.getByTestId('qday-row-when');
  await expect(rows.first()).toBeVisible({ timeout: 90_000 });
  const all = await rows.allInnerTexts();
  expect(all.length).toBeGreaterThan(0);
  for (const t of all) expect(t).toMatch(/^.+ · (block [\d,]+|not mined)$/);
  expect(all.filter((t) => /block/.test(t) && t.startsWith('time not recorded'))).toEqual([]);
});

test('/lab: long lists fold on a phone and stay open on a wide screen', async ({ page }) => {
  await page.goto(`${BASE}/lab`);
  const phone = (page.viewportSize()?.width ?? 1440) < 640;
  const list = page.getByTestId('attack-list');
  const stolen = page.getByTestId('stolen-rows');
  if (!phone) {
    await expect(list).toBeVisible();
    await expect(stolen).toBeVisible();
    await expect(page.getByTestId('attack-fold').locator('summary')).toBeHidden();
    return;
  }
  await expect(list).toBeHidden();
  await expect(stolen).toBeHidden();
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  expect(h).toBeLessThan(5000);
  await page.getByTestId('attack-fold').locator('summary').click();
  await expect(list).toBeVisible();
  await expect(list.getByTestId('attack-row').first()).toBeVisible();
  await page.getByTestId('stolen-fold').locator('summary').click();
  await expect(stolen).toBeVisible();
});

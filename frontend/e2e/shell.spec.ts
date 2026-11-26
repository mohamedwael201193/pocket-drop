// The sidebar dashboard shell and the Overview wiring (read-only, spends nothing).
//   E2E_URL=https://pocket-drop.vercel.app npx playwright test e2e/shell.spec.ts
import fs from 'node:fs';
import { test, expect } from './fixtures';

const BASE = process.env.E2E_URL || 'https://pocket-drop.vercel.app';
const API = process.env.E2E_API || 'https://pocket-drop-api.vercel.app';
const noSideScroll = async (page: import('@playwright/test').Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width + 1);

test('shell: the primary navigation is Send, Receive, Pocket, Proof; the rest sits under Verify or More', async ({ page }) => {
  await page.goto(`${BASE}/app`);
  await expect(page).toHaveTitle('Overview · Pocket Drop');
  await expect(page.getByTestId('logo')).toBeVisible();
  const mobile = page.viewportSize()!.width < 768;
  if (mobile) {
    for (const k of ['send', 'receive', 'pocket', 'proof', 'more']) await expect(page.getByTestId(`tab-${k}`)).toBeVisible();
    await expect(page.getByTestId('sidebar')).toHaveCount(0);
    await page.getByTestId('tab-more').click();
    await expect(page.getByTestId('more-sheet')).toBeVisible();
    await page.getByTestId('more-qday').click();
    await expect(page).toHaveURL(/\/qday$/);
    await expect(page.getByTestId('tab-proof')).toHaveAttribute('aria-current', 'page');
  } else {
    await expect(page.getByTestId('sidebar')).toBeVisible();
    await expect(page.getByTestId('tabbar')).toHaveCount(0);
    await expect(page.getByTestId('nav-overview')).toHaveAttribute('aria-current', 'page');
    await page.getByTestId('nav-send').click();
    await expect(page).toHaveURL(/\/send$/);
    await expect(page.getByTestId('nav-send')).toHaveAttribute('aria-current', 'page');
    await page.getByTestId('side-check').click();
    await expect(page.getByTestId('check-page')).toBeVisible();
    await expect(page.getByTestId('side-block')).toContainText(/\d{1,3}(,\d{3})+/, { timeout: 60_000 });
  }
  await expect(page.locator('[data-testid=nav-qday], [data-testid=tab-qday]')).toHaveCount(0);
  await noSideScroll(page);
});

test('overview: every card carries a source label and the numbers match the live API', async ({ page, request }) => {
  const [h, s] = await Promise.all([request.get(`${API}/api/health`).then((r) => r.json()), request.get(`${API}/api/stats`).then((r) => r.json())]);
  await page.goto(`${BASE}/app`);
  await expect(page.getByTestId('overview')).toBeVisible();
  for (const id of ['ov-safety', 'ov-proof', 'ov-activity', 'ov-relayer']) await expect(page.getByTestId(id)).toContainText('LIVE');
  await expect(page.getByTestId('ov-tests')).toContainText('RECORDED');
  await expect(page.getByTestId('ov-pocket-empty')).toBeVisible(); // a fresh browser holds no key
  await expect(page.getByTestId('ov-check-hybrid')).toHaveAttribute('data-state', h.relay?.mode === 'hybrid' ? 'ok' : 'no', { timeout: 60_000 });
  await expect(page.getByTestId('ov-check-registered')).toHaveAttribute('data-state', 'nokey');
  if (h.relay?.mode === 'hybrid') { // a fresh browser: 1 of 3, never 100%
    await expect(page.getByTestId('ov-gauge')).toHaveAttribute('data-pct', '33');
    await expect(page.getByTestId('ov-gauge-ratio')).toHaveText('1 of 3');
  }
  await expect(page.getByTestId('ov-create-key')).toHaveAttribute('href', '/send');
  const hy = [s.v4?.prod?.hybridRelayEvents, s.v4?.prodV5?.hybridRelayEvents, s.v4?.prodV4?.hybridRelayEvents]; // the card sums the v5.1, v5 and v4 production instances
  const hybrid = hy.every((x) => typeof x === 'number') ? hy.reduce((n, x) => n + (x as number), 0) : undefined;
  if (typeof hybrid === 'number') await expect(page.getByTestId('ov-hybrid')).toHaveAttribute('data-value', String(hybrid), { timeout: 60_000 });
  await expect(page.getByTestId('ov-relayer-balance')).toContainText(Number(h.relayer.balance).toFixed(2).slice(0, -1), { timeout: 60_000 });
  await expect(page.getByTestId('ov-activity-rows').locator('a[href^="/check/"]').first()).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId('ov-spark')).toBeVisible();
  await page.getByTestId('ov-search').locator('input').fill('0x392f50b1955a827458A320205e19acf7C664f116');
  await page.getByTestId('ov-search').locator('input').press('Enter');
  await expect(page).toHaveURL(/\/check\/0x392f50b1955a827458A320205e19acf7C664f116$/);
  await noSideScroll(page);
});

test('/proof shows the CBOM run date from the data; page headers carry the light glass Pocket', async ({ page }) => {
  await page.goto(`${BASE}/proof`);
  await expect(page.getByTestId('proof-cbom-date')).toHaveText(`Last run: ${new Date((JSON.parse(fs.readFileSync('src/data/cbom-meta.json', 'utf8')) as { timestamp: string }).timestamp).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}.`);
  await expect(page.getByTestId('pocket-object').first()).toHaveAttribute('data-mode', 'svg');
});

test('the landing lives on /, /about redirects there, and the app logo returns to it', async ({ page }) => {
  await page.goto(`${BASE}/about`);
  await expect(page).toHaveURL(new RegExp(`${BASE.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}/$`));
  await expect(page.getByTestId('landing')).toBeVisible();
  await expect(page).toHaveTitle('Send QOR by link, guarded by ML-DSA-87 · Pocket Drop');
  await expect(page.getByTestId('sidebar')).toHaveCount(0); // the landing is not inside the dashboard
  await expect(page.getByTestId('hero-open')).toHaveAttribute('href', '/app');
  await expect(page.getByTestId('hero-sample')).toHaveAttribute('href', /^\/pool\/p\d+#k=[0-9a-f]{64}$/);
  await noSideScroll(page);
  await page.getByTestId('hero-open').click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByTestId('overview')).toBeVisible();
  await expect(page).toHaveTitle('Overview · Pocket Drop');
  await page.getByTestId('logo').first().click();
  await expect(page).toHaveURL(new RegExp(`${BASE.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}/$`));
  await expect(page.getByTestId('landing')).toBeVisible();
});

test('old links keep working: /claim/<id> keeps its key fragment, /overview and /stats redirect', async ({ page }) => {
  await page.goto(`${BASE}/claim/p1#k=${'0'.repeat(64)}`);
  await expect(page).toHaveURL(new RegExp(`/c/p1#k=0{64}$`));
  await page.goto(`${BASE}/overview`);
  await expect(page).toHaveURL(/\/app$/);
  await page.goto(`${BASE}/stats`);
  await expect(page).toHaveURL(/\/radar$/);
});

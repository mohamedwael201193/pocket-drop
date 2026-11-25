// First-run UX on the deployed app (read-only, spends nothing): the start guide, the sidebar fit, the radar distinct count,
// the v4 sample pool paying into the v5 Pocket, and the CSP staying clean.
//   E2E_URL=https://pocketdrop-app.vercel.app npx playwright test e2e/ux.spec.ts
import { test, expect } from './fixtures';
import fs from 'node:fs';

const sample = JSON.parse(fs.readFileSync('src/data/sample-pool.json', 'utf8')) as { path: string };

const BASE = process.env.E2E_URL || 'https://pocketdrop-app.vercel.app';

test('overview: a first-time visitor gets a three-step guide with one primary action, and can hide it', async ({ page }) => {
  await page.goto(`${BASE}/app`);
  const g = page.getByTestId('start-here');
  await expect(g).toBeVisible();
  await expect(g).toContainText('0 of 3 done');
  await expect(page.getByTestId('start-qor-cta')).toHaveAttribute('href', sample.path);
  await expect(page.getByTestId('start-qor')).toHaveAttribute('data-done', '0');
  await page.getByTestId('start-here-hide').click();
  await expect(g).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('overview')).toBeVisible();
  await expect(page.getByTestId('start-here')).toHaveCount(0);
});

test('overview: the drill step ticks after the drill page was opened', async ({ page }) => {
  await page.goto(`${BASE}/qday`);
  await expect(page.getByTestId('qday-page')).toBeVisible();
  await page.goto(`${BASE}/app`);
  await expect(page.getByTestId('start-drill')).toHaveAttribute('data-done', '1');
});

test('sidebar: every Verify item is visible without scrolling at 1280 x 800', async ({ page }) => {
  test.skip(page.viewportSize()!.width < 1024, 'desktop sidebar only');
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${BASE}/app`);
  for (const k of ['qday', 'check', 'judges', 'lab', 'radar', 'about']) await expect(page.getByTestId(`side-${k}`)).toBeInViewport();
  await page.getByTestId('sidebar-toggle').click();
  await expect(page.getByTestId('sidebar-toggle')).toHaveAttribute('aria-label', 'Expand sidebar');
  await page.getByTestId('sidebar-toggle').click();
});

test('radar: the headline is distinct external accounts; the per-role total sits below it', async ({ page }) => {
  await page.goto(`${BASE}/radar`);
  const d = page.getByTestId('external-distinct');
  await expect(d).toHaveText(/^\d+$/, { timeout: 120_000 });
  const roles = Number(await page.getByTestId('external-total').textContent());
  expect(Number(await d.textContent())).toBeLessThanOrEqual(roles);
});

test('sample pool: the team-hosted pool opens with one clear first action', async ({ page }) => {
  await page.goto(`${BASE}${sample.path}`);
  await expect(page.getByTestId('pool-team-hosted')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('pool-start')).toBeVisible();
});

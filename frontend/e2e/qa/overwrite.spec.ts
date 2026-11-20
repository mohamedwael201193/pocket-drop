// B-01 regression (no funds needed): a key written to this browser outside the current page (a claim page, another tab)
// must never be replaced by "Create my quantum-safe key", and /pocket must show the Pocket that key owns.
//   E2E_URL=https://pocketdrop-app.vercel.app npx playwright test e2e/qa/overwrite.spec.ts --project=chromium-390
import { type Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { readRoot } from '../vault';

const BASE = process.env.E2E_URL || 'https://pocketdrop-app.vercel.app';
const ROOT = 'pd.root.v4';
const R1 = 'ab'.repeat(32);
const toPocket = (p: Page) => p.locator('[data-testid=tab-pocket]:visible, [data-testid=nav-pocket]:visible').first().click();

test('a key written behind the app is kept: "Create my quantum-safe key" adopts it instead of replacing it', async ({ page }) => {
  await page.goto(`${BASE}/receive`);
  await page.evaluate(([k, r]) => localStorage.setItem(k, r), [ROOT, R1]); // what a claim page did before B-01 was fixed
  await toPocket(page);
  await page.waitForURL(/\/pocket/);
  // either the page adopts the stored key by itself, or "Create my quantum-safe key" must adopt it; it must never replace it
  const create = page.getByTestId('create-key');
  const pocket = page.getByTestId('pocket-address');
  await expect(create.or(pocket).first()).toBeVisible({ timeout: 60_000 });
  if (await create.isVisible().catch(() => false)) await create.click().catch(() => undefined);
  await expect(pocket).toBeVisible({ timeout: 60_000 });
  expect(await readRoot(page, ROOT)).toBe(R1);
});

test('the app follows a key created in another tab, without a reload', async ({ context }) => {
  const a = await context.newPage();
  await a.goto(`${BASE}/pocket`);
  await expect(a.getByTestId('create-key')).toBeVisible({ timeout: 60_000 });
  const b = await context.newPage();
  await b.goto(`${BASE}/receive`);
  await b.evaluate(([k, r]) => localStorage.setItem(k, r), [ROOT, R1]); // fires a storage event in tab a
  await expect(a.getByTestId('create-key')).toBeHidden({ timeout: 30_000 });
  await expect(a.getByTestId('pocket-address')).toBeVisible({ timeout: 60_000 });
  expect(await readRoot(a, ROOT)).toBe(R1);
});

test('a stored key opens straight to its Pocket, with no "Create my quantum-safe key" offer', async ({ page }) => {
  await page.goto(`${BASE}/receive`);
  await page.evaluate(([k, r]) => localStorage.setItem(k, r), [ROOT, R1]);
  await page.goto(`${BASE}/pocket`);
  await expect(page.getByTestId('pocket-address')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('create-key')).toHaveCount(0);
  expect(await readRoot(page, ROOT)).toBe(R1);
});

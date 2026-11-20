// Sponsored onboarding, no funds needed: what a brand-new sender sees while the sponsor is on, and the fallback.
//   E2E_URL=https://pocketdrop-app.vercel.app npx playwright test e2e/qa/sponsor.spec.ts --project=chromium-390
import { test, expect } from '@playwright/test';

const BASE = process.env.E2E_URL || 'https://pocketdrop-app.vercel.app';
const ON = { ok: true, enabled: true, remainingToday: 20, amountWei: '60000000000000000', senderMinPocketWei: '100000000000000000' };

test('sponsor on: a new sender is asked to fund only the Pocket; the key setup is covered, the faucet stays as a fallback', async ({ page }) => {
  let posts = 0;
  await page.route('**/api/sponsor', (r) => (r.request().method() === 'POST' ? (posts++, r.fulfill({ status: 500, json: { ok: false } })) : r.fulfill({ json: ON })));
  await page.goto(`${BASE}/send`);
  await page.getByTestId('create-key').click();
  await expect(page.getByTestId('sponsor-status')).toContainText(/only your Pocket/i, { timeout: 60_000 });
  await expect(page.getByTestId('sponsor-status')).toContainText('0.1');
  await expect(page.getByTestId('register-reason')).toContainText(/by itself/);
  await expect(page.getByTestId('key-qr')).toBeHidden();
  await page.getByTestId('sponsor-fallback').locator('summary').click();
  await expect(page.getByTestId('key-faucet')).toBeVisible();
  await expect(page.getByTestId('amount-lock')).toContainText(/fund your Pocket/i);
  expect(posts).toBe(0); // an unfunded Pocket never asks
});

test('sponsor off or capped: no sponsor notice, the faucet path is the main path again', async ({ page }) => {
  await page.route('**/api/sponsor', (r) => r.fulfill({ json: { ...ON, enabled: false, reason: 'daily cap reached' } }));
  await page.goto(`${BASE}/send`);
  await page.getByTestId('create-key').click();
  await expect(page.getByTestId('activation-note')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('sponsor-status')).toHaveCount(0);
  await expect(page.getByTestId('key-faucet')).toBeVisible();
  await expect(page.getByTestId('amount-lock')).toContainText(/key account/i);
});

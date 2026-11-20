// P1, P2 and UX-1 regressions (no funds needed).
//   E2E_URL=https://pocketdrop-app.vercel.app npx playwright test e2e/qa/readiness.spec.ts --project=chromium-390
import { test, expect } from '@playwright/test';

const BASE = process.env.E2E_URL || 'https://pocketdrop-app.vercel.app';
const K = 'ab'.repeat(32);

test('P2: a pool id that does not exist says so instead of loading forever', async ({ page }) => {
  await page.goto(`${BASE}/pool/p99999#k=${K}`);
  await expect(page.getByTestId('pool-missing')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Pool not found/);
});

test('P2: a pool link without an instance or without its key explains itself', async ({ page }) => {
  await page.goto(`${BASE}/pool/zzz#k=${K}`);
  await expect(page.getByTestId('pool-invalid')).toBeVisible({ timeout: 30_000 });
});

test('P1: a new key with no QOR gets the qor1 address, a QR, the faucet and the amount up front, and Register says why it is off', async ({ page }) => {
  await page.goto(`${BASE}/pocket`);
  await page.getByTestId('create-key').click();
  const act = page.getByTestId('activation');
  await expect(act).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('activation-note')).toContainText(/at least 0\.07 QOR/);
  const qor1 = await page.getByTestId('key-address-qor1').getAttribute('data-address');
  expect(qor1).toMatch(/^qor1[02-9ac-hj-np-z]{38}$/);
  await expect(page.getByTestId('key-address')).toHaveAttribute('data-address', /^0x[0-9a-fA-F]{40}$/);
  await expect(page.getByTestId('key-qr')).toBeVisible();
  await expect(page.getByTestId('key-faucet')).toHaveAttribute('href', /faucet/);
  await expect(page.getByTestId('register-key')).toBeDisabled();
  await expect(page.getByTestId('register-reason')).toContainText(/0\.07 QOR/);
});

test('UX-1: /send says why every control is locked for a new visitor', async ({ page }) => {
  await page.goto(`${BASE}/send`);
  await expect(page.getByTestId('amount-lock')).toContainText(/create your key/i, { timeout: 30_000 });
  await expect(page.getByTestId('create-drop')).toBeDisabled();
  await expect(page.getByTestId('create-drop-reason')).toBeVisible();
  await expect(page.getByTestId('create-pool-reason')).toBeVisible();
});

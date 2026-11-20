// /qday "Steal this Pocket": banner, five live baits, alarm, in-tab attack (eth_call only), log, before/after; screenshots.
//   E2E_URL=https://<preview> QDAY_KEYS_EXPECTED=1 npx playwright test e2e/qday.spec.ts --project=chromium-390 --project=chromium-1440
import { test, expect } from './fixtures';

const BASE = process.env.E2E_URL || 'https://pocketdrop-app.vercel.app';
const SHOTS = process.env.QA_SHOTS || 'test-results/qa/shots';

test('Steal this Pocket shows the testnet warning, five live baits, the alarm and the log', async ({ page }, info) => {
  await page.goto(`${BASE}/qday`);
  await expect(page.getByTestId('qday-testnet-banner')).toContainText('TESTNET');
  await expect(page.getByTestId('qday-never-real')).toContainText('never send real funds');
  await expect(page.getByTestId('qday-alarm')).toContainText(/No breach|Breach alarm/, { timeout: 60_000 });
  for (const id of ['B1', 'B2', 'B3', 'B4', 'B5']) {
    await expect(page.getByTestId(`qday-bait-${id}`)).toBeVisible();
    await expect(page.getByTestId(`qday-balance-${id}`)).toContainText('QOR');
    await expect(page.getByTestId(`qday-window-${id}`)).toHaveText('closed');
  }
  if (process.env.QDAY_KEYS_EXPECTED === '1') for (const id of ['B1', 'B2', 'B3', 'B4', 'B5']) await expect(page.getByTestId(`qday-key-${id}`)).toContainText(/0x[0-9a-f]{64}/);
  await expect(page.getByTestId('qday-log-onchain')).toBeVisible();
  await expect(page.getByTestId('qday-log-refused')).toBeVisible();
  await expect(page.getByTestId('qday-log-bot')).toContainText(/team-run/i);
  await expect(page.getByTestId('qday-theft-tx')).toHaveAttribute('data-hash', /0x445b5443.*8893$/);
  const w = page.viewportSize()!.width;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(w + 1);
  await page.screenshot({ path: `${SHOTS}/qday-${w}.png`, fullPage: true });
  info.annotations.push({ type: 'screenshot', description: `${SHOTS}/qday-${w}.png` });
});

test('Try it: every in-tab path against B1 is refused (eth_call, nothing sent)', async ({ page }) => {
  test.skip(process.env.QDAY_KEYS_EXPECTED !== '1', 'keys not published on this deployment');
  await page.goto(`${BASE}/qday`);
  await expect(page.getByTestId('qday-key-B1')).toContainText(/0x[0-9a-f]{64}/, { timeout: 60_000 });
  await page.getByTestId('qday-try-run').click();
  const rows = page.getByTestId('qday-try-rows');
  await expect(rows).toBeVisible({ timeout: 90_000 });
  await expect(rows).toContainText('E1');
  await expect(rows).toContainText('refused: BadSignature');
  await expect(rows).not.toContainText('WOULD SUCCEED');
});

test('Steal this Pocket is under Proof, not a new tab', async ({ page }) => {
  await page.goto(`${BASE}/proof`);
  await expect(page.getByTestId('proof-card-qday')).toBeVisible();
  await page.goto(`${BASE}/lab`);
  await expect(page.getByTestId('lab-qday-link')).toBeVisible();
  await expect(page.locator('[data-testid=nav-qday], [data-testid=tab-qday]')).toHaveCount(0);
});

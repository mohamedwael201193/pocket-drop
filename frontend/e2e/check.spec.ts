// Proof > Check a transaction: recorded Diana transactions are fetched from the chain and their ML-DSA-87 signatures are
// re-verified in the browser (hybrid native lane and EVM lane). Also the relayer line on /proof and the hybrid note on /radar.
import { test, expect } from './fixtures';
const BASE = process.env.E2E_URL || 'https://pocketdrop-app.vercel.app';
const CLAIM = 'E64662F8E0503C8A2C18E267A52ABE2670958E22A8BF6B10C6563FEFB9864FC8';

async function noSideScroll(page: import('@playwright/test').Page) {
  const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  expect(sw).toBeLessThanOrEqual(iw + 1);
}

test('a hybrid-lane claim: the chain verified the relayer, the browser verifies the recipient', async ({ page }) => {
  await page.goto(`${BASE}/check/${CLAIM}`);
  await expect(page.getByTestId('check-verdict')).toContainText('verified in your browser', { timeout: 90_000 });
  await expect(page.getByTestId('check-lane')).toContainText('pqc_hybrid_verify = verified');
  await expect(page.getByTestId('check-sig-0')).toContainText("recipient's post-quantum key");
  await expect(page.getByTestId('check-sig-0-verdict')).toHaveText('valid');
  await expect(page.getByTestId('check-sig-0-valid')).toContainText('Valid for this exact intent');
  await expect(page.getByTestId('check-sig-0-tampered')).toContainText('rejected');
  await expect(page.getByTestId('check-sig-0')).toContainText('4,627 bytes');
  await noSideScroll(page);
});

test('an EVM-lane 2-of-3 guardian freeze from the examples, then a bad hash', async ({ page }) => {
  await page.goto(`${BASE}/check`);
  await page.getByTestId('check-example-freeze').click();
  await expect(page.getByTestId('check-verdict')).toContainText('All 2 post-quantum signatures', { timeout: 90_000 });
  await expect(page.getByTestId('check-lane')).toContainText('EVM transaction');
  for (const i of [0, 1]) await expect(page.getByTestId(`check-sig-${i}-verdict`)).toHaveText('valid');
  await noSideScroll(page);
  await page.getByTestId('check-input').fill('0x1234');
  await expect(page.getByTestId('check-bad')).toBeVisible();
  await expect(page.getByTestId('check-submit')).toBeDisabled();
});

test('the Proof menu links to the checker; /proof says how the relayer signs; /radar notes hybrid relays', async ({ page }) => {
  await page.goto(`${BASE}/proof`);
  await expect(page.getByTestId('proof-relayer-why')).toContainText(/ML-DSA-87|ECDSA/, { timeout: 90_000 });
  await page.goto(`${BASE}/radar`);
  await expect(page.getByTestId('prod-hybrid-note')).toContainText(/hybrid/i, { timeout: 90_000 });
  const menu = page.getByRole('button', { name: /Proof/ }).first();
  if (await menu.isVisible()) {
    await menu.click();
    const item = page.getByTestId('proof-check');
    if (await item.isVisible()) { await item.click(); await expect(page.getByTestId('check-page')).toBeVisible(); }
  }
});

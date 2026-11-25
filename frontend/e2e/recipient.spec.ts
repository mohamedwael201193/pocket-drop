// Pocket > Send out: checks on the "send to" address before signing (no funds needed: a fresh key and its counterfactual Pocket).
import { test, expect } from './fixtures';
const BASE = process.env.E2E_URL || 'https://pocket-drop.vercel.app';
const FRIEND = '0x392f50b1955a827458A320205e19acf7C664f116';
const TWIN = '0x392f0000000000000000000000000000c664f116';
const PROD_DROP = '0xbc13b9EE91f31eD56932abDb796693515C351f00';
const V3_CONTRACT = '0x29f53b4b8031e7ba1785dc8c7a1c0be413a4bd97'; // v3 PocketDrop: a contract that is not a Pocket
const BAIT_POCKET = '0x31368D55a0fD1983397ffc5D85dB3bdd482a11cE';

test('send-to checks: own Pocket, protocol contract, checksum, lookalike, other contract, another Pocket', async ({ page }) => {
  await page.goto(`${BASE}/pocket`);
  await page.evaluate((a) => localStorage.setItem('pd.recentRecipients', JSON.stringify([a])), FRIEND);
  await page.getByTestId('create-key').click();
  const pocket = (await page.getByTestId('pocket-address').first().getAttribute('data-address', { timeout: 60_000 }))!;
  const to = page.getByTestId('spend-to');
  await expect(to).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('spend-amount').fill('0.01');
  const problem = page.getByTestId('spend-problem');

  await to.fill(pocket);
  await expect(problem).toContainText('your Pocket itself');
  await to.fill(PROD_DROP);
  await expect(problem).toContainText('PocketDrop contract');
  await to.fill(FRIEND.replace('f50b', 'F50b'));
  await expect(problem).toContainText('checksum');

  await to.fill(TWIN);
  await expect(page.getByTestId('spend-recipient-warning')).toContainText('starts and ends like');
  await expect(page.getByTestId('spend-recipient-ack')).not.toBeChecked();
  await page.getByTestId('spend-recipient-ack').check();
  await expect(page.getByTestId('spend-recipient-ack')).toBeChecked();

  await to.fill(V3_CONTRACT);
  await expect(page.getByTestId('spend-recipient-warning')).toContainText('is a contract', { timeout: 30_000 });
  await to.fill(BAIT_POCKET);
  await expect(page.getByTestId('spend-recipient-info')).toContainText('another Pocket', { timeout: 30_000 });
  await expect(page.getByTestId('spend-recipient-warning')).toHaveCount(0);
  await to.fill(FRIEND);
  await expect(page.getByTestId('spend-recipient-info')).toContainText('used this address before');
});

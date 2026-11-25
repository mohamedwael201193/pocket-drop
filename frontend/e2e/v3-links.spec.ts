// v3 link ids keep resolving at /c/:id (link #17 and older): free, read-only. The header says "Confirmed mode" plus the live state
// (never "Confirmed by the sender" while waiting) and v4 ids (p12) route to the v4 claim page.
import { test, expect } from '@playwright/test';

const URL = (process.env.E2E_URL ?? 'https://pocket-drop.vercel.app').replace(/\/$/, '');

for (const id of ['17', '5']) {
  test(`v3 link #${id} still resolves with the corrected header copy`, async ({ page }) => {
    const seed = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('');
    await page.goto(`${URL}/c/${id}#k=${seed}`);
    await expect(page.getByTestId('claim-page')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('incoming-amount')).toContainText(/\d/, { timeout: 60_000 });
    const header = await page.getByTestId('claim-page').innerText();
    expect(header).toMatch(/Giveaway|Confirmed mode · (claimed|waiting|confirmed|cancelled|refunded)/i);
    expect(header).not.toMatch(/Confirmed by the sender · /);
  });
}

test('a v4 id routes to the v4 claim page', async ({ page }) => {
  await page.goto(`${URL}/c/p1#k=${'ab'.repeat(32)}`);
  await expect(page.getByTestId('mode-line')).toContainText(/Confirmed mode|Giveaway/, { timeout: 60_000 });
});

test('a claimed v3 link (#29, claimed on the hybrid lane) says what it held, not "You received"', async ({ page }) => {
  await page.goto(`${URL}/c/29#k=${'ab'.repeat(32)}`);
  await expect(page.getByTestId('link-dead')).toContainText('claimed', { timeout: 60_000 });
  await expect(page.getByTestId('claim-page')).toContainText('This link held');
  await expect(page.getByTestId('claim-page')).not.toContainText('You received');
});

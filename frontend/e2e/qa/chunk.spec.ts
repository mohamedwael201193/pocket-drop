import { test, expect } from '../fixtures';

// Needs a production build (vite preview or the live site): page chunks are named assets/<Page>-<hash>.js.
const BASE = process.env.E2E_URL ?? 'http://localhost:4173';

test('a page chunk missing after a redeploy reloads once and the page appears', async ({ page }) => {
  let n = 0;
  await page.route(/assets\/ReceivePage-.*\.js/, (r) => (n++ === 0 ? r.fulfill({ status: 404, body: '' }) : r.fallback()));
  await page.goto(`${BASE}/receive`);
  await expect(page.locator('h1')).toBeVisible({ timeout: 20_000 });
  expect(n).toBeGreaterThanOrEqual(2);
});

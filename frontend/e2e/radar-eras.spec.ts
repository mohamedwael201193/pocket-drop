// /radar: legacy-key era telemetry is LIVE and /api/stats counts the same as the page (v3 and v4 kept apart).
import { test, expect } from './fixtures';
const BASE = process.env.E2E_URL || 'https://pocketdrop-app.vercel.app';

test('radar shows the legacy-key eras and that /api/stats agrees', async ({ page }) => {
  await page.goto(`${BASE}/radar`);
  await expect(page.getByTestId('key-eras-line')).toContainText(/production Pockets were deployed before the v2 key release/, { timeout: 90_000 });
  await expect(page.getByTestId('api-agrees')).toContainText(/\/api\/stats (agrees|differs)/, { timeout: 90_000 });
  await expect(page.getByTestId('api-agrees')).toContainText('agrees');
});

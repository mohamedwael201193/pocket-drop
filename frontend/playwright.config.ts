import { defineConfig } from '@playwright/test';

const phone = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const desktop = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 };

// Deployed-URL E2E in Chromium and WebKit at 390 (phone) and 1440 (desktop): E2E_URL=https://... npx playwright test --project=chromium-390
export default defineConfig({
  testDir: './e2e',
  timeout: 1_500_000,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  expect: { timeout: 20_000 },
  use: { actionTimeout: 60_000, navigationTimeout: 90_000 },
  outputDir: 'test-results',
  projects: [
    { name: 'chromium-390', use: { browserName: 'chromium', ...phone } },
    { name: 'chromium-1440', use: { browserName: 'chromium', ...desktop } },
    { name: 'webkit-390', use: { browserName: 'webkit', ...phone } },
    { name: 'webkit-1440', use: { browserName: 'webkit', ...desktop } },
  ],
});

// First visit, no key, no funds (read-only): plain landing, the drill surfaced, the sample pool, titles, Pocket's Advanced fold.
//   E2E_URL=https://pocketdrop-app.vercel.app npx playwright test e2e/qa/firstvisit.spec.ts --project=chromium-390
import { test, expect } from '../fixtures';
import fs from 'node:fs';

const sample = JSON.parse(fs.readFileSync(new URL('../../src/data/sample-pool.json', import.meta.url), 'utf8')) as { poolId: number };

const BASE = process.env.E2E_URL || 'https://pocketdrop-app.vercel.app';
const SHOTS = process.env.QA_SHOTS || 'test-results/qa/shots';
const fits = async (page: import('@playwright/test').Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width + 1);

test('landing: three plain steps, the Q-Day Drill section, test counts from evidence, jargon only under Technical details', async ({ page }) => {
  await page.goto(`${BASE}/about`);
  await expect(page).toHaveTitle(/Pocket Drop/);
  await expect(page.getByTestId('how-it-works')).toContainText('Send a link');
  await expect(page.getByTestId('how-it-works')).toContainText('quantum-safe Pocket');
  await expect(page.getByTestId('how-it-works')).toContainText('Guardians if the phone is lost');
  await expect(page.getByTestId('hero-tests')).toContainText(/\d+ contract \+ \d+ app tests pass/);
  await expect(page.getByTestId('hero-tests')).not.toContainText('117');
  const hero = await page.locator('[data-testid=landing] > div').first().innerText();
  for (const jargon of ['0x0A01', '0x0A02', 'PoP', '/api/bind']) expect(hero).not.toContain(jargon);
  await expect(page.getByTestId('landing-tech')).not.toHaveAttribute('open', '');
  await expect(page.getByTestId('landing-qday')).toContainText('Q-DAY DRILL');
  await expect(page.getByTestId('landing-qday-holding')).toContainText(/\d+ of \d+/, { timeout: 60_000 });
  await expect(page.getByTestId('footer-audit')).toContainText('no human audit');
  await fits(page);
  await page.screenshot({ path: `${SHOTS}/landing-${page.viewportSize()!.width}.png`, fullPage: true });
});

test('receive: the TEAM-HOSTED sample pool is offered and opens with its label', async ({ page }) => {
  await page.goto(`${BASE}/receive`);
  await expect(page).toHaveTitle('Receive · Pocket Drop');
  await expect(page.getByTestId('sample-pool-label')).toHaveText('TEAM-HOSTED sample');
  await expect(page.getByTestId('sample-pool-left')).toContainText(/slots left|ended/, { timeout: 60_000 });
  await fits(page);
  await page.screenshot({ path: `${SHOTS}/receive-${page.viewportSize()!.width}.png`, fullPage: true });
  await page.getByTestId('sample-pool-open').click();
  await expect(page).toHaveURL(new RegExp(`/pool/p${sample.poolId}#k=[0-9a-f]{64}$`));
  await expect(page.getByTestId('pool-team-hosted')).toBeVisible();
  await expect(page.getByTestId('pool-slots-left')).toContainText('(the PocketDrop team)', { timeout: 60_000 });
  await expect(page).toHaveTitle('Drop Pool · Pocket Drop');
  await page.screenshot({ path: `${SHOTS}/sample-pool-${page.viewportSize()!.width}.png`, fullPage: true });
});

test('judges: the Q-Day Drill is step 1, the requirement table has every row, both QCAI stages and the sample pool are listed', async ({ page }) => {
  await page.goto(`${BASE}/judges`);
  await expect(page).toHaveTitle('Judges checklist · Pocket Drop');
  await expect(page.getByRole('heading', { level: 2 }).first()).toHaveText('Start here: the Q-Day Drill');
  await expect(page.getByTestId('req-table').locator('tbody tr')).toHaveCount(10);
  await expect(page.getByTestId('req-pqc-verify')).toContainText('pqcVerify');
  await expect(page.getByTestId('qcai')).toContainText('Stage 2');
  await expect(page.getByTestId('qcai')).toContainText('78');
  await expect(page.getByTestId('test-others')).toContainText(/\d+ frontend and \d+ backend unit tests pass/);
  await expect(page.getByTestId('sample-pool')).toBeVisible();
  await fits(page);
  await page.screenshot({ path: `${SHOTS}/judges-${page.viewportSize()!.width}.png`, fullPage: true });
});

test('pocket: a new visitor sees create-key first; guardian tools and Rescue are folded under Advanced', async ({ page }) => {
  await page.goto(`${BASE}/pocket`);
  await expect(page).toHaveTitle('Your Pocket · Pocket Drop');
  await expect(page.getByTestId('create-key')).toHaveText(/Create my quantum-safe key/);
  await expect(page.getByTestId('pocket-advanced')).not.toHaveAttribute('open', '');
  await expect(page.getByTestId('help-section')).toBeHidden();
  await expect(page.getByTestId('rescue-section')).toBeHidden();
  await fits(page);
  await page.screenshot({ path: `${SHOTS}/pocket-${page.viewportSize()!.width}.png`, fullPage: true });
  await page.getByTestId('pocket-advanced-toggle').click();
  await expect(page.getByTestId('help-section')).toBeVisible();
  await expect(page.getByTestId('rescue-section')).toBeVisible();
});

test('send: plain cost table, wider column on desktop', async ({ page }) => {
  await page.goto(`${BASE}/send`);
  await expect(page).toHaveTitle('Send QOR by link · Pocket Drop');
  await expect(page.getByTestId('create-key')).toHaveText(/Create my quantum-safe key/);
  await expect(page.getByTestId('drop-total')).toContainText('Setup for your friend');
  await expect(page.getByTestId('drop-total')).toContainText('Total from your Pocket');
  const w = page.viewportSize()!.width;
  const col = await page.getByTestId('send-page').evaluate((e) => e.getBoundingClientRect().width);
  if (w >= 1280) expect(col).toBeGreaterThan(800);
  await fits(page);
  await page.screenshot({ path: `${SHOTS}/send-${w}.png`, fullPage: true });
});

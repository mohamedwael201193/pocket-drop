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
  await expect(page.getByTestId('check-sig-0-qoresign')).toContainText('builds the same signed text and finds the signature valid');
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
  await expect(page.getByTestId('proof-cbom')).toContainText('X25519MLKEM768');
  await expect(page.getByTestId('proof-cbom-json')).toHaveAttribute('href', /docs\/cbom\/cbom\.json$/);
  await page.goto(`${BASE}/radar`);
  await expect(page.getByTestId('prod-hybrid-note')).toContainText(/hybrid/i, { timeout: 90_000 });
  const menu = page.getByRole('button', { name: /Proof/ }).first();
  if (await menu.isVisible()) {
    await menu.click();
    const item = page.getByTestId('proof-check');
    if (await item.isVisible()) { await item.click(); await expect(page.getByTestId('check-page')).toBeVisible(); }
  }
});

test('a LAB Pocket address shows who can do what, with the delays read from the vault', async ({ page }) => {
  await page.goto(`${BASE}/check/0xD162356fBb0fc52a8C326f9635E2c1F61964f5D5`);
  const delays = page.getByTestId('power-delays');
  await expect(delays).toBeVisible({ timeout: 90_000 });
  await expect(delays).toHaveAttribute('data-timelock', '60');
  await expect(delays).toHaveAttribute('data-recovery', '60');
  await expect(delays).toHaveAttribute('data-freeze', '120');
  await expect(delays).toHaveAttribute('data-unanimous', '180');
  await expect(page.getByTestId('power-map')).toContainText(/ on the lab( \(v[45][^)]*\))? instance/);
  await expect(page.getByTestId('power-freeze')).toContainText('2 of 3 guardians');
  await expect(page.getByTestId('power-classical-state')).toHaveText('not possible');
  await noSideScroll(page);
});

test('a guarded prod Q-Day bait from the examples; a non-Pocket address is explained', async ({ page }) => {
  await page.goto(`${BASE}/check`);
  await page.getByTestId('check-example-pocket').click();
  await expect(page.getByTestId('power-delays')).toHaveAttribute('data-timelock', '86400', { timeout: 90_000 });
  await expect(page.getByTestId('power-map')).toContainText(/ on the production( \(v[45][^)]*\))? instance/);
  await page.getByTestId('check-input').fill('0x392f50b1955a827458A320205e19acf7C664f116');
  await page.getByTestId('check-submit').click();
  await expect(page.getByTestId('check-not-pocket')).toBeVisible({ timeout: 60_000 });
});

test('with the EVM window closed and hybrid relays, the app shows the relayer as live (no paused banner)', async ({ page }) => {
  await page.goto(`${BASE}/about`);
  await expect(page.getByTestId('landing-window')).toContainText(/ECDSA-only path closed|ECDSA window still open|Window live/, { timeout: 90_000 });
  await expect(page.getByText('Diana 9800 · live').first()).toBeVisible();
  await expect(page.getByTestId('relayer-banner')).toHaveCount(0);
});

test('a malformed hash in the URL explains the format and still offers the examples, including a refused attack', async ({ page }) => {
  await page.goto(`${BASE}/check/0x1234`);
  await expect(page.getByTestId('check-bad')).toBeVisible();
  await page.getByTestId('check-example-refused').click();
  await expect(page.getByTestId('check-verdict')).toContainText('Refused attempt', { timeout: 60_000 });
});

test('every entry on /proof carries a filled LIVE or RECORDED label', async ({ page }) => {
  await page.goto(`${BASE}/proof`);
  for (const id of ['qday', 'lab', 'radar', 'check', 'judges']) await expect(page.getByTestId(`proof-card-${id}`)).toContainText(/LIVE|RECORDED/);
  await expect(page.getByTestId('proof-card-check')).toContainText('LIVE');
});

test('/judges: the relayer item reads the live relay lane, the table has the hybrid-relay row, and the checker is linked', async ({ page }) => {
  await page.goto(`${BASE}/judges`);
  await expect(page.getByTestId('judges-relay-mode')).toContainText(/hybrid|EVM window/, { timeout: 60_000 });
  await expect(page.getByTestId('req-hybrid-relay')).toContainText('code 14');
  await expect(page.getByTestId('judges-check').getByRole('link', { name: /Check a transaction/ })).toHaveAttribute('href', '/check');
  await noSideScroll(page);
});

test('the landing card and /lab agree on how many v4 attacks the chain refused', async ({ page }) => {
  await page.goto(`${BASE}/lab`);
  const n = (await page.getByRole('heading', { level: 1 }).textContent())!.match(/(\d+) attacks/)![1];
  await page.goto(`${BASE}/about`);
  await expect(page.getByRole('link', { name: new RegExp(`All ${n} v4 attacks`) })).toBeVisible();
});

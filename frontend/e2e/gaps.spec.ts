// Gaps closed on 22 Nov 2026 (RESCORE items 2-6): v3 hybrid claims in /api/stats, current API names on the landing cards,
// and the smaller UX items. (The old landing's technical cards were replaced by the 26 Nov 2026 landing.) Runs against the deployed app and API.
import { test, expect } from './fixtures';
const BASE = process.env.E2E_URL || 'https://pocket-drop.vercel.app';
const API = process.env.E2E_API || 'https://pocket-drop-api.vercel.app';

test('/api/stats counts v3 link #29, which was bound and claimed through hybrid relays', async ({ request }) => {
  const r = await request.get(`${API}/api/stats`, { timeout: 90_000 });
  expect(r.ok()).toBeTruthy();
  const s = await r.json();
  const rows = s.v3.recent as { kind: string; linkId: string; txHash: string; lane?: string }[];
  expect(rows).toContainEqual(expect.objectContaining({ kind: 'claimed', linkId: '29', txHash: 'CAFECB9ABD82E5715DAE1EB721D8332E10631370F62A15F26384825EAB98F71C', lane: 'hybrid' }));
  expect(s.v3.hybridRelayEvents).toBeGreaterThanOrEqual(2);
});

test('the landing and /judges name the current API, never the retired ones', async ({ page }) => {
  await page.goto(`${BASE}/`);
  await expect(page.getByTestId('landing')).toBeVisible();
  await page.waitForTimeout(1500); // the lower sections load as their own chunk
  const landing = await page.locator('body').innerText();
  await page.goto(`${BASE}/judges`);
  await expect(page.locator('body')).toContainText('POST /api/route');
  const judges = await page.locator('body').innerText();
  for (const old of ['/api/bind', 'PoP Account']) { expect(landing).not.toContain(old); expect(judges).not.toContain(old); }
});

test('a claimed link shows the same screen with or without its key', async ({ page }) => {
  const read = async (url: string) => {
    await page.goto(url);
    await expect(page.getByTestId('link-dead')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('incoming-amount')).not.toContainText('…');
    return { notice: (await page.getByTestId('link-dead').innerText()).trim(), amount: (await page.getByTestId('incoming-amount').innerText()).trim(), h1: (await page.locator('h1').first().innerText()).trim() };
  };
  const bare = await read(`${BASE}/c/p12`);
  const keyed = await read(`${BASE}/c/p12#k=badkey`);
  expect(bare).toEqual(keyed);
  expect(bare.h1).toBe('This link is already claimed');
  await expect(page.getByTestId('no-key')).toHaveCount(0);
});

test('every refused Q-Day row shows its time and its block (or that it was never mined)', async ({ page }) => {
  await page.goto(`${BASE}/qday`);
  const rows = page.getByTestId('qday-row-when');
  await expect(rows.first()).toBeVisible({ timeout: 90_000 });
  const all = await rows.allInnerTexts();
  expect(all.length).toBeGreaterThan(0);
  for (const t of all) expect(t).toMatch(/^.+ · (block [\d,]+|not mined)$/);
  expect(all.filter((t) => /block/.test(t) && t.startsWith('time not recorded'))).toEqual([]);
});

test('/lab: long lists fold on a phone and stay open on a wide screen', async ({ page }) => {
  await page.goto(`${BASE}/lab`);
  const phone = (page.viewportSize()?.width ?? 1440) < 640;
  const list = page.getByTestId('attack-list');
  const stolen = page.getByTestId('stolen-rows');
  if (!phone) {
    await expect(list).toBeVisible();
    await expect(stolen).toBeVisible();
    await expect(page.getByTestId('attack-fold').locator('summary')).toBeHidden();
    return;
  }
  await expect(list).toBeHidden();
  await expect(stolen).toBeHidden();
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  expect(h).toBeLessThan(5000);
  await page.getByTestId('attack-fold').locator('summary').click();
  await expect(list).toBeVisible();
  await expect(list.getByTestId('attack-row').first()).toBeVisible();
  await page.getByTestId('stolen-fold').locator('summary').click();
  await expect(stolen).toBeVisible();
});

test('Send: the delivery fee covers the measured relays of the link, and says who pays the rest', async ({ page }) => {
  await page.goto(`${BASE}/send`);
  await expect(page.getByTestId('delivery-fee')).toHaveText('0.38 QOR');
  await expect(page.getByTestId('delivery-line')).toContainText('3 relays this link needs (bind, confirm, claim');
  await page.getByTestId('mode-Open').click();
  await expect(page.getByTestId('delivery-fee')).toHaveText('0.26 QOR');
  await expect(page.getByTestId('delivery-line')).toContainText('2 relays this link needs (bind, claim');
  await expect(page.getByTestId('who-pays')).toContainText("relayed at the team's cost");
  await page.getByTestId('who-pays').getByRole('link').click();
  await expect(page).toHaveURL(/\/judges#costs$/);
  await expect(page.getByTestId('cost-table')).toBeInViewport({ timeout: 20_000 });
});

test('/judges: the cost table lists every action with a recorded tx, and the live relayer float', async ({ page }) => {
  await page.goto(`${BASE}/judges#costs`);
  const t = page.getByTestId('cost-table');
  await expect(t).toContainText('What each action costs, and who pays');
  for (const id of ['create', 'bind', 'confirm', 'claim', 'createPool', 'poolClaim', 'qday']) await expect(t.getByTestId(`cost-${id}`).getByRole('link')).toHaveAttribute('href', /^\/check\/[0-9A-F]{64}$/);
  await expect(t.getByTestId('cost-bind')).toContainText('0.125');
  await expect(page.getByTestId('cost-float-qor')).toHaveText(/^\d+\.\d{3} QOR$/, { timeout: 30_000 });
  await t.getByTestId('cost-claim').getByRole('link').click();
  await expect(page.getByTestId('check-verdict')).toBeVisible({ timeout: 90_000 });
});

test('one-tap share for the sample pool and the bait challenge: prepared in the app, nothing sent until the visitor picks an app', async ({ page }) => {
  const posts: string[] = [];
  page.on('request', (r) => { if (r.method() === 'POST' && /wa\.me|share|x\.com|twitter/.test(r.url())) posts.push(r.url()); });
  await page.goto(`${BASE}/receive`);
  const sp = page.getByTestId('sample-share');
  await expect(sp).toBeVisible({ timeout: 30_000 });
  await sp.getByTestId('sample-share-toggle').click();
  await expect(sp.getByTestId('sample-share-url')).toHaveText(/\/pool\/p\d+#k=[0-9a-f]{64}$/);
  await expect(sp.getByTestId('sample-share-whatsapp')).toHaveAttribute('href', /^https:\/\/wa\.me\/\?text=.*pool%2Fp\d+%23k%3D/);
  await expect(sp.getByTestId('sample-share-qr')).toBeVisible();
  await sp.getByTestId('sample-share-copy').click();
  await expect(sp.getByTestId('sample-share-copy')).toContainText('Copied');

  await page.goto(`${BASE}/qday`);
  const q = page.getByTestId('qday-share');
  await q.getByTestId('qday-share-toggle').click();
  await expect(q.getByTestId('qday-share-text')).toContainText('ML-DSA-87');
  await expect(q.getByTestId('qday-share-url')).toHaveText(/\/qday$/);
  await expect(q.getByTestId('qday-share-qr')).toBeVisible();
  await expect(q.getByTestId('qday-share-whatsapp')).toHaveAttribute('href', /^https:\/\/wa\.me\/\?text=.*%2Fqday$/);
  await expect(q.getByTestId('qday-share-whatsapp')).toHaveAttribute('target', '_blank');
  expect(posts).toEqual([]);
});

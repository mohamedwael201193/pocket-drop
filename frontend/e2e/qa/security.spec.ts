// Security headers on a deployed build: strict CSP, frame-ancestors 'none', Permissions-Policy, and no CSP violation on
// any route; the browser key is sealed at rest and survives a reload. Spends nothing.
//   E2E_URL=https://<preview> npx playwright test e2e/qa/security.spec.ts --project=chromium-1440
import { test, expect, previewHeaders } from '../fixtures';
import { isSealed, readRoot } from '../vault';

const BASE = process.env.E2E_URL || 'https://pocketdrop-app.vercel.app';
const ROUTES = ['/', '/app', '/send', '/send/inbox', '/receive', '/c/p12', '/c/p12#k=' + '00'.repeat(32), '/pool/p5', '/pocket', '/pocket?env=lab', '/proof', '/lab', '/radar', '/judges', '/qday', '/nope-404'];

test('headers: strict CSP with only the two backends, no framing, Permissions-Policy', async ({ request }) => {
  const r = await request.get(`${BASE}/qday`, { headers: previewHeaders });
  const h = r.headers();
  const csp = h['content-security-policy'] ?? '';
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("object-src 'none'");
  expect(csp).toMatch(/script-src 'self' 'wasm-unsafe-eval';/);
  expect(csp).not.toContain("'unsafe-inline'");
  expect(csp).not.toContain("'unsafe-eval'");
  const connect = /connect-src ([^;]+)/.exec(csp)![1].trim().split(/\s+/);
  expect(connect.sort()).toEqual(["'self'", 'https://evm-testnet.qore.host', 'https://pocketdrop-api.vercel.app'].sort());
  expect(h['permissions-policy']).toContain('camera=()');
  expect(h['x-frame-options']).toBe('DENY');
});

for (const path of ROUTES) {
  test(`no CSP violation and the page renders: ${path}`, async ({ page }) => {
    const violations: string[] = [];
    page.on('console', (m) => { if (/Content Security Policy|Refused to (load|connect|execute|apply)/i.test(m.text())) violations.push(m.text().slice(0, 300)); });
    await page.addInitScript(() => { document.addEventListener('securitypolicyviolation', (e) => console.error(`Content Security Policy violation: ${e.violatedDirective} ${e.blockedURI}`)); });
    await page.goto(BASE + path, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 25_000 }).catch(() => undefined);
    await page.waitForTimeout(1500);
    await expect(page.locator('#root')).not.toBeEmpty();
    expect(await page.locator('main, [data-testid]').count()).toBeGreaterThan(0);
    expect(violations).toEqual([]);
  });
}

// The LAB Pocket flow with a fresh key, a reload and the guardian forms open. WebKit prints "Refused to apply a stylesheet"
// when Playwright's page.screenshot() injects its own <style> tag, so QA runs that take screenshots see that line; the app
// itself injects no inline style. This test takes no screenshot and must stay clean in Chromium and WebKit.
test('no CSP violation while using the LAB Pocket (create key, reload, guardian forms)', async ({ page }) => {
  const violations: string[] = [];
  page.on('console', (m) => { if (/Content Security Policy|Refused to (load|connect|execute|apply)/i.test(m.text())) violations.push(m.text().slice(0, 300)); });
  await page.addInitScript(() => { document.addEventListener('securitypolicyviolation', (e) => console.error(`Content Security Policy violation: ${e.violatedDirective} ${e.blockedURI} ${e.sourceFile}:${e.lineNumber}`)); });
  await page.goto(`${BASE}/pocket?env=lab`);
  await page.getByTestId('create-key').click();
  await expect(page.getByTestId('key-address')).toHaveAttribute('data-address', /^0x/, { timeout: 60_000 });
  await page.waitForTimeout(3000);
  await page.reload();
  await expect(page.getByTestId('key-address')).toHaveAttribute('data-address', /^0x/, { timeout: 60_000 });
  await page.getByTestId('adopt-input').fill('0x' + '11'.repeat(20)).catch(() => undefined);
  await page.waitForTimeout(3000);
  expect(violations).toEqual([]);
});

for (const [kind, R1] of [['pd2', 'pd2:' + 'ab'.repeat(32)], ['legacy v1', 'ab'.repeat(32)]] as const)
test(`the browser key is sealed at rest, migrated from plaintext (${kind}), and opens the same Pocket after a reload`, async ({ page }) => {
  await page.goto(`${BASE}/receive`);
  await page.evaluate((r) => localStorage.setItem('pd.root.v4', r), R1); // plaintext, as older builds stored it
  await page.goto(`${BASE}/pocket`);
  await expect(page.getByTestId('pocket-address')).toBeVisible({ timeout: 60_000 });
  const addr = await page.getByTestId('pocket-address').innerText();
  await expect.poll(() => isSealed(page), { timeout: 10_000 }).toBe(true);
  expect(await page.evaluate(() => localStorage.getItem('pd.root.v4'))).not.toContain('abab');
  expect(await readRoot(page)).toBe(R1);
  await page.reload();
  await expect(page.getByTestId('pocket-address')).toHaveText(addr, { timeout: 60_000 });
  const extractable = await page.evaluate(() => new Promise<boolean>((res) => { const o = indexedDB.open('pd-vault', 1); o.onsuccess = () => { const r = o.result.transaction('keys').objectStore('keys').get('root-wrap-v1'); r.onsuccess = () => res((r.result as CryptoKey).extractable); }; }));
  expect(extractable).toBe(false);
});

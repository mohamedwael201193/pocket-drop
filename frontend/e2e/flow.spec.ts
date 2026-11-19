// Full flows against a DEPLOYED URL at 390x844: a real sender and a real recipient in two separate browser contexts.
//   E2E_URL=https://... npx playwright test --project=chromium
// Funds the sender from the deployer (testnet only; 15 QOR total cap enforced in scripts/chain.mjs).
// No secret is printed or stored here.
import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const URL = process.env.E2E_URL ?? 'https://pocketdrop-app.vercel.app';
const EVID = path.resolve('evidence/v2');
const AMOUNT = process.env.E2E_AMOUNT ?? '0.1';
const DRIP = process.env.E2E_DRIP ?? '0.2';
const VP = process.env.E2E_VP === 'd' ? 'd' : 'm'; // m = 390x844 phone, d = 1440x900 desktop
const FUND = process.env.E2E_FUND ?? '0.55';
fs.mkdirSync(EVID, { recursive: true });

const ctxOpts = VP === 'm'
  ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }
  : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 };
const hashOf = async (p: Page, testId: string) => (await p.getByTestId(testId).first().getAttribute('data-hash'))!;
const wordsOf = async (p: Page, testId: string) => ((await p.getByTestId(testId).textContent()) ?? '').toLowerCase().replace(/\d/g, ' ').split(/\s+/).filter((w) => /^[a-z]+$/.test(w));

async function run(browser: Browser, browserName: string, mode: 'Confirmed' | 'Open') {
  const label = `${browserName}-${VP === 'm' ? '390' : '1440'}-${mode.toLowerCase()}`;
  const shot = async (p: Page, name: string) => { await p.screenshot({ path: path.join(EVID, `${label}-${name}.png`), fullPage: true }); };
  const txs: Record<string, string> = {};
  const out: Record<string, unknown> = { url: URL, browser: browserName, mode, viewport: VP === 'm' ? '390x844' : '1440x900', startedAt: new Date().toISOString(), txs };
  const errors: string[] = [];
  let sctx: BrowserContext | undefined;
  let rctx: BrowserContext | undefined;
  try {
    sctx = await browser.newContext(ctxOpts);
    rctx = await browser.newContext(ctxOpts);
    const S = await sctx.newPage();
    const R = await rctx.newPage();
    for (const [n, p] of [['sender', S], ['recipient', R]] as const) {
      p.on('console', (m) => { if (m.type() === 'error') errors.push(`${n}: ${m.text()}`); });
      p.on('pageerror', (e) => errors.push(`${n} pageerror: ${e.message}`));
    }

    // ---- sender: create account, fund, create link
    await S.goto(URL + '/dashboard', { waitUntil: 'load' });
    await expect(S.getByTestId('testnet-badge')).toContainText('Diana');
    await S.getByTestId('create-sender').click();
    const senderEvm = (await S.getByTestId('sender-evm').textContent())!.trim();
    out.sender = senderEvm;
    await expect(S.getByTestId('fund-help')).toBeVisible();
    await shot(S, '1-sender-created');
    const fund = JSON.parse(execFileSync('node', ['scripts/fund.mjs', senderEvm, FUND, `e2e ${label}`], { encoding: 'utf8' }).trim().split('\n').pop()!);
    txs.fund = fund.hash;
    out.totalSpentQorSoFar = fund.totalSpentQor;
    await expect.poll(async () => BigInt((await S.getByTestId('sender-balance').getAttribute('data-wei')) || '0') > 0n, { timeout: 60_000 }).toBe(true);
    await expect(S.getByTestId('activate-sender')).toBeVisible({ timeout: 30_000 });
    await shot(S, '2a-needs-activation');
    await S.getByTestId('activate-sender').click();
    await expect(S.getByTestId('sender-active')).toBeVisible({ timeout: 180_000 });
    const nAct = await S.locator('[data-testid^="tx-activate-"]').count();
    for (let i = 0; i < nAct; i++) txs[`senderActivate${i}`] = (await S.getByTestId(`tx-activate-${i}`).getAttribute('data-hash'))!;
    await S.getByTestId(`mode-${mode}`).click();
    await S.getByTestId('amount').fill(AMOUNT);
    await S.getByTestId('drip').fill(DRIP);
    await expect(S.getByTestId('create-link')).toBeEnabled();
    await shot(S, '2-sender-funded-form');
    await S.getByTestId('create-link').click();
    const linkEl = S.getByTestId('claim-link');
    await expect(linkEl).toBeVisible({ timeout: 120_000 });
    const claimUrl = (await linkEl.getAttribute('data-url'))!;
    out.claimUrl = claimUrl.replace(/#k=.*/, '#k=<seed-not-recorded>');
    const id = /\/c\/(\d+)#k=[0-9a-f]{64}$/.exec(claimUrl)![1];
    out.linkId = id;
    // The WhatsApp button must carry the whole link, fragment included.
    const wa = (await S.getByTestId('whatsapp').getAttribute('href'))!;
    expect(wa.startsWith('https://wa.me/?text=')).toBe(true);
    expect(decodeURIComponent(wa.slice('https://wa.me/?text='.length)).endsWith(claimUrl)).toBe(true);
    await shot(S, '3-link-created');
    txs.create = (await S.getByTestId('tx-create').getAttribute('data-hash'))!;

    // ---- recipient: open the link in a separate context, no wallet
    await R.goto(claimUrl, { waitUntil: 'load' });
    await expect(R.getByTestId('incoming-amount')).toContainText(AMOUNT);
    await shot(R, '4-recipient-open');
    await R.getByTestId('start-claim').click();
    await expect(R.getByTestId('step-bind')).toHaveAttribute('data-status', 'done', { timeout: 120_000 });
    txs.bind = await hashOf(R, 'tx-bind');
    await expect(R.getByTestId('step-register')).toHaveAttribute('data-status', 'done', { timeout: 120_000 });
    txs.register = await hashOf(R, 'tx-register');
    await expect(R.getByTestId('step-window')).toHaveAttribute('data-status', /done|skipped/, { timeout: 120_000 });
    out.windowStatus = await R.getByTestId('step-window').getAttribute('data-status');
    if (out.windowStatus === 'done') txs.window = await hashOf(R, 'tx-window');

    if (mode === 'Confirmed') {
      await expect(R.getByTestId('fingerprint')).toBeVisible({ timeout: 60_000 });
      const rWords = await wordsOf(R, 'fingerprint');
      expect(rWords).toHaveLength(4);
      out.fingerprint = rWords;
      await shot(R, '5-recipient-fingerprint');
      // Claim must NOT happen before the sender confirms.
      await R.waitForTimeout(4000);
      expect(await R.getByTestId('step-claim').getAttribute('data-status')).toBe('idle');
      // The sender sees the same four words and confirms.
      await expect(S.getByTestId(`fp-${id}`)).toBeVisible({ timeout: 60_000 });
      expect(await wordsOf(S, `fp-${id}`)).toEqual(rWords);
      await shot(S, '6-sender-confirm-panel');
      await S.getByTestId(`confirm-${id}`).click();
      await expect(S.getByTestId(`tx-confirm-${id}`)).toBeVisible({ timeout: 120_000 });
      txs.confirm = await hashOf(S, `tx-confirm-${id}`);
    }

    await expect(R.getByTestId('claim-page')).toHaveAttribute('data-done', '1', { timeout: 180_000 });
    txs.claim = await hashOf(R, 'tx-claim');
    await expect(R.getByTestId('step-verify')).toHaveAttribute('data-status', mode === 'Open' ? 'skipped' : 'done');
    const stepMs: Record<string, number> = {};
    for (const k of ['key', 'bind', 'register', 'window', 'claim']) { const v = await R.getByTestId(`step-${k}`).getAttribute('data-ms'); if (v) stepMs[k] = Number(v); }
    out.stepMs = stepMs;
    const want = BigInt(Math.round(Number(AMOUNT) * 1e6)) * 10n ** 12n;
    await expect.poll(async () => BigInt((await R.getByTestId('final-balance').getAttribute('data-wei')) || '0') >= want, { timeout: 60_000 }).toBe(true);
    out.recipientFinalBalanceWei = await R.getByTestId('final-balance').getAttribute('data-wei');
    await shot(R, '7-recipient-claimed');
    await expect(S.getByTestId(`state-${id}`)).toHaveText('Claimed', { timeout: 60_000 });
    await shot(S, '8-sender-sees-claimed');
    expect(errors.filter((e) => !/favicon|fonts\.g/.test(e)), 'console errors').toEqual([]);
    expect(await R.getByTestId('claim-error').count()).toBe(0);
    out.result = 'PASS';
  } catch (e) {
    out.result = 'FAIL';
    out.error = String((e as Error).message).slice(0, 800);
    for (const [i, c] of [sctx, rctx].entries()) for (const p of c?.pages() ?? []) await p.screenshot({ path: path.join(EVID, `${label}-FAIL-${i}.png`), fullPage: true }).catch(() => undefined);
    throw e;
  } finally {
    out.consoleErrors = errors;
    out.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(EVID, `e2e-${label}.json`), JSON.stringify(out, null, 1));
    await sctx?.close();
    await rctx?.close();
  }
}

for (const mode of ['Confirmed', 'Open'] as const) {
  test(`${mode} flow end to end`, async ({ browser, browserName }) => { await run(browser, browserName, mode); });
}

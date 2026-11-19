// Full flows against a DEPLOYED URL: a real sender and a real recipient in two separate browser contexts.
//   E2E_URL=https://... [E2E_VP=d] npx playwright test --project=chromium
// Funds the sender from the deployer (testnet only; 4 QOR total cap enforced in scripts/chain.mjs). No secret is printed or stored here.
import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const URL = process.env.E2E_URL ?? 'https://pocketdrop-app.vercel.app';
const EVID = path.resolve('evidence/v3/e2e');
const AMOUNT = process.env.E2E_AMOUNT ?? '0.1';
const DRIP = process.env.E2E_DRIP ?? '0.2';
const VP = process.env.E2E_VP === 'd' ? 'd' : 'm'; // m = 390x844 phone, d = 1440x900 desktop
const FUND = process.env.E2E_FUND ?? '0.55';
const ONLY = process.env.E2E_ONLY; // Confirmed | Open
fs.mkdirSync(EVID, { recursive: true });

const ctxOpts = VP === 'm'
  ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }
  : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 };
const hashOf = async (p: Page, testId: string) => (await p.getByTestId(testId).first().getAttribute('data-hash'))!;
const wordsOf = async (p: Page, testId: string) => ((await p.getByTestId(testId).textContent()) ?? '').toLowerCase().replace(/\d/g, ' ').split(/\s+/).filter((w) => /^[a-z]+$/.test(w));

async function run(browser: Browser, browserName: string, mode: 'Confirmed' | 'Open') {
  const label = `${browserName}-${VP === 'm' ? '390' : '1440'}-${mode.toLowerCase()}`;
  const shot = async (p: Page, name: string) => { await p.screenshot({ path: path.join(EVID, `${label}-${name}.png`), fullPage: VP === 'd' }); };
  const txs: Record<string, string> = {};
  const out: Record<string, unknown> = { url: URL, browser: browserName, mode, viewport: VP === 'm' ? '390x844' : '1440x900', startedAt: new Date().toISOString(), txs };
  const errors: string[] = [];
  let sctx: BrowserContext | undefined;
  let rctx: BrowserContext | undefined;
  let dctx: BrowserContext | undefined;
  try {
    sctx = await browser.newContext(ctxOpts);
    rctx = await browser.newContext(ctxOpts);
    const S = await sctx.newPage();
    const R = await rctx.newPage();
    for (const [n, p] of [['sender', S], ['recipient', R]] as const) {
      p.on('console', (m) => { if (m.type() === 'error') errors.push(`${n}: ${m.text()}`); });
      p.on('pageerror', (e) => errors.push(`${n} pageerror: ${e.message}`));
    }

    // ---- sender: Send tab, account (this browser), fund, activate, create
    await S.goto(URL + '/send', { waitUntil: 'load' });
    await expect(S.getByTestId('testnet-badge')).toContainText('Diana');
    await expect(S.getByTestId('connect-qorex')).toHaveCount(0); // QoreX is absent here and must never block the flow
    await S.getByTestId('create-sender').click();
    await expect(S.getByTestId('fund-help')).toBeVisible();
    const senderEvm = (await S.getByTestId('sender-evm').textContent())!.trim();
    out.sender = senderEvm;
    await shot(S, '1-account-created');
    const fund = JSON.parse(execFileSync('node', ['scripts/fund.mjs', senderEvm, FUND, `e2e ${label}`], { encoding: 'utf8' }).trim().split('\n').pop()!);
    txs.fund = fund.hash;
    out.totalSpentQorSoFar = fund.totalSpentQor;
    await expect.poll(async () => BigInt((await S.getByTestId('sender-balance').getAttribute('data-wei')) || '0') > 0n, { timeout: 60_000 }).toBe(true);
    await expect(S.getByTestId('activate-sender')).toBeVisible({ timeout: 30_000 });
    await shot(S, '2-needs-activation');
    await S.getByTestId('activate-sender').click();
    await expect(S.getByTestId('sender-active')).toBeVisible({ timeout: 180_000 });
    const nAct = await S.locator('[data-testid^="tx-activate-"]').count();
    for (let i = 0; i < nAct; i++) txs[`senderActivate${i}`] = (await S.getByTestId(`tx-activate-${i}`).getAttribute('data-hash'))!;
    await S.getByTestId(`mode-${mode}`).click();
    await S.getByTestId('amount').fill(AMOUNT);
    await S.getByText('Gas drip and expiry').click();
    await S.getByTestId('drip').fill(DRIP);
    await expect(S.getByTestId('create-link')).toBeEnabled();
    await shot(S, '3-ready-to-create');
    await S.getByTestId('create-link').click();
    const linkEl = S.getByTestId('claim-link');
    await expect(linkEl).toBeVisible({ timeout: 120_000 });
    const claimUrl = (await linkEl.getAttribute('data-url'))!;
    out.claimUrl = claimUrl.replace(/#k=.*/, '#k=<seed-not-recorded>');
    const id = /\/c\/(\d+)#k=[0-9a-f]{64}$/.exec(claimUrl)![1];
    out.linkId = id;
    const wa = (await S.getByTestId('whatsapp').getAttribute('href'))!;
    expect(wa.startsWith('https://wa.me/?text=')).toBe(true);
    expect(decodeURIComponent(wa.slice('https://wa.me/?text='.length)).endsWith(claimUrl)).toBe(true);
    await shot(S, '4-share');
    txs.create = (await S.getByTestId('tx-create').getAttribute('data-hash'))!;
    await S.getByTestId('go-inbox').click();
    await expect(S.getByTestId(`link-${id}`)).toHaveAttribute('data-state', 'Open', { timeout: 60_000 });
    await shot(S, '5-inbox-open');

    // ---- recipient: open the link in a separate context, no wallet
    await R.goto(claimUrl, { waitUntil: 'load' });
    await expect(R.getByTestId('incoming-amount')).toContainText(AMOUNT);
    await shot(R, '6-recipient-ready');
    await R.getByTestId('start-claim').click();
    await expect(R.getByTestId('step-bind')).toHaveAttribute('data-status', 'done', { timeout: 120_000 });
    txs.bind = await hashOf(R, 'tx-bind');
    await expect(R.getByTestId('step-register')).toHaveAttribute('data-status', 'done', { timeout: 120_000 });
    txs.register = await hashOf(R, 'tx-register');
    await expect(R.getByTestId('step-window')).toHaveAttribute('data-status', /done|skipped/, { timeout: 120_000 });
    out.windowStatus = await R.getByTestId('step-window').getAttribute('data-status');
    if (out.windowStatus === 'done') txs.window = await hashOf(R, 'tx-window');

    if (mode === 'Confirmed') {
      await expect(R.getByTestId('waiting-confirm')).toBeVisible({ timeout: 60_000 });
      await expect(R.getByTestId('waiting-confirm')).toContainText('Nothing is broken');
      const rWords = await wordsOf(R, 'fingerprint');
      expect(rWords).toHaveLength(4);
      out.fingerprint = rWords;
      await expect(R.getByTestId('copy-words')).toBeVisible();
      const waR = decodeURIComponent((await R.getByTestId('whatsapp-sender').getAttribute('href'))!);
      expect(waR).toContain(`/send/inbox?link=${id}`);
      for (const w of rWords) expect(waR).toContain(w);
      await shot(R, '7-recipient-waiting');
      await R.waitForTimeout(4000);
      expect(await R.getByTestId('step-claim').getAttribute('data-status')).toBe('idle'); // never claims before the sender confirms
      // The sender follows the deep link from the message and confirms in one tap.
      const deep = /(https?:\/\/\S+\/send\/inbox\?link=\d+)/.exec(waR)![1];
      await S.goto(deep, { waitUntil: 'load' });
      await expect(S.getByTestId(`fp-${id}`)).toBeVisible({ timeout: 60_000 });
      expect(await wordsOf(S, `fp-${id}`)).toEqual(rWords);
      await shot(S, '8-sender-confirm');
      await S.getByTestId(`confirm-${id}`).click();
      await expect(S.getByTestId(`tx-confirm-${id}`)).toBeVisible({ timeout: 120_000 });
      txs.confirm = await hashOf(S, `tx-confirm-${id}`);
    }

    await expect(R.getByTestId('claim-state')).toHaveAttribute('data-done', '1', { timeout: 180_000 });
    txs.claim = await hashOf(R, 'tx-claim');
    await expect(R.getByTestId('step-verify')).toHaveAttribute('data-status', mode === 'Open' ? 'skipped' : 'done');
    const stepMs: Record<string, number> = {};
    for (const k of ['key', 'bind', 'register', 'window', 'claim']) { const v = await R.getByTestId(`step-${k}`).getAttribute('data-ms'); if (v) stepMs[k] = Number(v); }
    out.stepMs = stepMs;
    const want = BigInt(Math.round(Number(AMOUNT) * 1e6)) * 10n ** 12n;
    await expect.poll(async () => BigInt((await R.getByTestId('final-balance').getAttribute('data-wei')) || '0') >= want, { timeout: 60_000 }).toBe(true);
    out.recipientFinalBalanceWei = await R.getByTestId('final-balance').getAttribute('data-wei');
    await shot(R, '9-recipient-yours');
    await S.goto(URL + '/send/inbox', { waitUntil: 'load' });
    await expect(S.getByTestId(`state-${id}`)).toHaveText('Claimed', { timeout: 60_000 });
    out.senderBalanceWeiAtEnd = await (async () => { await S.goto(URL + '/pocket'); await expect(S.getByTestId('sender-balance')).toHaveAttribute('data-wei', /\d+/, { timeout: 30_000 }); return S.getByTestId('sender-balance').getAttribute('data-wei'); })();
    await S.goto(URL + '/send/inbox', { waitUntil: 'load' });
    await expect(S.getByTestId(`state-${id}`)).toHaveText('Claimed', { timeout: 60_000 });
    await shot(S, '10-inbox-claimed');

    if (mode === 'Confirmed') {
      // "Any device": restore the account on a fresh browser profile with the device-transfer link; the inbox is rebuilt from chain events.
      const key = await S.evaluate(() => localStorage.getItem('pd.sender.v1'));
      expect(key).toMatch(/^0x[0-9a-f]{64}$/i);
      dctx = await browser.newContext(ctxOpts);
      const D = await dctx.newPage();
      await D.goto(`${URL}/pocket#restore=${key!.slice(2)}`, { waitUntil: 'load' });
      await expect(D.getByTestId('sender-evm')).toHaveText(senderEvm, { timeout: 30_000 });
      await D.goto(URL + '/send/inbox', { waitUntil: 'load' });
      await expect(D.getByTestId(`link-${id}`)).toHaveAttribute('data-state', 'Claimed', { timeout: 90_000 });
      out.inboxRestoredOnFreshDevice = true;
      await shot(D, '11-inbox-on-second-device');
    }
    expect(errors.filter((e) => !/favicon|fonts\.g|due to access control checks/.test(e)), 'console errors').toEqual([]);
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
    await dctx?.close();
  }
}

for (const mode of ['Confirmed', 'Open'] as const) {
  if (ONLY && ONLY !== mode) continue;
  test(`${mode} flow end to end`, async ({ browser, browserName }) => { await run(browser, browserName, mode); });
}

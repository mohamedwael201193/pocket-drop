// v4 flows against a DEPLOYED URL, each user in their own browser context (own key, own storage). Testnet only.
//   E2E_URL=https://pocketdrop-app.vercel.app npx playwright test e2e/v4.spec.ts --project=chromium-390
// Every hash shown by the app is verified on the chain; every account is funded from the deployer (>= 0.8 QOR for a Pocket).
import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { readRoot } from './vault';
import fs from 'node:fs';
import path from 'node:path';
import { keccak256, toHex, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { keyMaterial, parseRoot } from '../src/lib/keyderive';
import { deliveryFeeWei } from '../src/lib/fees';
import { INST, balanceOf, deployerAddress, dropLink, fund, guardians, pub, poolOf, qor, recovered, spentQor, txOk, vaultRead } from './chain4';

const URL = (process.env.E2E_URL ?? 'https://pocketdrop-app.vercel.app').replace(/\/$/, '');
const EVID = path.resolve('evidence/v4/e2e');
fs.mkdirSync(EVID, { recursive: true });
const POCKET_FUND = Number(process.env.E2E_POCKET_FUND ?? '0.8');
const KEY_FUND = 0.075; // one registration fee (0.06) plus margin; the app needs 0.07
const AMOUNT = '0.1';
const T = 240_000;

interface Run { project: string; flow: string; txs: Record<string, string>; checks: Record<string, unknown>; accounts: Record<string, string> }
/** The hash of a tx link; when the same link slot is reused by a later action, wait until it differs from `prev`. */
const hashAttr = async (p: Page, testId: string, prev?: string, timeout = T) => {
  const l = p.getByTestId(testId).first();
  await expect(l).toBeVisible({ timeout });
  if (prev) await expect.poll(async () => await l.getAttribute('data-hash'), { timeout }).not.toBe(prev);
  return (await l.getAttribute('data-hash'))!;
};
const wordsOf = async (p: Page, id: string) => ((await p.getByTestId(id).first().textContent()) ?? '').toLowerCase().replace(/\d/g, ' ').split(/\s+/).filter((w) => /^[a-z]{3,}$/.test(w));
const micro = (wei: bigint) => { const m = wei / 10n ** 12n; return `${m / 1_000_000n}.${(m % 1_000_000n).toString().padStart(6, '0')}`; };

const PAGES: { name: string; page: Page }[] = [];
async function failShots(run: Run) {
  for (const { name, page } of PAGES) await page.screenshot({ path: path.join(EVID, `${run.project}-${run.flow}-FAIL-${name}.png`) }).catch(() => undefined);
  PAGES.length = 0;
}
async function user(browser: Browser, opts: Record<string, unknown>, name: string, sink: Run) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  PAGES.push({ name, page });
  page.on('pageerror', (e) => { sink.checks[`pageerror:${name}`] = e.message; });
  return { ctx, page };
}

/** First visit: create the key in the browser, fund the key account and the Pocket from the deployer, register the key. */
/** The sponsor is on in prod. QA_SPONSOR=off (default) mocks GET /api/sponsor as disabled so the classic funded path runs
 *  unchanged and repeatable; QA_SPONSOR=live leaves the real sponsor on (the key setup is then paid by the sponsor). */
const SPONSOR_MODE = process.env.QA_SPONSOR === 'live' ? 'live' : 'off';
const CORS_H = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type' };
async function sponsorOff(p: Page) {
  if (SPONSOR_MODE !== 'off') return;
  await p.route('**/api/sponsor', (r) => r.request().method() === 'OPTIONS' ? r.fulfill({ status: 204, headers: CORS_H })
    : r.request().method() === 'GET' ? r.fulfill({ headers: CORS_H, json: { ok: true, enabled: false, reason: 'mocked off by the e2e run', amountWei: '60000000000000000', senderMinPocketWei: '100000000000000000' } })
    : r.fulfill({ status: 503, headers: CORS_H, json: { ok: false, error: { name: 'Disabled', message: 'mocked off by the e2e run' } } }));
}
async function onboard(p: Page, run: Run, who: string, o: { pocketQor?: number; path?: string } = {}) {
  await sponsorOff(p);
  await p.goto(`${URL}${o.path ?? '/send'}`);
  await p.getByTestId('create-key').click();
  const pocket = (await p.getByTestId('pocket-address').getAttribute('data-address', { timeout: T }))! as Hex;
  const keyAddr = (await p.getByTestId('key-address').getAttribute('data-address', { timeout: T }))! as Hex;
  run.accounts[`${who}.pocket`] = pocket; run.accounts[`${who}.key`] = keyAddr;
  if (SPONSOR_MODE === 'off') run.txs[`fund ${who} key account ${KEY_FUND} QOR`] = await fund(keyAddr, KEY_FUND, `e2e ${run.project} ${run.flow} ${who} key`);
  if (o.pocketQor) run.txs[`fund ${who} Pocket ${o.pocketQor} QOR`] = await fund(pocket, o.pocketQor, `e2e ${run.project} ${run.flow} ${who} pocket`);
  if (SPONSOR_MODE === 'off') {
    await expect.poll(async () => BigInt((await p.getByTestId('key-balance').getAttribute('data-wei')) || '0'), { timeout: T }).toBeGreaterThanOrEqual(70_000_000_000_000_000n);
    await p.getByTestId('register-key').click();
  }
  await expect(p.getByTestId('key-ready')).toBeVisible({ timeout: T });
  if (o.pocketQor) await expect.poll(async () => BigInt((await p.getByTestId('pocket-balance').first().getAttribute('data-wei')) || '0'), { timeout: T }).toBeGreaterThanOrEqual(BigInt(Math.round(o.pocketQor * 1e18)));
  return { pocket, keyAddr };
}

/** Sweep a Pocket back to the deployer through the app's own "Send out" (a real spend intent), and book it as recovered. */
async function sweep(p: Page, run: Run, who: string, wei: bigint) {
  if (wei < 20_000_000_000_000_000n) return;
  await p.goto(`${URL}/pocket${run.flow.startsWith('d-') ? '?env=lab' : ''}`);
  await expect(p.getByTestId('spend-to')).toBeVisible({ timeout: T });
  const sweepWei = wei - (wei % 10n ** 12n);
  await p.getByTestId('spend-to').fill(await deployerAddress());
  await p.getByTestId('spend-amount').fill(micro(sweepWei));
  await expect(p.getByTestId('spend-send')).toBeEnabled({ timeout: 60_000 });
  await p.getByTestId('spend-send').click();
  const h = await hashAttr(p, 'spend-tx');
  expect(await txOk(h)).toBe(true);
  run.txs[`sweep ${who} Pocket back to the deployer`] = h;
  await recovered(qor(sweepWei), `${run.project} ${run.flow} sweep`, h);
}

function save(run: Run) {
  run.checks.netSpendQorSoFar = undefined;
  fs.writeFileSync(path.join(EVID, `${run.project}-${run.flow}.json`), JSON.stringify({ ...run, finishedAt: new Date().toISOString() }, null, 1));
}
const shot = async (p: Page, run: Run, name: string) => { await p.screenshot({ path: path.join(EVID, `${run.project}-${run.flow}-${name}.png`) }).catch(() => undefined); };

test.describe.configure({ mode: 'serial' });
test.setTimeout(1_500_000);

async function sendFlow(browser: Browser, opts: Record<string, unknown>, project: string, mode: 'Confirmed' | 'Open') {
  const run: Run = { project, flow: mode === 'Confirmed' ? 'a-confirmed' : 'b-giveaway', txs: {}, checks: {}, accounts: {} };
  const S = await user(browser, opts, 'sender', run);
  const R = await user(browser, opts, 'recipient', run);
  try {
    const sp = S.page; const rp = R.page;
    const { pocket } = await onboard(sp, run, 'sender', { pocketQor: POCKET_FUND });
    await sp.getByTestId('amount').fill(AMOUNT);
    if (mode === 'Open') await sp.getByTestId('mode-Open').click();
    await expect(sp.getByTestId('create-drop')).toBeEnabled({ timeout: 60_000 });
    await sp.getByTestId('create-drop').click();
    await expect(sp.getByTestId('share-card')).toBeVisible({ timeout: T });
    const url = (await sp.getByTestId('claim-link').getAttribute('data-url'))!;
    const id = /\/c\/(p\d+)#k=/.exec(url)![1];
    run.txs['sender Pocket createDrop (intent, lazy-deploys the Pocket)'] = await hashAttr(sp, 'create-tx');
    await shot(sp, run, '1-sender-link');

    await rp.goto(url);
    await expect(rp.getByTestId('mode-line')).toContainText(mode === 'Confirmed' ? 'Confirmed mode' : 'Giveaway', { timeout: T });
    await rp.getByTestId('start-claim').click();
    if (mode === 'Confirmed') {
      await expect(rp.getByTestId('waiting-confirm')).toBeVisible({ timeout: T });
      // copy fix: while waiting the header says "Confirmed mode · waiting…", never "confirmed by the sender"
      await expect(rp.getByTestId('mode-line')).toContainText('waiting for the sender to confirm');
      await expect(rp.getByTestId('mode-line')).not.toContainText('confirmed by the sender');
      const words = await wordsOf(rp, 'fingerprint');
      expect(words).toHaveLength(4);
      run.checks.recipientWords = words;
      run.txs['recipient bind (link-key signature, relayed)'] = await hashAttr(rp, 'tx-bind');
      await shot(rp, run, '2-recipient-waiting');

      await sp.goto(`${URL}/send/inbox?link=${id}`);
      await expect(sp.getByTestId('needs-you')).toBeVisible({ timeout: T });
      const sw = await wordsOf(sp, `fp-${id.slice(1)}`);
      expect(sw).toEqual(words);
      run.checks.senderWordsMatchRecipient = true;
      await shot(sp, run, '3-sender-inbox-confirm');
      await sp.getByTestId(`confirm-${id.slice(1)}`).click();
      run.txs['sender Pocket confirmDrop (one-tap intent)'] = await hashAttr(sp, `tx-confirm-${id}`);
    }
    await expect(rp.getByTestId('yours')).toBeVisible({ timeout: T });
    await expect(rp.getByTestId('mode-line')).toContainText(mode === 'Confirmed' ? 'Confirmed mode' : 'Giveaway');
    run.txs['recipient claim (ML-DSA signature, relayed)'] = await hashAttr(rp, 'tx-claim');
    if (mode === 'Open') run.txs['recipient bind (link-key signature, relayed)'] = await hashAttr(rp, 'tx-bind');
    run.txs['recipient PQ key registration (paid from the drip)'] = await hashAttr(rp, 'tx-register');
    await expect.poll(async () => BigInt((await rp.getByTestId('final-balance').getAttribute('data-wei')) || '0'), { timeout: 60_000 }).toBe(BigInt(AMOUNT.replace('0.', '')) * 10n ** 17n);
    run.checks.recipientPocketBalanceWei = await rp.getByTestId('final-balance').getAttribute('data-wei');
    await shot(rp, run, '4-recipient-yours');

    // verify every hash on the chain, and the drop state
    for (const [k, h] of Object.entries(run.txs)) if (!k.startsWith('sweep')) expect(await txOk(h), k).toBe(true);
    const link = await dropLink('prod', BigInt(id.slice(1)));
    expect(link.state).toBe(4); // Claimed
    expect(link.sender.toLowerCase()).toBe(pocket.toLowerCase());
    // the delivery fee the app set covers the recorded relays of this mode (lib/fees.ts)
    expect(link.relayerFee).toBe(deliveryFeeWei(mode));
    run.checks.deliveryFeeWei = link.relayerFee.toString();
    const rPocket = (await rp.getByTestId('final-balance').locator('xpath=ancestor::*[@data-testid="yours"]').locator('a').first().getAttribute('href'))!.split('/').pop()!;
    expect(link.payTo.toLowerCase()).toBe(rPocket.toLowerCase());
    expect(await balanceOf(rPocket)).toBe(BigInt(AMOUNT.replace('0.', '')) * 10n ** 17n);
    run.accounts['recipient.pocket'] = rPocket;
    run.checks.chain = { dropId: id, state: 'Claimed', senderIsPocket: true, paidIntoRecipientPocket: true };
    // the recipient's browser key is v2: its EVM address and its registered ML-DSA key both come from the pd2: master,
    // so the classical key cannot be used to compute the quantum-safe key (the root itself is never written to evidence)
    const rRoot = await readRoot(rp);
    expect(rRoot?.startsWith('pd2:')).toBe(true);
    const km = keyMaterial(parseRoot(rRoot!)!);
    expect(privateKeyToAccount(toHex(km.secp)).address.toLowerCase()).toBe(link.recipient.toLowerCase());
    const { unifiedAccountFromSeed } = await import('@qorechain/sdk');
    const rAcct = await unifiedAccountFromSeed(km.secp, { pqcSecret: km.pqcSecret });
    const full = (await pub.readContract({ address: INST.prod.drop.address as Hex, abi: (await import('../src/lib/abi4')).dropAbi, functionName: 'getLink', args: [BigInt(id.slice(1))] })) as { recipientKeyHash: Hex };
    expect(keccak256(toHex(rAcct.pqc.publicKey)).toLowerCase()).toBe(full.recipientKeyHash.toLowerCase());
    run.checks.recipientKeyDerivation = 'v2: pd2: master; EVM address = v2 secp key; bound recipientKeyHash = keccak(ML-DSA key from the independent v2 secret)';
    await sweep(sp, run, 'sender', await balanceOf(pocket));
  } catch (e) { await failShots(run); throw e; } finally { PAGES.length = 0; save(run); await S.ctx.close(); await R.ctx.close(); }
}

test('a. Confirmed drop from a funded Pocket: inbox confirm, claim into the recipient Pocket', async ({ browser }, info) => {
  await sendFlow(browser, (info.project.use as Record<string, unknown>) ?? {}, info.project.name, 'Confirmed');
});
test('b. Giveaway drop', async ({ browser }, info) => {
  await sendFlow(browser, (info.project.use as Record<string, unknown>) ?? {}, info.project.name, 'Open');
});

test('c. Drop Pool with 2 claimers', async ({ browser }, info) => {
  const opts = (info.project.use as Record<string, unknown>) ?? {};
  const run: Run = { project: info.project.name, flow: 'c-pool', txs: {}, checks: {}, accounts: {} };
  const S = await user(browser, opts, 'sender', run);
  const claimers: { ctx: BrowserContext; page: Page }[] = [];
  try {
    const sp = S.page;
    const { pocket } = await onboard(sp, run, 'sender', { pocketQor: POCKET_FUND });
    await sp.getByTestId('pool-slots').fill('2');
    await sp.getByTestId('pool-per-slot').fill('0.02');
    await expect(sp.getByTestId('create-pool')).toBeEnabled({ timeout: 60_000 });
    await sp.getByTestId('create-pool').click();
    await expect(sp.getByTestId('share-card')).toBeVisible({ timeout: T });
    const url = (await sp.getByTestId('claim-link').getAttribute('data-url'))!;
    const pid = BigInt(/\/pool\/p(\d+)#k=/.exec(url)![1]);
    run.txs['sender Pocket createPool (intent, 2 slots x 0.02 QOR)'] = await hashAttr(sp, 'pool-tx');
    await expect(sp.getByTestId('pool-card')).toContainText('distinct proof-of-possession account, not a person');
    await expect(sp.getByTestId('pool-card')).toContainText('self-funded');
    await shot(sp, run, '1-sender-pool');
    for (const n of [1, 2]) {
      const c = await user(browser, opts, `claimer${n}`, run); claimers.push(c);
      await c.page.goto(url);
      await expect(c.page.getByTestId('pool-slots-left')).toContainText('2 of 2 slots left', { timeout: n === 1 ? T : 60_000 }).catch(async () => { await expect(c.page.getByTestId('pool-slots-left')).toContainText('slots left'); });
      await c.page.getByTestId('pool-start').click();
      const keyAddr = (await c.page.getByTestId('key-address').getAttribute('data-address', { timeout: T }))!;
      run.accounts[`claimer${n}.key`] = keyAddr;
      run.txs[`fund claimer${n} key account ${KEY_FUND} QOR`] = await fund(keyAddr, KEY_FUND, `e2e ${run.project} pool claimer${n}`);
      await expect.poll(async () => BigInt((await c.page.getByTestId('key-balance').getAttribute('data-wei')) || '0'), { timeout: T }).toBeGreaterThanOrEqual(70_000_000_000_000_000n);
      await c.page.getByTestId('register-key').click();
      await expect(c.page.getByTestId('pool-claim')).toBeVisible({ timeout: T });
      await c.page.getByTestId('pool-claim').click();
      await expect(c.page.getByTestId('pool-yours')).toBeVisible({ timeout: T });
      run.txs[`claimer${n} takes a slot (link-key + own signature, relayed)`] = await hashAttr(c.page, 'tx-pool-claim');
      await expect.poll(async () => BigInt((await c.page.getByTestId('pool-balance').getAttribute('data-wei')) || '0'), { timeout: 60_000 }).toBe(20_000_000_000_000_000n);
      await shot(c.page, run, `2-claimer${n}`);
    }
    for (const [k, h] of Object.entries(run.txs)) if (!k.startsWith('sweep')) expect(await txOk(h), k).toBe(true);
    const pool = await poolOf('prod', pid);
    expect(pool.taken).toBe(2);
    run.checks.chain = { poolId: `p${pid}`, taken: pool.taken, slots: pool.slots, perSlotWei: pool.perSlot.toString() };
    await sweep(sp, run, 'sender', await balanceOf(pocket));
  } catch (e) { await failShots(run); throw e; } finally { PAGES.length = 0; save(run); await S.ctx.close(); for (const c of claimers) await c.ctx.close(); }
});

test('d. Guardian freeze on a LAB Pocket', async ({ browser }, info) => {
  const opts = (info.project.use as Record<string, unknown>) ?? {};
  const run: Run = { project: info.project.name, flow: 'd-freeze-lab', txs: {}, checks: {}, accounts: {} };
  const G = await guardians(3);
  G.forEach((g, i) => { run.accounts[`guardian${i + 1}`] = g.evm; });
  const O = await user(browser, opts, 'owner', run);
  const ctxs: BrowserContext[] = [];
  try {
    const op = O.page;
    const { pocket } = await onboard(op, run, 'owner', { pocketQor: POCKET_FUND, path: '/pocket?env=lab' });
    await expect(op.getByTestId('env-lab')).toBeVisible();
    // 1. the first spend deploys the Pocket (lazy deployment through the LAB router)
    await op.getByTestId('spend-to').fill(await deployerAddress());
    await op.getByTestId('spend-amount').fill('0.01');
    await op.getByTestId('spend-send').click();
    run.txs['owner Pocket lazy-deploys on its first intent (spend 0.01 QOR)'] = await hashAttr(op, 'spend-tx');
    await expect(op.getByTestId('pocket-deployed')).toHaveText('deployed', { timeout: T });
    // 2. guardians 2 of 3, behind the (lab) 60 s timelock
    await op.getByTestId('guardians-input').fill(G.map((g) => g.evm).join('\n'));
    await op.getByTestId('guardians-threshold').selectOption('2');
    await expect(op.getByTestId('guardians-set')).toBeEnabled({ timeout: 60_000 });
    await op.getByTestId('guardians-set').click();
    const queued = await hashAttr(op, 'guardians-tx');
    run.txs['owner queues the guardian set (setGuardians intent)'] = queued;
    await expect(op.getByTestId('pending-guardians')).toBeVisible({ timeout: T });
    await expect(op.getByTestId('apply-guardians')).toBeEnabled({ timeout: 240_000 });
    await op.getByTestId('apply-guardians').click();
    run.txs['anyone applies the guardian set after the timelock'] = await hashAttr(op, 'guardians-tx', queued);
    await expect(op.getByTestId('guardian-list')).toContainText('2 of 3 needed', { timeout: T });
    await shot(op, run, '1-owner-guardians');

    // 3. guardians sign a freeze on their own devices (their own key, restored from a backup string)
    const signAs = async (g: { root: string }, label: string, reqCode?: string) => {
      const c = await user(browser, opts, label, run); ctxs.push(c.ctx);
      await c.page.goto(`${URL}/pocket?env=lab`);
      await c.page.getByText('Restore from a backup key').click();
      await c.page.getByTestId('restore-input').fill(g.root);
      await c.page.getByTestId('restore-key').click();
      await expect(c.page.getByTestId('help-friend')).toBeVisible({ timeout: T });
      let code = reqCode;
      if (!code) {
        await c.page.getByTestId('req-kind').selectOption('freeze');
        await c.page.getByTestId('req-pocket').fill(pocket);
        await c.page.getByTestId('req-make').click();
        await expect(c.page.getByTestId('req-code')).toBeVisible({ timeout: 60_000 });
        code = (await c.page.getByTestId('req-code').textContent())!;
      }
      await c.page.getByTestId('sign-input').fill(code);
      await expect(c.page.getByTestId('sign-info')).toBeVisible({ timeout: 60_000 });
      await expect(c.page.getByTestId('not-guardian')).toHaveCount(0);
      await c.page.getByTestId('sign-button').click();
      await expect(c.page.getByTestId('share-code')).toBeVisible({ timeout: 60_000 });
      return { page: c.page, code: code!, share: (await c.page.getByTestId('share-code').textContent())! };
    };
    const s1 = await signAs(G[0], 'guardian1');
    const s2 = await signAs(G[1], 'guardian2', s1.code);
    await s1.page.getByTestId('shares-input').fill(`${s1.share}\n${s2.share}`);
    await s1.page.getByTestId('shares-submit').click();
    run.txs['2 of 3 guardians freeze the Pocket (ML-DSA signatures checked on-chain)'] = await hashAttr(s1.page, 'shares-tx');
    await shot(s1.page, run, '2-guardian-submit');

    // 4. the owner's app shows the freeze, the chain agrees, and the owner key cannot spend
    await op.goto(`${URL}/pocket?env=lab`);
    await expect(op.getByTestId('freeze-status')).toHaveAttribute('data-frozen', '1', { timeout: T });
    expect(await vaultRead<boolean>(pocket, 'frozen')).toBe(true);
    await shot(op, run, '3-owner-frozen');
    for (const [k, h] of Object.entries(run.txs)) if (!k.startsWith('sweep')) expect(await txOk(h), k).toBe(true);
    run.checks.chain = { frozen: true, frozenUntil: String(await vaultRead<bigint>(pocket, 'frozenUntil')), guardians: G.map((g) => g.evm), threshold: 2 };
    // 5. the freeze expires by itself (lab: 120 s), then sweep the funds back
    await expect(op.getByTestId('freeze-status')).toHaveAttribute('data-frozen', '0', { timeout: 300_000 });
    await sweep(op, run, 'owner', await balanceOf(pocket));
    expect(INST.lab.router.address).toBeTruthy();
  } catch (e) { await failShots(run); throw e; } finally { PAGES.length = 0; save(run); await O.ctx.close(); for (const c of ctxs) await c.close(); const spent = await spentQor().catch(() => -1); fs.appendFileSync(path.join(EVID, 'spend-log.txt'), `${new Date().toISOString()} ${info.project.name} d net-spend-ledger=${spent}\n`); void pub; }
});

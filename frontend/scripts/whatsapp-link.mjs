// Creates ONE real, unclaimed Confirmed-mode link (0.3 QOR) through the deployed UI, for the manual WhatsApp test.
//   E2E_URL=https://pocketdrop-app.vercel.app node scripts/whatsapp-link.mjs
// Writes evidence/e2e-secrets-whatsapp.json (git-ignored: sender backup key + link). Testnet only; funded from the deployer under the 15 QOR cap.
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const URL = process.env.E2E_URL ?? 'https://pocketdrop-app.vercel.app';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const p = await ctx.newPage();
await p.goto(URL, { waitUntil: 'load' });
await p.getByTestId('create-sender').click();
const addr = (await p.getByTestId('sender-evm').textContent()).trim();
const fund = JSON.parse(execFileSync('node', ['scripts/fund.mjs', addr, '1.1', 'whatsapp test sender'], { encoding: 'utf8', cwd: root }).trim().split('\n').pop());
await p.getByTestId('activate-sender').waitFor({ timeout: 60_000 });
await p.getByTestId('activate-sender').click();
await p.getByTestId('sender-active').waitFor({ timeout: 180_000 });
await p.getByTestId('mode-Confirmed').click();
await p.getByTestId('amount').fill('0.3');
await p.getByTestId('create-link').click();
const el = p.getByTestId('claim-link');
await el.waitFor({ timeout: 120_000 });
const link = await el.getAttribute('data-url');
const wa = await p.getByTestId('whatsapp').getAttribute('href');
const createTx = await p.getByTestId('tx-create').getAttribute('data-hash');
const key = await p.evaluate(() => localStorage.getItem('pd.sender.v1'));
const id = /\/c\/(\d+)#/.exec(link)[1];
fs.writeFileSync(path.join(root, 'evidence', 'e2e-secrets-whatsapp.json'), JSON.stringify({ linkId: id, link, whatsappUrl: wa, sender: addr, senderBackupKey: key, fundTx: fund.hash, createTx }, null, 1));
await p.screenshot({ path: path.join(root, 'evidence', 'whatsapp-link-created.png'), fullPage: true });
await b.close();
console.log(JSON.stringify({ linkId: id, link, sender: addr, fundTx: fund.hash, createTx, totalSpentQor: fund.totalSpentQor }));

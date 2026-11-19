// Screenshots every route of the app (APP_URL) and, if DESIGN_HTML is set, the same views of the original design file,
// at 390x844 and 1440x900, into evidence/v2/screens/. Usage:
//   APP_URL=https://pocketdrop-app.vercel.app DESIGN_HTML=D:/path/design.html node scripts/visual-compare.mjs [chromium|webkit] [only-design|only-app]
import { chromium, webkit } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const APP = process.env.APP_URL ?? 'http://localhost:5199';
const DESIGN = process.env.DESIGN_HTML;
const engine = process.argv[2] === 'webkit' ? webkit : chromium;
const only = process.argv[3];
const OUT = path.resolve('evidence/v2/screens');
fs.mkdirSync(OUT, { recursive: true });
const SIZES = { m: { width: 390, height: 844 }, d: { width: 1440, height: 900 } };
const ROUTES = [['landing', '/'], ['dashboard', '/dashboard'], ['claim', '/claim'], ['lab', '/lab'], ['radar', '/radar'], ['judges', '/judges']];
const extra = process.env.EXTRA_ROUTES ? JSON.parse(process.env.EXTRA_ROUTES) : [];

async function sweep(page) {
  // scroll through so reveal-on-scroll animations play, then come back up
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < h; y += 500) { await page.evaluate((v) => window.scrollTo(0, v), y); await page.waitForTimeout(120); }
  await page.waitForTimeout(900);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
}

const browser = await engine.launch();
for (const [sk, vp] of Object.entries(SIZES)) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: sk === 'm' ? 2 : 1, isMobile: sk === 'm', hasTouch: sk === 'm' });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  if (only !== 'only-design') {
    for (const [name, route] of [...ROUTES, ...extra]) {
      await page.goto(APP + route, { waitUntil: 'networkidle' }).catch(() => undefined);
      await page.waitForTimeout(1500);
      await sweep(page);
      await page.screenshot({ path: path.join(OUT, `app-${name}-${sk}${engine === webkit ? '-webkit' : ''}.png`), fullPage: true });
    }
  }
  if (DESIGN && only !== 'only-app') {
    await page.goto(pathToFileURL(DESIGN).href, { waitUntil: 'load' });
    await page.waitForTimeout(2500);
    for (const [name] of ROUTES) {
      await page.evaluate((n) => { window.navigate(n); }, name);
      await page.waitForTimeout(1200);
      await sweep(page);
      await page.screenshot({ path: path.join(OUT, `design-${name}-${sk}${engine === webkit ? '-webkit' : ''}.png`), fullPage: true });
    }
  }
  if (errs.length) console.log(sk, 'page errors', errs.slice(0, 3));
  await ctx.close();
}
await browser.close();
console.log('screenshots in', OUT);

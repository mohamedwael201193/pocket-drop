// Screenshot every route at 390 and 1440. Usage: node scripts/shots.mjs <baseUrl> <outDir>
import { chromium } from '@playwright/test';
import fs from 'node:fs';
const [base = 'http://localhost:4173', out = 'evidence/v3'] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const routes = [['home', '/'], ['send', '/send'], ['send-inbox', '/send/inbox'], ['receive', '/receive'], ['pocket', '/pocket'], ['proof', '/proof'], ['lab', '/lab'], ['radar', '/radar'], ['judges', '/judges'], ['claim-bad-link', '/c/abc']];
const sizes = [['390', { width: 390, height: 844 }, true], ['1440', { width: 1440, height: 900 }, false]];
const b = await chromium.launch();
for (const [n, vp, mob] of sizes) {
  const c = await b.newContext({ viewport: vp, isMobile: mob, hasTouch: mob, deviceScaleFactor: mob ? 2 : 1 });
  const p = await c.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  for (const [name, path] of routes) {
    await p.goto(base + path, { waitUntil: 'networkidle' });
    await p.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 500) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 120)); } window.scrollTo(0, 0); });
    await p.waitForTimeout(900);
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    if (overflow) console.log('HORIZONTAL OVERFLOW', n, name);
    await p.addStyleTag({ content: '[data-testid=tabbar]{position:static !important}' }); await p.screenshot({ path: `${out}/${name}-${n}.png`, fullPage: true });
  }
  if (errs.length) console.log(n, 'pageerrors', errs);
  await c.close();
}
await b.close();

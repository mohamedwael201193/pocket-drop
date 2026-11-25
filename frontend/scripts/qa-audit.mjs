// Audit crawl: every route at 1280 and 390; console errors, failed requests, overflow, v4-only addresses, dead links, load time.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
const [base = 'https://pocketdrop-app.vercel.app', out = 'before'] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const routes = [['overview', '/'], ['about', '/about'], ['send', '/send'], ['send-inbox', '/send/inbox'], ['receive', '/receive'], ['pocket', '/pocket'], ['proof', '/proof'], ['lab', '/lab'], ['radar', '/radar'], ['judges', '/judges'], ['qday', '/qday'], ['check', '/check'], ['claim-bad', '/c/abc'], ['pool-bad', '/pool/zzz'], ['notfound', '/nope']];
const sizes = [['1280', { width: 1280, height: 800 }, false], ['390', { width: 390, height: 844 }, true]];
const b = await chromium.launch();
const report = [];
for (const [n, vp, mob] of sizes) {
  const c = await b.newContext({ viewport: vp, isMobile: mob, hasTouch: mob, deviceScaleFactor: mob ? 2 : 1 });
  for (const [name, path] of routes) {
    const p = await c.newPage();
    const errs = [], failed = [];
    p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
    p.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 200)); });
    p.on('requestfailed', (r) => failed.push(r.url().slice(0, 120) + ' ' + r.failure()?.errorText));
    p.on('response', (r) => { if (r.status() >= 400) failed.push(r.status() + ' ' + r.url().slice(0, 120)); });
    const t0 = Date.now();
    await p.goto(base + path, { waitUntil: 'domcontentloaded' });
    try { await p.waitForLoadState('networkidle', { timeout: 20000 }); } catch { /* polling pages never go idle */ }
    const ms = Date.now() - t0;
    await p.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 100)); } window.scrollTo(0, 0); });
    await p.waitForTimeout(1500);
    const info = await p.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      title: document.title,
      h1: [...document.querySelectorAll('h1')].map((h) => h.textContent.trim()).slice(0, 2),
      loading: [...document.querySelectorAll('[class*=animate-pulse]')].length,
      text: document.body.innerText,
      links: [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')),
      emptyBtns: [...document.querySelectorAll('button')].filter((x) => !x.innerText.trim() && !x.getAttribute('aria-label')).length,
      smallTap: [...document.querySelectorAll('a,button')].filter((x) => { const r = x.getBoundingClientRect(); return r.width > 0 && (r.height < 32) && x.offsetParent; }).length,
    }));
    const flags = [];
    for (const w of ['NaN', 'undefined', '[object Object]', 'Infinity', 'Error:', 'failed to fetch', 'Failed to fetch']) if (info.text.includes(w)) flags.push('text has ' + w);
    if (/b0d8fd23|bc13b9ee|aa981588|74b604e8/i.test(info.text)) flags.push('shows v4 address');
    if (/13b8e379|cd52c8d2|db67b988|87b0caf7/i.test(info.text)) flags.push('shows v5 address');
    if (/\bv4\b/.test(info.text)) flags.push('mentions v4');
    if (/\bv5\b/.test(info.text)) flags.push('mentions v5');
    fs.writeFileSync(`${out}/${name}-${n}.txt`, info.text);
    await p.addStyleTag({ content: '[data-testid=tabbar]{position:static !important}' }).catch(() => {});
    await p.screenshot({ path: `${out}/${name}-${n}.png`, fullPage: true });
    report.push({ size: n, route: path, ms, overflow: info.overflow, title: info.title, h1: info.h1, skeletonsLeft: info.loading, emptyBtns: info.emptyBtns, smallTap: info.smallTap, flags, errs: [...new Set(errs)].slice(0, 8), failed: [...new Set(failed)].slice(0, 8), internalLinks: [...new Set(info.links.filter((l) => l.startsWith('/')))] });
    await p.close();
  }
  await c.close();
}
await b.close();
fs.writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 1));
for (const r of report) console.log(r.size, r.route, r.ms + 'ms', r.overflow ? 'OVERFLOW' : '', 'skel=' + r.skeletonsLeft, 'smallTap=' + r.smallTap, r.flags.join('|'), r.errs.length ? 'ERRS ' + r.errs.join(' || ') : '', r.failed.length ? 'FAILED ' + r.failed.join(' || ') : '');

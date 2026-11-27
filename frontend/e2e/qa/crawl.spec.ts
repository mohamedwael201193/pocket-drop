// Static crawl of every route: console errors, network 4xx/5xx, overflow, axe, links, screenshots. Spends nothing.
//   E2E_URL=https://pocket-drop.vercel.app QA_AXE=/path/to/axe.min.js npx playwright test e2e/qa/crawl.spec.ts --project=chromium-390
// Results: one JSON per route and width in $QA_OUT (default test-results/qa/crawl), screenshots at 390 and 1440 in $QA_SHOTS.
// axe-core is not a dependency of the app: point QA_AXE at axe.min.js (npm i axe-core in any folder) or the axe field is skipped.
// With QA_AXE the crawl contexts bypass the strict CSP so axe can be injected (security.spec checks the CSP itself).
import { test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
const URL = process.env.E2E_URL || 'https://pocket-drop.vercel.app';
const SHOTS = process.env.QA_SHOTS || 'test-results/qa/shots';
const OUT = process.env.QA_OUT || 'test-results/qa/crawl';
fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(SHOTS, { recursive: true });
const AXE = process.env.QA_AXE && fs.existsSync(process.env.QA_AXE) ? fs.readFileSync(process.env.QA_AXE, 'utf8') : '';
const ROUTES: [string, string][] = [
  ['landing', '/'], ['overview', '/app'], ['about-redirect', '/about'], ['claim-alias', '/claim/p12'], ['send', '/send'], ['inbox', '/send/inbox'], ['receive', '/receive'],
  ['claim-v3-17', '/c/17'], ['claim-v4-p12-claimed', '/c/p12'], ['claim-v4-p12-badkey', '/c/p12#k=' + '00'.repeat(32)],
  ['claim-v4-missing', '/c/p99999#k=' + 'ab'.repeat(32)], ['claim-garbage', '/c/zzz'],
  ['pool-p5', '/pool/p5'], ['pool-missing', '/pool/p99999#k=' + 'ab'.repeat(32)],
  ['pocket', '/pocket'], ['pocket-lab', '/pocket?env=lab'], ['proof', '/proof'], ['testers', '/proof/testers'], ['lab', '/lab'], ['radar', '/radar'],
  ['stats-redirect', '/stats'], ['judges', '/judges'], ['qday', '/qday'], ['check', '/check'], ['dashboard-redirect', '/dashboard'], ['claim-redirect', '/claim'], ['unknown', '/nope-404'],
];
async function audit(page: Page, name: string, w: number, project: string) {
  const rec: Record<string, unknown> = { name, w, project };
  const cons: string[] = []; const net: string[] = []; const fail: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') cons.push(`${m.type()}: ${m.text().slice(0, 300)}`); });
  page.on('pageerror', (e) => cons.push(`pageerror: ${e.message.slice(0, 300)}`));
  page.on('response', (r) => { if (r.status() >= 400) net.push(`${r.status()} ${r.request().method()} ${r.url().slice(0, 200)}`); });
  page.on('requestfailed', (r) => fail.push(`${r.failure()?.errorText} ${r.url().slice(0, 200)}`));
  const r = ROUTES.find((x) => x[0] === name)!;
  const t0 = Date.now();
  await page.goto(URL + r[1], { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 25_000 }).catch(() => undefined);
  await page.waitForTimeout(2500);
  rec.loadMs = Date.now() - t0; rec.finalUrl = page.url().replace(URL, '');
  rec.overflow = await page.evaluate(() => {
    const W = document.documentElement.clientWidth; const out: string[] = [];
    document.querySelectorAll('body *').forEach((el) => { const b = el.getBoundingClientRect(); if (b.width > 0 && (b.right > W + 1) ) { const s = getComputedStyle(el); if (s.position !== 'fixed') out.push(`${el.tagName.toLowerCase()}.${(el.className?.toString() || '').slice(0, 60)} right=${Math.round(b.right)} text="${(el.textContent || '').trim().slice(0, 40)}"`); } });
    return { scrollW: document.documentElement.scrollWidth, clientW: W, items: out.slice(0, 15) };
  });
  rec.tinyText = await page.evaluate(() => { const out: string[] = []; document.querySelectorAll('body *').forEach((el) => { if (!el.childNodes.length || ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim())) return; const s = getComputedStyle(el); const fs = parseFloat(s.fontSize); const b = el.getBoundingClientRect(); if (fs < 12 && b.width > 0) out.push(`${fs}px "${el.textContent!.trim().slice(0, 50)}"`); }); return [...new Set(out)].slice(0, 40); });
  rec.links = await page.evaluate(() => [...document.querySelectorAll('a[href]')].map((a) => (a as HTMLAnchorElement).href));
  rec.buttons = await page.evaluate(() => [...document.querySelectorAll('button')].map((b) => `${(b.textContent || b.getAttribute('aria-label') || '').trim().slice(0, 50)}${(b as HTMLButtonElement).disabled ? ' [disabled]' : ''}${b.getAttribute('data-testid') ? ' #' + b.getAttribute('data-testid') : ''}`));
  rec.inputs = await page.evaluate(() => [...document.querySelectorAll('input,select,textarea')].map((i) => { const id = i.id; const lab = id ? document.querySelector(`label[for="${id}"]`) : i.closest('label'); return `${i.tagName.toLowerCase()} ${i.getAttribute('data-testid') || ''} label=${lab ? 'yes' : (i.getAttribute('aria-label') ? 'aria' : 'NO')} ph="${i.getAttribute('placeholder') || ''}"`; }));
  if (AXE) await page.addScriptTag({ content: AXE });
  rec.axe = !AXE ? 'skipped (set QA_AXE)' : await page.evaluate(async () => { const r = await (window as unknown as { axe: { run: (o: unknown) => Promise<{ violations: { id: string; impact: string; nodes: { target: string[]; failureSummary: string }[] }[] }> } }).axe.run({ resultTypes: ['violations'] }); return r.violations.map((v) => ({ id: v.id, impact: v.impact, n: v.nodes.length, ex: v.nodes.slice(0, 4).map((n) => `${n.target.join(' ')} :: ${(n.failureSummary || '').replace(/\s+/g, ' ').slice(0, 160)}`) })); });
  rec.text = (await page.evaluate(() => document.body.innerText)).slice(0, 6000);
  rec.console = cons; rec.net = net; rec.failed = fail;
  if (w === 390 || w === 1440) await page.screenshot({ path: path.join(SHOTS, `${project.split('-')[0]}-${w}-${name}.png`), fullPage: true });
  fs.writeFileSync(path.join(OUT, `${project.split('-')[0]}-${w}-${name}.json`), JSON.stringify(rec, null, 1));
}
test('crawl', async ({ browser, browserName }, info) => {
  const mobile = info.project.name.endsWith('390');
  const widths = browserName === 'chromium' ? (mobile ? [360, 390] : [768, 1440]) : (mobile ? [390] : [1440]);
  for (const w of widths) for (const [name] of ROUTES) {
    const ctx = await browser.newContext({ bypassCSP: !!AXE, viewport: { width: w, height: w < 800 ? 844 : 900 }, isMobile: w < 800 && browserName === 'chromium', hasTouch: w < 800, deviceScaleFactor: w < 800 ? 2 : 1 });
    const page = await ctx.newPage();
    try { await audit(page, name, w, info.project.name); } catch (e) { fs.writeFileSync(path.join(OUT, `${info.project.name.split('-')[0]}-${w}-${name}.err`), String(e)); }
    await ctx.close();
  }
});

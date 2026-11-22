// Gaps closed on 22 Nov 2026 (RESCORE items 2-6): v3 hybrid claims in /api/stats, current API names on the landing cards,
// and the smaller UX items. Runs against the deployed app and API.
import { test, expect } from './fixtures';
const BASE = process.env.E2E_URL || 'https://pocketdrop-app.vercel.app';
const API = process.env.E2E_API || 'https://pocketdrop-api.vercel.app';

test('/api/stats counts v3 link #29, which was bound and claimed through hybrid relays', async ({ request }) => {
  const r = await request.get(`${API}/api/stats`, { timeout: 90_000 });
  expect(r.ok()).toBeTruthy();
  const s = await r.json();
  const rows = s.v3.recent as { kind: string; linkId: string; txHash: string; lane?: string }[];
  expect(rows).toContainEqual(expect.objectContaining({ kind: 'claimed', linkId: '29', txHash: 'CAFECB9ABD82E5715DAE1EB721D8332E10631370F62A15F26384825EAB98F71C', lane: 'hybrid' }));
  expect(s.v3.hybridRelayEvents).toBeGreaterThanOrEqual(2);
});

test('the landing technical cards name the current API and contract calls', async ({ page }) => {
  await page.goto(BASE);
  const deck = page.getByTestId('stacked-deck');
  await deck.scrollIntoViewIfNeeded();
  const seen: string[] = [];
  for (let i = 0; i < 3; i++) {
    seen.push((await page.getByTestId('stack-desc').innerText()).trim());
    await deck.click();
  }
  const all = seen.join(' | ');
  expect(all).toContain('POST /api/route');
  expect(all).toContain('PocketDrop.confirmRecipient');
  expect(all).toContain('PocketDrop.claim');
  expect(all).not.toContain('/api/bind');
  expect(all).not.toContain('PoP Account');
});

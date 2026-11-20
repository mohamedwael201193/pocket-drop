// Playwright test with optional access to a protected Vercel preview: when E2E_PREVIEW_TOKEN is set (a short-lived
// Vercel OIDC token from `vercel env run`), requests to the E2E_URL origin only carry the trusted-source header.
// Cross-origin requests (API, RPC) are untouched, so CORS behaves exactly as in production.
import { test as base, expect } from '@playwright/test';

const TOKEN = process.env.E2E_PREVIEW_TOKEN;
const ORIGIN = process.env.E2E_URL ? new URL(process.env.E2E_URL).origin : null;
export const previewHeaders: Record<string, string> = TOKEN ? { 'x-vercel-trusted-oidc-idp-token': TOKEN } : {};

export const test = base.extend({
  context: async ({ context }, use) => {
    if (TOKEN && ORIGIN) await context.route(`${ORIGIN}/**`, (r) => r.continue({ headers: { ...r.request().headers(), ...previewHeaders } }));
    await use(context); // eslint-disable-line react-hooks/rules-of-hooks -- Playwright fixture callback, not a React hook
  },
});
export { expect };

import type { ServerResponse } from 'node:http';
import { CORS, clientIp, send, type Req } from '../src/http.js';
import { getConfig } from '../src/config.js';
import { getLimiter } from '../src/ratelimit.js';
import { makePublicClient } from '../src/relayer.js';
import { handleSponsor, handleSponsorStatus, sponsorRules, type SponsorDeps } from '../src/sponsor.js';
import { createSponsorChain } from '../src/sponsorChain.js';

let deps: SponsorDeps | null = null;
function build(): SponsorDeps {
  if (deps) return deps;
  const cfg = getConfig();
  const rules = sponsorRules();
  deps = { rules, limiter: getLimiter(), chain: createSponsorChain(cfg, makePublicClient(cfg), rules) };
  return deps;
}

/** GET: sponsor status. POST: sponsor a brand-new key account (see src/sponsor.ts for the rules). */
export default async function handler(req: Req, res: ServerResponse) {
  if (req.method === 'OPTIONS') { res.statusCode = 204; for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v); res.end(); return; }
  if (req.method === 'GET') { send(res, await handleSponsorStatus(build())); return; }
  if (req.method === 'POST') { send(res, await handleSponsor(req.body, clientIp(req), build())); return; }
  send(res, { status: 405, body: { ok: false, error: { name: 'MethodNotAllowed', message: 'Use GET or POST.' } }, headers: { allow: 'GET, POST' } });
}

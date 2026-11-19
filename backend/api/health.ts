import type { ServerResponse } from 'node:http';
import { buildDeps, gate, send, type Req } from '../src/http.js';
import { getHealth } from '../src/health.js';

export default async function handler(req: Req, res: ServerResponse) {
  if (gate(req, res, 'GET')) return;
  const d = buildDeps();
  const h = await getHealth(d.cfg, d.pub as any);
  send(res, { status: h.ok ? 200 : 503, body: h as Record<string, unknown> });
}

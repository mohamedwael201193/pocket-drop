import type { ServerResponse } from 'node:http';
import { buildRouteDeps, clientIp, gate, send, type Req } from '../src/http.js';
import { handleRoute } from '../src/route.js';

export default async function handler(req: Req, res: ServerResponse) {
  if (gate(req, res, 'POST')) return;
  send(res, await handleRoute(req.body, clientIp(req), buildRouteDeps()));
}

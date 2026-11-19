import type { ServerResponse } from 'node:http';
import { buildDeps, clientIp, gate, send, type Req } from '../src/http.js';
import { handleBind } from '../src/handlers.js';

export default async function handler(req: Req, res: ServerResponse) {
  if (gate(req, res, 'POST')) return;
  send(res, await handleBind(req.body, clientIp(req), buildDeps()));
}

import type { ServerResponse } from 'node:http';
import { buildDeps, clientIp, gate, send, type Req } from '../../src/http.js';
import { handleLink } from '../../src/handlers.js';

export default async function handler(req: Req, res: ServerResponse) {
  if (gate(req, res, 'GET')) return;
  const id = req.query?.id;
  send(res, await handleLink(Array.isArray(id) ? id[0] : id, clientIp(req), buildDeps()));
}

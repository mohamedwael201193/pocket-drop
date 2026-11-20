// Key-less CORS pass-through for the two QoreChain testnet hosts that send no CORS headers.
// Only allowlisted hosts, JSON-RPC methods and REST path prefixes are forwarded. No credentials are ever attached.
export const PROXY_HOSTS = { rpc: 'https://rpc-testnet.qore.host', rest: 'https://api-testnet.qore.host', evm: 'https://evm-testnet.qore.host' } as const;

/** Read-only Ethereum JSON-RPC methods accepted on /rpc and /evm (never a send or a signing method). */
export const EVM_READ_METHODS = new Set([
  'eth_chainId', 'net_version', 'eth_blockNumber', 'eth_gasPrice', 'eth_getBalance', 'eth_getCode', 'eth_call', 'eth_estimateGas',
  'eth_getLogs', 'eth_getTransactionByHash', 'eth_getTransactionReceipt', 'eth_getBlockByNumber', 'eth_getBlockByHash',
  'eth_getTransactionCount', 'eth_getStorageAt',
]);

export const RPC_METHODS = new Set([
  'status', 'abci_info', 'abci_query', 'broadcast_tx_sync', 'broadcast_tx_async', 'tx', 'tx_search', 'block', 'health',
]);

export const REST_PREFIXES = [
  '/cosmos/auth/v1beta1/accounts/',
  '/cosmos/bank/v1beta1/balances/',
  '/cosmos/tx/v1beta1/txs/',
  '/cosmos/upgrade/v1beta1/applied_plan/',
  '/cosmos/base/tendermint/v1beta1/',
  '/qorechain/pqc/v1/',
];

export const MAX_BODY_BYTES = 256 * 1024;
export const MAX_BATCH = 10;

export interface ProxyRequest { method: string; target: string | null; path: string | null; query: string; body: unknown }
export interface ProxyResult { status: number; contentType: string; body: string }

export function checkRpcBody(body: unknown): { ok: true; payload: unknown; evm?: boolean } | { ok: false; status: number; message: string } {
  let b = body;
  if (typeof b === 'string') {
    if (b.length > MAX_BODY_BYTES) return { ok: false, status: 413, message: 'body too large' };
    try { b = JSON.parse(b); } catch { return { ok: false, status: 400, message: 'invalid JSON' }; }
  }
  const calls = Array.isArray(b) ? b : [b];
  if (calls.length === 0 || calls.length > MAX_BATCH) return { ok: false, status: 400, message: `batch must contain 1..${MAX_BATCH} calls` };
  let evm = 0;
  for (const c of calls) {
    const m = c && typeof c === 'object' ? (c as { method?: unknown }).method : undefined;
    if (typeof m !== 'string' || !(RPC_METHODS.has(m) || EVM_READ_METHODS.has(m))) return { ok: false, status: 403, message: `rpc method not allowed: ${String(m)}` };
    if (EVM_READ_METHODS.has(m)) evm++;
  }
  if (evm !== 0 && evm !== calls.length) return { ok: false, status: 400, message: 'do not mix eth_* and CometBFT methods in one batch' };
  return { ok: true, payload: b, evm: evm > 0 };
}

export function checkRestPath(raw: string | null): { ok: true; path: string } | { ok: false; status: number; message: string } {
  const p = '/' + (raw ?? '').replace(/^\/+/, '');
  let decoded = p;
  try { decoded = decodeURIComponent(p); } catch { return { ok: false, status: 400, message: 'bad path encoding' }; }
  if (p.includes('..') || decoded.includes('..') || p.includes('\\') || p.includes('//') || /[?#]/.test(decoded)) {
    return { ok: false, status: 403, message: `rest path not allowed: ${p}` };
  }
  if (!REST_PREFIXES.some((x) => p.startsWith(x))) return { ok: false, status: 403, message: `rest path not allowed: ${p}` };
  return { ok: true, path: p };
}

export async function proxyRequest(req: ProxyRequest, fetchImpl: typeof fetch = fetch): Promise<ProxyResult> {
  const text = (status: number, body: string): ProxyResult => ({ status, contentType: 'text/plain', body });
  const t = req.target;
  if (t !== 'rpc' && t !== 'rest') return text(404, 'unknown target');
  const host = PROXY_HOSTS[t];
  try {
    if (t === 'rpc') {
      if (req.method !== 'POST') return text(405, 'POST only');
      const chk = checkRpcBody(req.body);
      if (!chk.ok) return text(chk.status, chk.message);
      const r = await fetchImpl((chk.evm ? PROXY_HOSTS.evm : host) + '/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(chk.payload) });
      return { status: r.status, contentType: r.headers.get('content-type') || 'application/json', body: await r.text() };
    }
    if (req.method !== 'GET') return text(405, 'GET only');
    const chk = checkRestPath(req.path);
    if (!chk.ok) return text(chk.status, chk.message);
    const r = await fetchImpl(host + chk.path + (req.query ? '?' + req.query : ''));
    return { status: r.status, contentType: r.headers.get('content-type') || 'application/json', body: await r.text() };
  } catch (e) {
    return text(502, 'proxy error: ' + (e instanceof Error ? e.message : String(e)));
  }
}

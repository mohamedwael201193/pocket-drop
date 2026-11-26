// Local operator script (testnet). Opens/renews the relayer EVM authorisation window, scoped to an explicit target
// list (v4: [PocketRouter prod, PocketRouter lab, PocketDrop v3]) with a value cap. Needs the relayer ML-DSA key from .secrets/ (hybrid-signed MsgOpenEVMWindow); that key never
// stays out of the logs. Since 22 Nov 2026 the API also holds it (hybrid relays) and this script is the manual fallback.
//
// Usage: node scripts/renew-window.mjs [--blocks 17280] [--txs 500] [--tx-gas 1000000] [--wait-minutes 0] [--if-below 8000]
//   --if-below N  only renew when the window is not live or has fewer than N blocks left (used by the scheduled workflow).
//   Key sources: .secrets/pocketdrop-relayer.json, or env RELAYER_SECP_KEY + RELAYER_PQC_SEED (CI secrets).
//   Targets: --targets a,b,c  or env WINDOW_TARGETS (comma list). Without either, the v5.1, v5 and v4 routers and the v3 PocketDrop are
//   read from contracts-v4/deployments/diana.json and contracts/deployments/diana.json.
//   maxValue is the window's own fee/value budget (evmWindowCost per tx * txs, plus headroom). The relayer sends
//   value 0 to PocketDrop, so this cap is mostly gas accounting; it also bounds what a stolen relayer key could move.
import { openEvmWindowMsg } from '@qorechain/sdk';
import { evmWindowCost } from '@qorechain/evm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, http, defineChain, getAddress } from 'viem';
import { EXPL, REST, net, loadRelayer, contractAddress, cosmosTx, bankUqor } from './common.mjs';

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const blocks = Number(arg('blocks', 17280)), maxTxs = Number(arg('txs', 500)), txGas = BigInt(arg('tx-gas', 1_000_000));
const waitMin = Number(arg('wait-minutes', 0));

function targetsFromFiles() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const out = [];
  const v4 = path.join(here, '..', '..', 'contracts-v4', 'deployments', 'diana.json');
  if (fs.existsSync(v4)) {
    const d = JSON.parse(fs.readFileSync(v4, 'utf8'));
    for (const g of ['v5_1', 'v5', 'v4']) for (const k of ['prod', 'lab']) if (d[g]?.[k]?.router?.address) out.push(d[g][k].router.address);
  }
  const v3p = path.join(here, '..', '..', 'contracts', 'deployments', 'diana.json');
  const v3 = process.env.POCKETDROP_ADDRESS ?? (fs.existsSync(v3p) ? JSON.parse(fs.readFileSync(v3p, 'utf8')).contracts?.main?.address : null) ?? contractAddress();
  if (v3) out.push(v3);
  return out;
}
const rawTargets = arg('targets', process.env.WINDOW_TARGETS ?? '');
const targets = [...new Set((rawTargets ? rawTargets.split(',').map((x) => x.trim()).filter(Boolean) : targetsFromFiles()).map((a) => getAddress(a)))];
if (targets.length === 0) { console.error('no window targets: set --targets, WINDOW_TARGETS or deploy first'); process.exit(2); }

const relayer = await loadRelayer();
const ifBelow = arg('if-below', null);
if (ifBelow !== null) {
  const cur = await (await fetch(`${REST}/qorechain/pqc/v1/evm_window/${relayer.cosmos}`)).json();
  const left = Number(cur.remaining_blocks ?? 0), txsLeft = Number(cur.remaining_txs ?? 0);
  console.log('current window', JSON.stringify({ live: !!cur.live, remaining_blocks: left, remaining_txs: txsLeft }));
  const have = new Set((cur.allowed_targets ?? []).map((a) => String(a).toLowerCase()));
  const sameTargets = targets.length === have.size && targets.every((a) => have.has(a.toLowerCase()));
  if (cur.live && sameTargets && left >= Number(ifBelow) && txsLeft >= 50) { console.log('window healthy, no renewal needed'); process.exit(0); }
  if (cur.live && !sameTargets) console.log('target list differs from the desired one');
  console.log('renewing');
}
const chain = defineChain({ id: 9800, name: 'diana', nativeCurrency: { name: 'QOR', symbol: 'QOR', decimals: 18 }, rpcUrls: { default: { http: [net.endpoints.evmRpc] } } });
const pub = createPublicClient({ chain, transport: http() });
const gp = ((await pub.getGasPrice()) * 13n) / 10n;
const perTx = evmWindowCost({ gas: txGas, maxFeePerGas: gp });
const maxValue = perTx * BigInt(maxTxs) + 1_500_000n;

console.log('relayer', relayer.evm, relayer.cosmos, 'balance uqor', String(await bankUqor(relayer.cosmos)));
console.log('window: targets', targets.join(','), 'blocks', blocks, 'maxTxs', maxTxs, 'maxValue', String(maxValue));
const r = await cosmosTx(relayer, 'hybrid', [openEvmWindowMsg({ sender: relayer.cosmos, blocks, maxTxs, maxValue, allowedTargets: targets })]);
console.log('OPEN-WINDOW tx', r.transactionHash, EXPL + r.transactionHash, 'code', r.code);
const w = await (await fetch(`${REST}/qorechain/pqc/v1/evm_window/${relayer.cosmos}`)).json();
console.log('window status', JSON.stringify({ live: w.live, remaining_blocks: w.remaining_blocks, remaining_txs: w.remaining_txs, remaining_value: w.remaining_value, allowed_targets: w.allowed_targets }));

if (r.code !== 0 || !w.live) { console.error('renewal failed: window not live'); process.exit(1); }

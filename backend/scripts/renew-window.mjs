// Local operator script (testnet). Opens/renews the relayer EVM authorisation window, scoped to [PocketDrop]
// with a value cap. Needs the relayer ML-DSA key from .secrets/ (hybrid-signed MsgOpenEVMWindow); that key never
// leaves this machine and is never given to the serverless function.
//
// Usage: node scripts/renew-window.mjs [--blocks 17280] [--txs 500] [--tx-gas 1000000] [--wait-minutes 0] [--if-below 8000]
//   --if-below N  only renew when the window is not live or has fewer than N blocks left (used by the scheduled workflow).
//   Key sources: .secrets/pocketdrop-relayer.json, or env RELAYER_SECP_KEY + RELAYER_PQC_SEED (CI secrets).
//   POCKETDROP_ADDRESS env or contracts/deployments/diana.json supplies the contract address.
//   maxValue is the window's own fee/value budget (evmWindowCost per tx * txs, plus headroom). The relayer sends
//   value 0 to PocketDrop, so this cap is mostly gas accounting; it also bounds what a stolen relayer key could move.
import { openEvmWindowMsg } from '@qorechain/sdk';
import { evmWindowCost } from '@qorechain/evm';
import { createPublicClient, http, defineChain, getAddress } from 'viem';
import { EXPL, REST, net, loadRelayer, contractAddress, cosmosTx, bankUqor } from './common.mjs';

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const blocks = Number(arg('blocks', 17280)), maxTxs = Number(arg('txs', 500)), txGas = BigInt(arg('tx-gas', 1_000_000));
const waitMin = Number(arg('wait-minutes', 0));

let addr = contractAddress();
const deadline = Date.now() + waitMin * 60_000;
while (!addr && Date.now() < deadline) { await new Promise((r) => setTimeout(r, 15_000)); addr = contractAddress(); }
if (!addr) { console.error('PocketDrop address unknown: set POCKETDROP_ADDRESS or wait for contracts/deployments/diana.json'); process.exit(2); }
addr = getAddress(addr);

const relayer = await loadRelayer();
const ifBelow = arg('if-below', null);
if (ifBelow !== null) {
  const cur = await (await fetch(`${REST}/qorechain/pqc/v1/evm_window/${relayer.cosmos}`)).json();
  const left = Number(cur.remaining_blocks ?? 0), txsLeft = Number(cur.remaining_txs ?? 0);
  console.log('current window', JSON.stringify({ live: !!cur.live, remaining_blocks: left, remaining_txs: txsLeft }));
  if (cur.live && left >= Number(ifBelow) && txsLeft >= 50) { console.log('window healthy, no renewal needed'); process.exit(0); }
  console.log('renewing');
}
const chain = defineChain({ id: 9800, name: 'diana', nativeCurrency: { name: 'QOR', symbol: 'QOR', decimals: 18 }, rpcUrls: { default: { http: [net.endpoints.evmRpc] } } });
const pub = createPublicClient({ chain, transport: http() });
const gp = ((await pub.getGasPrice()) * 13n) / 10n;
const perTx = evmWindowCost({ gas: txGas, maxFeePerGas: gp });
const maxValue = perTx * BigInt(maxTxs) + 1_500_000n;

console.log('relayer', relayer.evm, relayer.cosmos, 'balance uqor', String(await bankUqor(relayer.cosmos)));
console.log('window: target', addr, 'blocks', blocks, 'maxTxs', maxTxs, 'maxValue', String(maxValue));
const r = await cosmosTx(relayer, 'hybrid', [openEvmWindowMsg({ sender: relayer.cosmos, blocks, maxTxs, maxValue, allowedTargets: [addr] })]);
console.log('OPEN-WINDOW tx', r.transactionHash, EXPL + r.transactionHash, 'code', r.code);
const w = await (await fetch(`${REST}/qorechain/pqc/v1/evm_window/${relayer.cosmos}`)).json();
console.log('window status', JSON.stringify({ live: w.live, remaining_blocks: w.remaining_blocks, remaining_txs: w.remaining_txs, remaining_value: w.remaining_value, allowed_targets: w.allowed_targets }));

if (r.code !== 0 || !w.live) { console.error('renewal failed: window not live'); process.exit(1); }

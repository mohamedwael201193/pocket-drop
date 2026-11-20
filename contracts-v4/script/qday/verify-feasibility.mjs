// Re-check every hash recorded in docs/qday/feasibility-results.json against Diana (read-only; plain Node 20, no npm install).
// Re-check every recorded hash: EVM via eth_getTransactionReceipt on evm-testnet.qore.host, Cosmos via CometBFT /tx.
import fs from 'node:fs';
const net = { endpoints: { rpc: process.env.COMET_RPC ?? 'https://rpc-testnet.qore.host' } };
const R = JSON.parse(fs.readFileSync(new URL('../../../docs/qday/feasibility-results.json', import.meta.url), 'utf8'));
const out = [];
for (const r of R) {
  if (!r.hash) continue;
  if (r.hash.startsWith('0x')) {
    const j = await (await fetch('https://evm-testnet.qore.host', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getTransactionReceipt', params: [r.hash] }) })).json();
    const st = j.result ? (j.result.status === '0x1' ? 'success' : 'reverted') : 'NOT FOUND';
    out.push({ step: r.step, lane: 'evm', hash: r.hash, recorded: r.status, receipt: st, block: j.result ? parseInt(j.result.blockNumber, 16) : null, from: j.result?.from, to: j.result?.to, gasUsed: j.result ? parseInt(j.result.gasUsed, 16) : null, ok: st === r.status });
  } else {
    const j = await (await fetch(`${net.endpoints.rpc}/tx?hash=0x${r.hash}`)).json();
    const found = !!j.result; const code = found ? j.result.tx_result.code : null;
    out.push({ step: r.step, lane: 'cosmos', hash: r.hash, recordedCode: r.code, onChain: found ? `included code ${code} height ${j.result.height}` : 'not included (rejected in CheckTx, no fee charged)', ok: r.included ? (found && code === r.code) : !found });
  }
}

for (const o of out) console.log(o.ok ? 'OK ' : 'BAD', o.lane, o.hash.slice(0, 14), o.receipt ?? o.onChain, '|', o.step.slice(0, 60));
console.log('total', out.length, 'bad', out.filter((o) => !o.ok).length);

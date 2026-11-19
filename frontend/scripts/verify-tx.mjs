// node scripts/verify-tx.mjs [evidence-dir]
// Verifies EVERY tx hash recorded in evidence/e2e-*.json:
//   0x-prefixed (EVM)   -> eth_getTransactionReceipt
//   bare 64-hex (Cosmos) -> CometBFT RPC `tx` query
// Writes evidence/tx-verification.json and exits non-zero if any hash is missing or failed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, http } from 'viem';
import { getNetwork } from '@qorechain/sdk';

const net = getNetwork('testnet');
const dir = path.resolve(process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'evidence'));
const pub = createPublicClient({ transport: http(net.endpoints.evmRpc) });
const files = fs.readdirSync(dir).filter((f) => /^e2e-.*\.json$/.test(f));
const out = [];
let bad = 0;
for (const f of files) {
  const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  for (const [label, hash] of Object.entries(j.txs ?? {})) {
    if (!hash) continue;
    let r;
    try {
      if (hash.startsWith('0x')) {
        const rc = await pub.getTransactionReceipt({ hash });
        r = { lane: 'evm', ok: rc.status === 'success', status: rc.status, block: rc.blockNumber.toString(), gasUsed: rc.gasUsed.toString() };
      } else {
        const res = await fetch(`${net.endpoints.rpc}/tx?hash=0x${hash.toLowerCase()}`).then((x) => x.json());
        const t = res.result;
        r = { lane: 'cosmos', ok: !!t && Number(t.tx_result.code) === 0, status: t ? `code ${t.tx_result.code}` : 'not found', block: t?.height, gasUsed: t?.tx_result.gas_used };
      }
    } catch (e) { r = { ok: false, status: 'error: ' + String(e.message).split('\n')[0] }; }
    if (!r.ok) bad++;
    out.push({ file: f, label, hash, ...r });
    console.log(r.ok ? 'OK ' : 'BAD', f, label, hash.slice(0, 14) + '...', r.status);
  }
}
fs.writeFileSync(path.join(dir, 'tx-verification.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), total: out.length, failed: bad, results: out }, null, 1));
console.log(`verified ${out.length} tx hashes, ${bad} failed`);
process.exit(bad ? 1 : 0);

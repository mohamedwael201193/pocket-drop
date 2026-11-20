// Snapshot the mined Q-Day attack attempts (try-it, team bot, anyone else) from the live /api/qday log into
// deployments/qday-attempts.json, so frontend/scripts/reverify.mjs can re-check them from a clone. Merges, never drops rows.
//   node script/qday/export-attempts.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const C4 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const API = process.env.PD_API_URL ?? 'https://pocketdrop-api.vercel.app';
const f = path.join(C4, 'deployments', 'qday-attempts.json');
const prev = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : { attempts: [] };
const q = await (await fetch(`${API}/api/qday`)).json();
const rows = [...(q.log?.onChain?.rows ?? []), ...(q.log?.teamBot?.rows ?? [])].filter((r) => r.source !== 'team-setup');
const byTx = new Map(prev.attempts.map((a) => [a.tx.toLowerCase(), a]));
for (const r of rows) byTx.set(r.tx.toLowerCase(), { tx: r.tx, height: r.height, from: r.from, bait: r.bait, call: r.call, source: r.source, failed: r.failed, explorer: r.explorer });
const attempts = [...byTx.values()].sort((a, b) => a.height - b.height);
const out = {
  note: 'Mined Q-Day attack attempts against the five bait Pockets (Diana testnet). source try-it = a visitor pressed "Put it on chain" (relayed by us, simulated first, only reverting calls are mined); team-bot = our hourly GitHub Actions attacker (marker QDAYBOT1); anything else = someone outside. Every row must be a reverted tx: reverify.mjs checks the receipts.',
  api: `${API}/api/qday`,
  updatedAt: new Date().toISOString(),
  attempts,
};
fs.writeFileSync(f, JSON.stringify(out, null, 1) + '\n');
console.log(`${attempts.length} attempts (${attempts.filter((a) => !a.failed).length} not failed) -> deployments/qday-attempts.json`);

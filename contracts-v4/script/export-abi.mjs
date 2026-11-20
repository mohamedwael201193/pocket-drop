// Copies the ABIs the Node scripts read out of Foundry's out/ into abi/ (committed), so the
// drill attack script runs on a fresh clone with only Node 20 and `npm ci`: no Foundry needed.
//   node script/export-abi.mjs           write abi/*.json from out/ (after `forge build`)
//   node script/export-abi.mjs --check   fail if abi/ differs from out/ (CI runs this)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const C4 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CONTRACTS = ['PocketVault', 'PocketFactory', 'PocketDrop', 'PocketRouter', 'DropPool'];
const check = process.argv.includes('--check');
let bad = 0;
for (const n of CONTRACTS) {
  const abi = JSON.parse(fs.readFileSync(path.join(C4, 'out', `${n}.sol`, `${n}.json`), 'utf8')).abi;
  const body = JSON.stringify({ contract: n, source: `src/${n}.sol`, abi }, null, 1) + '\n';
  const f = path.join(C4, 'abi', `${n}.json`);
  if (check) {
    const same = fs.existsSync(f) && fs.readFileSync(f, 'utf8') === body;
    console.log(`${same ? 'ok  ' : 'DIFF'} abi/${n}.json`);
    if (!same) bad++;
  } else { fs.writeFileSync(f, body); console.log(`wrote abi/${n}.json (${abi.length} entries)`); }
}
if (bad) { console.error(`${bad} ABI file(s) out of date: run forge build && node script/export-abi.mjs`); process.exit(1); }

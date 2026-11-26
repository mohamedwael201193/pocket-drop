// Builds the flattened v5.2 source for QCAI (docs/audit/stage5/PocketDrop-v5.2-flattened.sol): the file is compiled on its
// own with the repo's exact settings and each contract's runtime bytecode is compared with the Foundry artifact. Once
// v5.2 is recorded under `v5_2` in deployments/diana.json, the code at those addresses is compared too (immutables
// masked); before that the on-chain step is skipped and says so.
//   node script/flatten-v52.mjs           write the file, then verify
//   node script/flatten-v52.mjs --check   verify only (fails if the file differs from src/ or the bytecode differs)
// Needs Foundry (forge) on PATH. Read-only on chain.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createPublicClient, http } from 'viem';

const C4 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(C4, '..', 'docs', 'audit', 'stage5', 'PocketDrop-v5.2-flattened.sol');
const ORDER = ['src/interfaces/IPocket.sol', 'src/PqcLib.sol', 'src/Payout.sol', 'src/PqGuard.sol', 'src/PocketVault.sol', 'src/PocketFactory.sol', 'src/PocketRouter.sol', 'src/PocketDrop.sol', 'src/DropPool.sol'];
const CONTRACTS = { PocketVault: 'vaultImpl', PocketFactory: 'factory', PocketRouter: 'router', PocketDrop: 'drop', DropPool: 'pool' };

function build() {
  let s = '// SPDX-License-Identifier: MIT\npragma solidity ^0.8.24;\n';
  for (const f of ORDER) {
    const body = fs.readFileSync(path.join(C4, f), 'utf8').replace(/\r\n/g, '\n').split('\n')
      .filter((l) => !/^\/\/ SPDX-License-Identifier:/.test(l) && !/^pragma solidity/.test(l) && !/^import /.test(l)).join('\n')
      .replace(/^\n+/, '').replace(/\n+$/, '');
    s += `\n// ===== ${f} =====\n${body}\n`;
  }
  return s;
}

const want = build();
if (!process.argv.includes('--check')) { fs.mkdirSync(path.dirname(OUT), { recursive: true }); fs.writeFileSync(OUT, want); }
const have = fs.readFileSync(OUT, 'utf8');
let bad = 0;
const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) bad++; };
ok(have === want, 'file equals the concatenation of src/ (no edits by hand)');

// compile the flattened file alone, same settings as foundry.toml
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'flat52-'));
fs.mkdirSync(path.join(tmp, 'src'));
fs.copyFileSync(OUT, path.join(tmp, 'src', 'Flat.sol'));
fs.writeFileSync(path.join(tmp, 'foundry.toml'), '[profile.default]\nsrc = "src"\nout = "out"\nsolc = "0.8.28"\nevm_version = "cancun"\noptimizer = true\noptimizer_runs = 200\nbytecode_hash = "none"\ncbor_metadata = false\n');
execFileSync('forge', ['build', '--root', tmp], { stdio: ['ignore', 'ignore', 'inherit'] });
ok(true, 'flattened file compiles alone (solc 0.8.28, cancun, optimizer 200, no metadata)');

const dep = JSON.parse(fs.readFileSync(path.join(C4, 'deployments', 'diana.json'), 'utf8')).v5_2;
const pub = createPublicClient({ transport: http('https://evm-testnet.qore.host') });
const masked = (hex, refs) => { const b = Buffer.from(hex.replace(/^0x/, ''), 'hex'); for (const rs of Object.values(refs ?? {})) for (const r of rs) b.fill(0, r.start, r.start + r.length); return b; };
for (const [name, key] of Object.entries(CONTRACTS)) {
  const flat = JSON.parse(fs.readFileSync(path.join(tmp, 'out', 'Flat.sol', `${name}.json`), 'utf8'));
  const repo = JSON.parse(fs.readFileSync(path.join(C4, 'out', `${name}.sol`, `${name}.json`), 'utf8'));
  const refs = flat.deployedBytecode.immutableReferences;
  ok(flat.deployedBytecode.object === repo.deployedBytecode.object, `${name}: flattened runtime bytecode == repo build`);
  if (!dep) { console.log(`skip ${name}: v5.2 not deployed yet (no v5_2 in deployments/diana.json)`); continue; }
  for (const inst of ['prod', 'lab']) {
    const onchain = await pub.getCode({ address: dep[inst][key].address });
    ok(masked(onchain, refs).equals(masked(flat.deployedBytecode.object, refs)), `${name} ${inst} ${dep[inst][key].address}: on-chain runtime == flattened build (immutables masked)`);
  }
}
const sha = crypto.createHash('sha256').update(fs.readFileSync(OUT)).digest('hex');
const lines = have.split('\n').length - (have.endsWith('\n') ? 1 : 0);
console.log(JSON.stringify({ file: path.relative(path.resolve(C4, '..'), OUT), lines, sha256: sha }));
fs.rmSync(tmp, { recursive: true, force: true });
if (bad) process.exit(1);

// Re-verify the Pocket Drop v4 deployment and its recorded live results against the chain. Testnet only, read-only, no keys.
//   node frontend/scripts/reverify.mjs            (run `npm i` in frontend/ once: it uses viem for keccak256 and ABI encoding)
// Checks:
//   1. every recorded v4 contract has code on Diana and its keccak256 equals the recorded runtime keccak
//   2. PocketRouter points at the recorded factory / drop / pool; the factory at the vault implementation
//   3. the timelock constants on the vault implementation equal the recorded values
//   4. every recorded live EVM transaction is mined with the status we claim (success / reverted)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, http, keccak256, parseAbi, defineChain } from 'viem';

const here = path.dirname(fileURLToPath(import.meta.url));
const v4 = JSON.parse(fs.readFileSync(path.join(here, '..', 'src', 'data', 'v4.json'), 'utf8'));
const RPC = process.env.EVM_RPC_URL ?? 'https://evm-testnet.qore.host';
const chain = defineChain({ id: 9800, name: 'diana', nativeCurrency: { name: 'QOR', symbol: 'QOR', decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
const pub = createPublicClient({ chain, transport: http(RPC) });
if ((await pub.getChainId()) !== 9800) throw new Error('not Diana (chain id 9800)');

let pass = 0; let fail = 0;
const check = (ok, label) => { if (ok) pass++; else fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); };
const eq = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

for (const env of ['prod', 'lab']) {
  const i = v4.instances[env];
  for (const k of ['router', 'factory', 'vaultImpl', 'drop', 'pool']) {
    const code = await pub.getCode({ address: i[k].address });
    check(!!code && code !== '0x', `${env}.${k} has code at ${i[k].address}`);
    check(!!code && eq(keccak256(code), i[k].codeKeccak), `${env}.${k} runtime keccak256 equals the recorded ${i[k].codeKeccak.slice(0, 12)}…`);
  }
  const router = parseAbi(['function factory() view returns (address)', 'function drop() view returns (address)', 'function pool() view returns (address)']);
  for (const fn of ['factory', 'drop', 'pool']) {
    const got = await pub.readContract({ address: i.router.address, abi: router, functionName: fn });
    check(eq(got, i[fn].address), `${env}.router.${fn}() == recorded ${fn}`);
  }
  const impl = await pub.readContract({ address: i.factory.address, abi: parseAbi(['function implementation() view returns (address)']), functionName: 'implementation' });
  check(eq(impl, i.vaultImpl.address), `${env}.factory.implementation() == recorded vault implementation`);
  const vault = parseAbi(['function TIMELOCK() view returns (uint256)', 'function RECOVERY_DELAY() view returns (uint256)', 'function FREEZE_PERIOD() view returns (uint256)', 'function UNANIMOUS_RECOVERY_DELAY() view returns (uint256)']);
  for (const fn of ['TIMELOCK', 'RECOVERY_DELAY', 'FREEZE_PERIOD', 'UNANIMOUS_RECOVERY_DELAY']) {
    const got = await pub.readContract({ address: i.vaultImpl.address, abi: vault, functionName: fn });
    check(String(got) === String(i.readBack[fn]), `${env}.vault.${fn} == ${i.readBack[fn]} s`);
  }
}

let evmTxs = 0; let skipped = 0;
for (const r of v4.liveRows) {
  if (!r.hash) continue;
  if (!r.hash.startsWith('0x')) { skipped++; continue; } // Cosmos txs (registrations, funding) are not EVM receipts
  if (r.status !== 'success' && r.status !== 'reverted') continue;
  evmTxs++;
  try {
    const rc = await pub.getTransactionReceipt({ hash: r.hash });
    check(rc.status === r.status, `tx ${r.hash.slice(0, 12)}… is ${rc.status} (recorded ${r.status}): ${r.step.slice(0, 70)}`);
  } catch { check(false, `tx ${r.hash.slice(0, 12)}… not found: ${r.step.slice(0, 70)}`); }
}
console.log(`\n${pass} passed, ${fail} failed. ${evmTxs} recorded EVM transactions checked, ${skipped} Cosmos transactions (registrations and funding) not checked here.`);
process.exit(fail ? 1 : 0);

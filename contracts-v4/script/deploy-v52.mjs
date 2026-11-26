// Deploys Pocket Drop v5.2 (v5.1 + finalize authorization by owner, guardian or approved new owner, vault reentrancy
// lock, Payout lock assertion, explicit drip bounds, zero-address checks, full NatSpec) to QoreChain Diana TESTNET and
// records it under `v5_2` in deployments/diana.json. v5.1, v5 and v4 stay recorded as previous versions. Same layout:
//   prod - TIMELOCK 24 h, RECOVERY_DELAY 48 h, FREEZE_PERIOD 72 h, UNANIMOUS_RECOVERY_DELAY 72 h, BIND_TIMEOUT 3600 s
//   lab  - 60 s delays, FREEZE_PERIOD 120 s, UNANIMOUS_RECOVERY_DELAY 180 s
// plus one PqGuardedCounter. Every contract links PqcLib (internal library), so all of them are redeployed.
//   node script/deploy-v52.mjs --estimate   gas and QOR estimate at the current gas price (no transaction)
//   node script/deploy-v52.mjs              deploy what is missing
//   node script/deploy-v52.mjs --check      compare on-chain runtime code with the local build
// Secrets: QORE_SECRET_FILE (deployer) and QORE_ENV_FILE; never printed.
import { encodeAbiParameters, keccak256, parseEther, formatEther } from 'viem';
import { loadDeployer, Evm, pub, windowOf, openWindow, artifact, readDeployments, writeDeployments, EXPL, qor, gasPrice } from './lib.mjs';

const V = 'v5_2';
const log = (...a) => console.log(...a);
const DAY = 86400n;
const INSTANCES = {
  prod: { timelock: DAY, recovery: 2n * DAY, freeze: 3n * DAY, unanimous: 3n * DAY, bindTimeout: 3600n },
  lab: { timelock: 60n, recovery: 60n, freeze: 120n, unanimous: 180n, bindTimeout: 60n },
};
const DROP = { minEscrow: parseEther('0.1'), maxAmount: parseEther('50'), maxDrip: parseEther('0.6'), dailyDripCap: parseEther('10'), maxExpiry: 30n * DAY };
const POOL = { minPerSlot: parseEther('0.01'), maxPerSlot: parseEther('5'), maxSlots: 20n, maxExpiry: 30n * DAY };
const PLAN = (p, a) => [
  ['vaultImpl', 'PocketVault', ['uint256', 'uint256', 'uint256', 'uint256'], () => [p.timelock, p.recovery, p.freeze, p.unanimous]],
  ['factory', 'PocketFactory', ['address'], () => [a.vaultImpl]],
  ['drop', 'PocketDrop', ['uint256', 'uint256', 'uint256', 'uint256', 'uint256', 'uint256'], () => [DROP.minEscrow, DROP.maxAmount, DROP.maxDrip, DROP.dailyDripCap, p.bindTimeout, DROP.maxExpiry]],
  ['pool', 'DropPool', ['uint256', 'uint256', 'uint256', 'uint256'], () => [POOL.minPerSlot, POOL.maxPerSlot, POOL.maxSlots, POOL.maxExpiry]],
  ['router', 'PocketRouter', ['address', 'address', 'address'], () => [a.factory, a.drop, a.pool]],
];
const enc = (types, values) => (types.length ? encodeAbiParameters(types.map((type) => ({ type })), values) : '0x');

const deployer = await loadDeployer();
const evm = new Evm(deployer);

if (process.argv.includes('--estimate')) {
  const gp = await gasPrice(); // the price deploy() pays (node price x 1.3)
  // constructor checks need contracts with code: estimate against the v4 prod addresses (same sizes of work)
  const p4 = readDeployments().v5_1.prod;
  const dummy = { vaultImpl: p4.vaultImpl.address, factory: p4.factory.address, drop: p4.drop.address, pool: p4.pool.address };
  let total = 0n;
  const rows = [];
  for (const [inst, p] of Object.entries(INSTANCES)) {
    for (const [key, contract, types, values] of PLAN(p, dummy)) {
      const art = artifact(contract);
      const g = await pub.estimateGas({ account: evm.address, data: art.bytecode + enc(types, values()).slice(2) });
      total += g; rows.push([inst, key, contract, g]);
    }
  }
  const cg = await pub.estimateGas({ account: evm.address, data: artifact('PqGuardedCounter').bytecode });
  total += cg; rows.push(['shared', 'counter', 'PqGuardedCounter', cg]);
  for (const r of rows) log(r.join('\t'));
  log(JSON.stringify({ totalGas: String(total), gasPriceWei: String(gp), estimatedQor: formatEther(total * gp), withLimitMargin20pct: formatEther((total * gp * 12n) / 10n), note: 'EVM gas only; the hybrid window-open tx adds a fixed Cosmos fee of 0.1 QOR if a new window is needed' }));
  process.exit(0);
}

const dep = readDeployments();
dep[V] ??= {};

async function runtimeMatches(address, art) {
  const onchain = Buffer.from((await pub.getCode({ address })).slice(2), 'hex');
  const local = Buffer.from(art.deployedBytecode.slice(2), 'hex');
  if (onchain.length !== local.length) return false;
  for (const refs of Object.values(art.immutableReferences)) for (const r of refs) { onchain.fill(0, r.start, r.start + r.length); local.fill(0, r.start, r.start + r.length); }
  return onchain.equals(local);
}

if (process.argv.includes('--check')) {
  for (const [inst, set] of Object.entries(dep[V])) for (const [name, c] of Object.entries(set)) {
    if (!c?.address || !c.contract) continue;
    log(inst, name, c.address, 'runtime matches local build:', await runtimeMatches(c.address, artifact(c.contract)));
  }
  process.exit(0);
}

const w = await windowOf(deployer);
if (!w.live || w.remainingTxs < 20n) { const o = await openWindow(deployer, { maxTxs: 40, valueUqor: 0n }); log('opened window', o.hash); dep[V].windowTx = o.hash; }

async function deployOne(set, key, contract, types, values) {
  if (set[key]?.address) { log(key, 'already at', set[key].address); return set[key].address; }
  const art = artifact(contract);
  const args = enc(types, values);
  const est = await pub.estimateGas({ account: evm.address, data: art.bytecode + args.slice(2) });
  const { hash, receipt } = await evm.deploy({ bytecode: art.bytecode, args, gas: (est * 12n) / 10n });
  if (receipt.status !== 'success') throw new Error(`${key} deploy failed: ${hash}`);
  const address = receipt.contractAddress;
  const ok = await runtimeMatches(address, art);
  if (!ok) throw new Error(`${key}: on-chain runtime differs from the build artifact`);
  set[key] = {
    contract, address, deployTx: hash, deployTxUrl: EXPL + hash, blockNumber: String(receipt.blockNumber), gasUsedReceipt: String(receipt.gasUsed),
    effectiveGasPrice: String(receipt.effectiveGasPrice ?? ''), constructorArgsAbiEncoded: args, constructorArgs: values.map(String),
    runtimeCodeBytes: (art.deployedBytecode.length - 2) / 2, runtimeCodeKeccak: keccak256(await pub.getCode({ address })),
    runtimeMatchesBuildArtifactModuloImmutables: ok,
  };
  writeDeployments(dep);
  log(inst_, key, 'deployed', address, 'gas', receipt.gasUsed, hash);
  return address;
}
let inst_ = '';
const startBal = await pub.getBalance({ address: evm.address });
for (const [inst, p] of Object.entries(INSTANCES)) {
  inst_ = inst;
  dep[V][inst] ??= { params: { timelockSeconds: String(p.timelock), recoverySeconds: String(p.recovery), freezeSeconds: String(p.freeze), unanimousRecoverySeconds: String(p.unanimous), bindTimeoutSeconds: String(p.bindTimeout) } };
  const set = dep[V][inst];
  const a = {};
  for (const [key, contract, types, values] of PLAN(p, a)) a[key] = await deployOne(set, key, contract, types, values());
}
inst_ = 'shared';
dep[V].shared ??= {};
await deployOne(dep[V].shared, 'counter', 'PqGuardedCounter', [], []);

const vabi = artifact('PocketVault').abi;
for (const inst of Object.keys(INSTANCES)) {
  const a = dep[V][inst].vaultImpl.address;
  const rd = (fn, addr = a, abi = vabi) => pub.readContract({ address: addr, abi, functionName: fn }).then(String);
  dep[V][inst].readBack = { TIMELOCK: await rd('TIMELOCK'), RECOVERY_DELAY: await rd('RECOVERY_DELAY'), FREEZE_PERIOD: await rd('FREEZE_PERIOD'), UNANIMOUS_RECOVERY_DELAY: await rd('UNANIMOUS_RECOVERY_DELAY'), BIND_TIMEOUT: await rd('BIND_TIMEOUT', dep[V][inst].drop.address, artifact('PocketDrop').abi) };
}
const endBal = await pub.getBalance({ address: evm.address });
dep[V].note = 'v5.2 = v5.1 + explicit finalize authorization (owner, guardian or approved new owner, ML-DSA-87), vault reentrancy lock on external-call functions, Payout lock assertion, explicit drip bounds, zero-address checks and full NatSpec. v5.1, v5 and v4 are previous versions.';
dep[V].deployedAt = new Date().toISOString();
dep[V].deploySpentQorEvm = qor(startBal - endBal);
dep[V].build = { solc: '0.8.28', optimizer: { enabled: true, runs: 200 }, evmVersion: 'cancun', bytecodeHash: 'none', cborMetadata: false, reproduce: 'cd contracts-v4 && forge build && node script/deploy-v52.mjs --check' };
writeDeployments(dep);
log('deployer EVM balance QOR', qor(endBal), 'spent on this run', qor(startBal - endBal));

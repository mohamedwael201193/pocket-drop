// Deploys Pocket Drop v4 to QoreChain Diana TESTNET from the deployer account and records everything in
// deployments/diana.json. Two full instances of the SAME bytecode are deployed:
//   prod - TIMELOCK 24 h, RECOVERY_DELAY 48 h, BIND_TIMEOUT 3600 s
//   lab  - 60 s delays everywhere, so the live suite can show timelock / recovery / veto / rebind in minutes
// Each instance = PocketVault (implementation) + PocketFactory + PocketDrop + DropPool + PocketRouter.
// One PqGuardedCounter (example consumer of PqGuard) is deployed once.
//   node script/deploy.mjs            deploy what is missing
//   node script/deploy.mjs --check    compare on-chain runtime code with the local build
import { encodeAbiParameters, keccak256, parseEther } from 'viem';
import {
  loadDeployer, Evm, pub, windowOf, openWindow, artifact, readDeployments, writeDeployments, EXPL, qor,
} from './lib.mjs';

const log = (...a) => console.log(...a);
const DAY = 86400n;
const INSTANCES = {
  prod: { timelock: DAY, recovery: 2n * DAY, bindTimeout: 3600n },
  lab: { timelock: 60n, recovery: 60n, bindTimeout: 60n },
};
const DROP = { minEscrow: parseEther('0.1'), maxAmount: parseEther('50'), maxDrip: parseEther('0.6'), dailyDripCap: parseEther('10'), maxExpiry: 30n * DAY };
const POOL = { minPerSlot: parseEther('0.01'), maxPerSlot: parseEther('5'), maxSlots: 20n, maxExpiry: 30n * DAY };

const deployer = await loadDeployer();
const evm = new Evm(deployer);
const dep = readDeployments();
dep.network ??= { name: 'qorechain-diana', evmChainId: 9800, cosmosChainId: 'qorechain-diana', explorer: 'https://explore.qore.network' };
dep.deployer ??= { address: evm.address, cosmos: deployer.cosmos };
dep.v4 ??= {};

/** Compare on-chain runtime code to the build artifact, ignoring immutable slots. */
async function runtimeMatches(address, art) {
  const onchain = Buffer.from((await pub.getCode({ address })).slice(2), 'hex');
  const local = Buffer.from(art.deployedBytecode.slice(2), 'hex');
  if (onchain.length !== local.length) return false;
  for (const refs of Object.values(art.immutableReferences)) for (const r of refs) { onchain.fill(0, r.start, r.start + r.length); local.fill(0, r.start, r.start + r.length); }
  return onchain.equals(local);
}

if (process.argv.includes('--check')) {
  for (const [inst, set] of Object.entries(dep.v4)) {
    for (const [name, c] of Object.entries(set)) {
      if (!c?.address || !c.contract) continue;
      log(inst, name, c.address, 'runtime matches local build:', await runtimeMatches(c.address, artifact(c.contract)));
    }
  }
  process.exit(0);
}

const w = await windowOf(deployer);
if (!w.live || w.remainingTxs < 20n) { const o = await openWindow(deployer, { maxTxs: 200, valueUqor: 12_000_000n }); log('opened window', o.hash); }

async function deployOne(set, key, contract, types, values) {
  if (set[key]?.address) { log(key, 'already at', set[key].address); return set[key].address; }
  const art = artifact(contract);
  const args = types.length ? encodeAbiParameters(types.map((type) => ({ type })), values) : '0x';
  const data = art.bytecode + args.slice(2);
  const gp = await pub.getGasPrice();
  const est = await pub.estimateGas({ account: evm.address, data, gasPrice: gp });
  const { hash, receipt } = await evm.deploy({ bytecode: art.bytecode, args, gas: (est * 12n) / 10n });
  if (receipt.status !== 'success') throw new Error(`${key} deploy failed: ${hash}`);
  const address = receipt.contractAddress;
  const ok = await runtimeMatches(address, art);
  if (!ok) throw new Error(`${key}: on-chain runtime differs from the build artifact`);
  set[key] = {
    contract, address, deployTx: hash, deployTxUrl: EXPL + hash, blockNumber: String(receipt.blockNumber), gasUsedReceipt: String(receipt.gasUsed),
    constructorArgsAbiEncoded: args, constructorArgs: values.map(String),
    runtimeCodeBytes: (art.deployedBytecode.length - 2) / 2, runtimeCodeKeccak: keccak256(await pub.getCode({ address })),
    runtimeMatchesBuildArtifactModuloImmutables: ok,
  };
  writeDeployments(dep);
  log(key, 'deployed', address, 'gas', receipt.gasUsed, hash);
  return address;
}

const startBal = await pub.getBalance({ address: evm.address });
for (const [inst, p] of Object.entries(INSTANCES)) {
  dep.v4[inst] ??= { params: { timelockSeconds: String(p.timelock), recoverySeconds: String(p.recovery), bindTimeoutSeconds: String(p.bindTimeout) } };
  const set = dep.v4[inst];
  const impl = await deployOne(set, 'vaultImpl', 'PocketVault', ['uint256', 'uint256'], [p.timelock, p.recovery]);
  const factory = await deployOne(set, 'factory', 'PocketFactory', ['address'], [impl]);
  const drop = await deployOne(set, 'drop', 'PocketDrop', ['uint256', 'uint256', 'uint256', 'uint256', 'uint256', 'uint256'],
    [DROP.minEscrow, DROP.maxAmount, DROP.maxDrip, DROP.dailyDripCap, p.bindTimeout, DROP.maxExpiry]);
  const pool = await deployOne(set, 'pool', 'DropPool', ['uint256', 'uint256', 'uint256', 'uint256'], [POOL.minPerSlot, POOL.maxPerSlot, POOL.maxSlots, POOL.maxExpiry]);
  await deployOne(set, 'router', 'PocketRouter', ['address', 'address', 'address'], [factory, drop, pool]);
}
dep.v4.shared ??= {};
await deployOne(dep.v4.shared, 'counter', 'PqGuardedCounter', [], []);

// read back immutables so the record shows what the chain holds
const vabi = artifact('PocketVault').abi;
for (const inst of Object.keys(INSTANCES)) {
  const a = dep.v4[inst].vaultImpl.address;
  dep.v4[inst].readBack = {
    TIMELOCK: String(await pub.readContract({ address: a, abi: vabi, functionName: 'TIMELOCK' })),
    RECOVERY_DELAY: String(await pub.readContract({ address: a, abi: vabi, functionName: 'RECOVERY_DELAY' })),
    BIND_TIMEOUT: String(await pub.readContract({ address: dep.v4[inst].drop.address, abi: artifact('PocketDrop').abi, functionName: 'BIND_TIMEOUT' })),
  };
}
dep.build = {
  solc: '0.8.28', optimizer: { enabled: true, runs: 200 }, evmVersion: 'cancun', viaIR: false, bytecodeHash: 'none', cborMetadata: false,
  reproduce: 'cd contracts-v4 && forge build && node script/deploy.mjs --check',
};
const endBal = await pub.getBalance({ address: evm.address });
dep.deployer.evmBalanceQorAfterV4Deploy = qor(endBal);
dep.deployer.v4DeploySpentQor = qor(startBal - endBal);
writeDeployments(dep);
log('deployer balance QOR', qor(endBal), 'spent on this run', qor(startBal - endBal));

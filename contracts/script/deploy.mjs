// Deploys PocketDrop to QoreChain Diana TESTNET from the deployer account and records everything in deployments/diana.json.
//   node script/deploy.mjs
// Two instances of the SAME bytecode are deployed:
//   main - production-style constants (BIND_TIMEOUT 3600)
//   lab  - identical except BIND_TIMEOUT 60 so the live suite can show a real rebind-after-timeout in seconds, not an hour
import fs from 'node:fs';
import path from 'node:path';
import { encodeAbiParameters, keccak256, parseEther, decodeAbiParameters } from 'viem';
import {
  loadDeployer, Evm, pub, windowOf, openWindow, loadArtifact, readDeployments, writeDeployments, EXPL, ROOT, qor,
} from './lib.mjs';

const ARGS_ABI = ['uint256', 'uint256', 'uint256', 'uint256', 'uint256', 'uint256'].map((type) => ({ type }));
const MAIN = {
  MIN_ESCROW: parseEther('0.1'), MAX_AMOUNT: parseEther('50'), MAX_DRIP: parseEther('0.6'),
  DAILY_DRIP_CAP: parseEther('10'), BIND_TIMEOUT: 3600n, MAX_EXPIRY: 30n * 86400n,
};
const LAB = { ...MAIN, BIND_TIMEOUT: 60n };
const order = ['MIN_ESCROW', 'MAX_AMOUNT', 'MAX_DRIP', 'DAILY_DRIP_CAP', 'BIND_TIMEOUT', 'MAX_EXPIRY'];
const log = (...a) => console.log(...a);

const art = loadArtifact();
const deployer = await loadDeployer();
const evm = new Evm(deployer);
const dep = readDeployments();
dep.contracts ??= {};

let w = await windowOf(deployer);
if (!w.live || w.remainingTxs < 10n) { const o = await openWindow(deployer, { maxTxs: 200, valueUqor: 12_000_000n }); log('opened window', o.hash); }

/** Compare on-chain runtime code to the build artifact, ignoring the immutable slots (which hold the constructor args). */
async function runtimeMatches(address) {
  const onchain = (await pub.getCode({ address })).slice(2);
  const local = art.deployedBytecode.slice(2);
  if (onchain.length !== local.length) return false;
  const j = JSON.parse(fs.readFileSync(path.join(ROOT, 'out', 'PocketDrop.sol', 'PocketDrop.json'), 'utf8'));
  const mask = (hex) => {
    const b = Buffer.from(hex, 'hex');
    for (const refs of Object.values(j.deployedBytecode.immutableReferences ?? {})) for (const r of refs) b.fill(0, r.start, r.start + r.length);
    return b.toString('hex');
  };
  return mask(onchain) === mask(local);
}

async function deployOne(name, consts) {
  if (dep.contracts[name]?.address) { log(name, 'already deployed at', dep.contracts[name].address); return; }
  const args = encodeAbiParameters(ARGS_ABI, order.map((k) => consts[k]));
  const data = art.bytecode + args.slice(2);
  const gp = await pub.getGasPrice();
  const est = await pub.estimateGas({ account: evm.address, data, gasPrice: gp });
  const gas = (est * 12n) / 10n;
  log(name, 'deploy estimateGas', est, 'limit', gas);
  const { hash, receipt } = await evm.deploy({ bytecode: art.bytecode, args, gas });
  if (receipt.status !== 'success') throw new Error(name + ' deploy failed: ' + hash);
  const address = receipt.contractAddress;
  const ok = await runtimeMatches(address);
  if (!ok) throw new Error('on-chain runtime code differs from the build artifact');
  // read the constants back
  const abi = art.abi;
  const read = {};
  for (const k of order) read[k] = String(await pub.readContract({ address, abi, functionName: k }));
  dep.contracts[name] = {
    address, deployTx: hash, deployTxUrl: EXPL + hash, blockNumber: String(receipt.blockNumber), deployer: evm.address,
    gasUsedReceipt: String(receipt.gasUsed),
    constructorArgs: Object.fromEntries(order.map((k) => [k, consts[k].toString()])),
    constructorArgsHuman: { MIN_ESCROW: qor(consts.MIN_ESCROW) + ' QOR', MAX_AMOUNT: qor(consts.MAX_AMOUNT) + ' QOR', MAX_DRIP: qor(consts.MAX_DRIP) + ' QOR', DAILY_DRIP_CAP: qor(consts.DAILY_DRIP_CAP) + ' QOR', BIND_TIMEOUT: consts.BIND_TIMEOUT + ' s', MAX_EXPIRY: consts.MAX_EXPIRY + ' s' },
    constructorArgsAbiEncoded: args,
    readBackConstants: read,
    runtimeCodeKeccak: keccak256(('0x' + (await pub.getCode({ address })).slice(2))),
    runtimeMatchesBuildArtifactModuloImmutables: ok,
  };
  dep.build = {
    solc: '0.8.28', optimizer: { enabled: true, runs: 200 }, evmVersion: 'cancun', viaIR: false, bytecodeHash: 'none', cborMetadata: false,
    sources: ['src/PocketDrop.sol', 'src/PqcLib.sol', 'src/interfaces/IPocketDrop.sol'],
    initCodeBytes: (art.bytecode.length - 2) / 2, runtimeCodeBytes: (art.deployedBytecode.length - 2) / 2,
    initCodeKeccak: keccak256(art.bytecode), reproduce: 'cd contracts && forge build && node script/deploy.mjs --check',
  };
  writeDeployments(dep);
  log(name, 'deployed', address, 'tx', hash, EXPL + hash);
}

if (process.argv.includes('--check')) {
  for (const [n, c] of Object.entries(dep.contracts)) log(n, c.address, 'runtime matches local build:', await runtimeMatches(c.address));
  process.exit(0);
}
await deployOne('main', MAIN);
await deployOne('lab', LAB);
dep.deployer.evmBalanceQorAfterDeploy = qor(await pub.getBalance({ address: evm.address }));
writeDeployments(dep);
log('deployer balance QOR', dep.deployer.evmBalanceQorAfterDeploy);

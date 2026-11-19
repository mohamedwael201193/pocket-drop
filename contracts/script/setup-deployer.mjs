// Creates the Pocket Drop deployer (fresh secp256k1 + ML-DSA-87 from random seeds), funds it from the MAIN test wallet,
// registers its PQ key with proof of possession and opens an EVM window.  TESTNET ONLY.
//   node script/setup-deployer.mjs [fundQOR=15]
// Secrets go to D:/route/QORE/.secrets/pocketdrop-deployer.json and are never printed.
import {
  readSecrets, writeSecrets, newAccountRecord, accountFrom, loadMain, bankUqor, fundFromMain, registerWithPoP,
  openWindow, windowOf, keyStatus, readDeployments, writeDeployments, EXPL, qor, pub,
} from './lib.mjs';

const FUND_QOR = Number(process.argv[2] ?? 15);
const log = (...a) => console.log(...a);

let secrets = readSecrets() ?? {};
if (!secrets.deployer) {
  const { record } = await newAccountRecord('pocketdrop-deployer');
  secrets = {
    note: 'Pocket Drop deployer + live-suite recipients. QoreChain Diana TESTNET ONLY. Never commit.',
    ...secrets,
    deployer: record,
    freshRecipients: secrets.freshRecipients ?? [],
  };
  writeSecrets(secrets);
  log('created deployer', record.evm, record.cosmos);
}
const deployer = await accountFrom(secrets.deployer);
log('deployer 0x ', deployer.evm);
log('deployer qor1', deployer.cosmos);

const dep = readDeployments();
dep.network = { name: 'qorechain-diana', evmChainId: 9800, cosmosChainId: 'qorechain-diana', explorer: 'https://explore.qore.network' };
dep.deployer = { address: deployer.evm, cosmos: deployer.cosmos };
dep.fundingFromMain ??= [];

const have = await bankUqor(deployer.cosmos);
log('deployer balance QOR', Number(have) / 1e6);
if (have < BigInt(Math.floor(FUND_QOR * 0.9 * 1e6))) {
  const main = await loadMain();
  log('main wallet', main.evm, 'balance QOR', Number(await bankUqor(main.cosmos)) / 1e6);
  const hash = await fundFromMain(main, deployer.cosmos, Math.floor(FUND_QOR * 1e6));
  dep.fundingFromMain.push({ qor: FUND_QOR, to: deployer.evm, cosmosTx: hash, url: EXPL + hash, at: new Date().toISOString() });
  writeDeployments(dep);
  log('funded', FUND_QOR, 'QOR from main:', hash);
  log('deployer balance QOR', Number(await bankUqor(deployer.cosmos)) / 1e6);
}

const reg = await registerWithPoP(deployer);
if (!reg.skipped) { dep.deployer.registerPqcTx = reg.hash; log('registered PQ key with PoP:', reg.hash); }
const st = await keyStatus(deployer.evm);
log('pqcKeyStatus: registered', st.registered, 'possessionProven', st.possessionProven);
dep.deployer.possessionProven = st.possessionProven;

let w = await windowOf(deployer);
if (!w.live || w.remainingTxs < 40n) {
  const o = await openWindow(deployer, { maxTxs: 200, blocks: 17000, valueUqor: 12_000_000n });
  dep.deployer.openWindowTx = o.hash; log('opened EVM window:', o.hash);
  w = await windowOf(deployer);
}
log('window live', w.live, 'remainingTxs', String(w.remainingTxs), 'remainingBlocks', String(w.remainingBlocks), 'remainingValue uqor', String(w.remainingValue));
writeDeployments(dep);
log('deployer EVM balance QOR', qor(await pub.getBalance({ address: deployer.evm })));

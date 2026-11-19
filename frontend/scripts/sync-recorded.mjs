// Regenerates src/data/recorded.json (RECORDED data) from pocketdrop/contracts/deployments/diana.json.
import fs from 'node:fs';
const src = process.argv[2] || 'D:/route/QORE/pocketdrop/contracts/deployments/diana.json';
const d = JSON.parse(fs.readFileSync(src, 'utf8'));
const out = {
  network: d.network, deployer: d.deployer.address,
  main: { address: d.contracts.main.address, deployTx: d.contracts.main.deployTx, blockNumber: d.contracts.main.blockNumber, constructorArgsHuman: d.contracts.main.constructorArgsHuman, runtimeCodeKeccak: d.contracts.main.runtimeCodeKeccak },
  lab: { address: d.contracts.lab.address, deployTx: d.contracts.lab.deployTx, blockNumber: d.contracts.lab.blockNumber, constructorArgsHuman: d.contracts.lab.constructorArgsHuman },
  build: { solc: d.build.solc, runtimeCodeBytes: d.build.runtimeCodeBytes },
  liveTxs: d.liveTxs.map((t) => ({ step: t.step, hash: t.hash, status: t.status, outcome: t.outcome, expected: !!t.expected })),
  liveSummary: d.liveSummary,
};
fs.writeFileSync(new URL('../src/data/recorded.json', import.meta.url), JSON.stringify(out, null, 1));
console.log('wrote', out.liveTxs.length, 'recorded txs');

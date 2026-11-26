// Refunds expired v5 PRODUCTION links (TEAM-RUN cleanup; anyone may call refund after expiry). Default: links 3 and 4, the
// two aborted self-relay attempts (expiry 26 Nov 2026 04:29 Cairo). The escrow returns to each link's sender Pocket.
//   QORE_SECRET_FILE=<deployer json> QORE_ENV_FILE=<.env> node script/refund-expired-v5.mjs [ids=3,4]
// Results: deployments/diana.json -> v5.refunds (tx hash, status, sender Pocket balance change).
import { encodeFunctionData, formatEther } from 'viem';
import { loadDeployer, Evm, pub, windowOf, openWindow, artifact, readDeployments, writeDeployments, EXPL } from './lib.mjs';

const ids = (process.argv[2] ?? '3,4').split(',').map((x) => BigInt(x));
const dep = readDeployments();
const P = dep.v5.prod;
const A = { drop: artifact('PocketDrop').abi, router: artifact('PocketRouter').abi };
const deployer = await loadDeployer();
const evm = new Evm(deployer);
const now = Number((await pub.getBlock()).timestamp);
const w = await windowOf(deployer);
if (!w.live || BigInt(w.remainingTxs ?? 0) < BigInt(ids.length)) {
  const o = await openWindow(deployer, { maxTxs: ids.length + 1, blocks: 300, gasCap: 1_000_000n, valueUqor: 500_000n });
  console.log('window opened', o.hash);
}
dep.v5.refunds ??= [];
for (const id of ids) {
  const l = await pub.readContract({ address: P.drop.address, abi: A.drop, functionName: 'getLink', args: [id] });
  if (now <= Number(l.expiry)) { console.log(`link ${id} not expired yet (expiry ${new Date(Number(l.expiry) * 1000).toISOString()})`); continue; }
  const before = await pub.getBalance({ address: l.sender });
  const data = encodeFunctionData({ abi: A.router, functionName: 'relay', args: [P.drop.address, encodeFunctionData({ abi: A.drop, functionName: 'refund', args: [id] })] });
  const est = await pub.estimateGas({ account: evm.address, to: P.router.address, data });
  const { hash, receipt } = await evm.send({ to: P.router.address, data, gas: (est * 13n) / 10n });
  const gain = (await pub.getBalance({ address: l.sender })) - before;
  dep.v5.refunds.push({ step: `refund v5 prod link ${id} (expired) to its sender Pocket ${l.sender}`, hash, url: EXPL + hash, status: receipt.status, gasUsed: String(receipt.gasUsed), refundedQor: formatEther(gain), at: new Date().toISOString() });
  writeDeployments(dep);
  console.log(receipt.status, id, hash, '+' + formatEther(gain));
}

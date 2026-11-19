// node scripts/fund.mjs <0xAddress> <QOR> [note]  -> prints {"hash":...,"totalSpentQor":...}.
// Testnet only; 6 QOR total spend cap for the v2 run (tracked in evidence/v2/spend.json). Reads the deployer secret in-process, never prints it.
import { fundFromDeployer, spent } from './chain.mjs';

const [to, qor, note] = process.argv.slice(2);
if (!/^0x[0-9a-fA-F]{40}$/.test(to ?? '') || !(Number(qor) > 0)) { console.error('usage: fund.mjs <0xAddress> <QOR> [note]'); process.exit(2); }
const hash = await fundFromDeployer(to, qor, note ?? 'e2e sender funding');
console.log(JSON.stringify({ hash, totalSpentQor: spent().totalQor }));

// Live relay smoke test (Diana testnet, TEAM-RUN): one tiny owner-signed spend from a team QA Pocket, sent through the
// public API exactly like the app does it (ML-DSA-87 intent -> /api/route -> hybrid MsgCrossVMCall via the isolated signer).
// Usage (from frontend/): [ENV=prodV4|prodV5|prod] npx vite-node scripts/relay-smoke.ts -- <path to a JSON file with {"root":"pd2:..."}> [amountQOR=0.01]
// The root is read from the file and never printed. Costs one relay (paid by the relayer) and moves amountQOR from the
// Pocket to the Pocket owner's own key account.
import fs from 'node:fs';
import { formatEther, parseEther, type Hex } from 'viem';
import { deriveAccount } from '../src/lib/identity';
import { defaultCfg, predictPocket, readPocket, ALL_ENVS, type Env } from '../src/lib/v4';
import { spend } from '../src/lib/actions';

const env = (process.env.ENV ?? 'prod') as Env;
if (!ALL_ENVS.includes(env)) throw new Error('ENV must be one of ' + ALL_ENVS.join(', '));
const [file, amt = '0.01'] = process.argv.slice(2).filter((a) => a !== '--');
const root = JSON.parse(fs.readFileSync(file, 'utf8')).root as string;
const acct = await deriveAccount(root);
const owner = acct.evm as Hex;
const cfg = defaultCfg(owner);
const pocket = (await predictPocket(env, cfg)) as Hex;
const before = await readPocket(env, pocket);
console.log(JSON.stringify({ step: 'read', env, owner, pocket, balance: formatEther(before.balance) }));
if (process.env.DRY) process.exit(0);
const res = await spend({ env, cfg, address: pocket, acct }, owner, parseEther(amt));
console.log(JSON.stringify({ step: 'relayed', res }, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));

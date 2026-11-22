// Builds src/data/relayCosts.json: what each hybrid relay cost the relayer on Diana, from the recorded QA evidence
// (frontend/evidence/v4/e2e/hybrid-relay*.json, every row a mined MsgCrossVMCall with its fee). RECORDED, not estimated.
// Run: node scripts/relay-costs.mjs   (the unit test fails when the JSON and the evidence disagree)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const EV = path.join(here, '..', 'evidence', 'v4', 'e2e');
const FILES = ['hybrid-relay-live-2026-11-22.json', 'hybrid-relay-d-lab-live-2026-11-22.json', 'hybrid-relay-v3-live-2026-11-22.json', 'hybrid-relay-qday-2026-11-22.json'];

// [id, label, who asks for it, who pays, step pattern]
export const ACTIONS = [
  ['create', 'Send a drop (first action also deploys the Pocket)', 'sender', 'relayer float', /^sender createDrop$/],
  ['bind', 'Receiver opens the link (bind)', 'receiver', 'delivery fee', /^recipient bind$/],
  ['confirm', 'Sender confirms the 4 words (Confirmed mode)', 'sender', 'delivery fee', /^sender confirmDrop$/],
  ['claim', 'Receiver claims into the Pocket', 'receiver', 'delivery fee', /^recipient claim$/],
  ['createPool', 'Host a Drop Pool', 'host', 'relayer float', /^host createPool/],
  ['poolClaim', 'Take a pool slot', 'claimer', 'relayer float', /^claimer\d takes slot$/],
  ['closePool', 'Close a pool (unclaimed slots return)', 'host', 'relayer float', /^host closePool$/],
  ['firstSpend', 'First spend (deploys the Pocket)', 'owner', 'relayer float', /^(owner spend .*lazy deploy|sweep recipient Pocket)/],
  ['spend', 'Spend from a deployed Pocket', 'owner', 'relayer float', /^sweep (sender|host|recovered)/],
  ['timelock', 'Queue, veto or execute a timelocked spend', 'owner or anyone', 'relayer float', /^(owner queues spend|owner vetoes queued|anyone executes queued)/],
  ['settings', 'Change the daily limit or guardians (queue or apply)', 'owner or anyone', 'relayer float', /^(owner lowers limit|owner queues (limit|guardians)|anyone applies)/],
  ['freeze', 'Guardian freeze', 'guardians', 'relayer float', /^guardians .*freeze$/],
  ['recovery', 'Recovery: propose, veto or finish', 'guardians or owner', 'relayer float', /(propose .*recovery|vetoes recovery|finishes .*recovery)/],
  ['v3', 'Legacy v3 link: bind or claim', 'receiver', 'relayer float (v3 fee)', /^recipient (bind|claim)$/, 'v3'],
  ['qday', 'Q-Day attempt (refused by the chain, code 14)', 'visitor', 'relayer float (3 per hour per visitor)', /^Q-Day attempt/],
];

export function build(read = (f) => JSON.parse(fs.readFileSync(path.join(EV, f), 'utf8'))) {
  const rows = [];
  for (const [id, label, who, payer, re, only] of ACTIONS) {
    const hits = [];
    for (const f of FILES) {
      if (only === 'v3' ? !f.includes('-v3-') : f.includes('-v3-')) continue;
      for (const t of read(f).txs ?? []) if (re.test(t.step ?? '')) hits.push({ ...t, file: f });
    }
    if (!hits.length) throw new Error(`no recorded tx for ${id}`);
    const fees = hits.map((t) => Number(String(t.fee).replace(/uqor$/, '')));
    const ex = hits[fees.indexOf(Math.max(...fees))];
    rows.push({ id, label, who, payer, n: hits.length, minUqor: Math.min(...fees), maxUqor: Math.max(...fees), example: ex.hash, exampleCode: ex.code, source: `frontend/evidence/v4/e2e/${ex.file}` });
  }
  return { label: 'RECORDED', note: 'Network fee the relayer paid for each hybrid relay (secp256k1 + ML-DSA-87 MsgCrossVMCall) in TEAM-RUN QA on Diana, 22 Nov 2026. 1 QOR = 1,000,000 uqor.', rows };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const out = path.join(here, '..', 'src', 'data', 'relayCosts.json');
  fs.writeFileSync(out, JSON.stringify(build(), null, 2) + '\n');
  console.log('wrote', out);
}

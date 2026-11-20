// TEAM-RUN Q-Day attacker bot (ours, clearly labelled on /qday). Runs hourly from GitHub Actions:
//   1. every classical-key path against every bait, read-only (CometBFT check_tx + eth_call);
//   2. every 6th hour (or MINE=1), one Pocket attempt put on chain through the relayer with the QDAYBOT1 marker.
// Exit code 2 = a breach signal (an attempt would succeed, a key changed, or a window is live). Diana testnet only.
import fs from 'node:fs';
import path from 'node:path';
import { attackBait } from './attack.mjs';
import { API, C4 } from './common.mjs';

const summary = (s) => { if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, s + '\n'); console.log(s); };

let live = null;
try { live = await (await fetch(`${API}/api/qday`)).json(); } catch { /* API down: fall back to the deployment record */ }
const baits = live?.baits ?? JSON.parse(fs.readFileSync(path.join(C4, 'deployments', 'qday-baits.json'), 'utf8')).baits;
const secretKeys = process.env.QDAY_BAIT_KEYS ? JSON.parse(process.env.QDAY_BAIT_KEYS) : {};
const hour = new Date().getUTCHours();
const mine = process.env.MINE === '1' || hour % 6 === 0;
const order = ['E1', 'E3', 'E4', 'E2', 'E5'];

summary(`## Q-Day team bot (TEAM-RUN), ${new Date().toISOString()}`);
const all = []; const attempts = {};
for (const b of baits) {
  const key = secretKeys[b.id] ?? b.classicalKey;
  if (!key) { summary(`- ${b.id}: no key available, skipped`); continue; }
  const { rows, attempts: a } = await attackBait(b, key, { mode: 'check' });
  all.push(...rows); attempts[b.id] = a;
  const bad = rows.filter((r) => ['ACCEPTED', 'WOULD SUCCEED', 'CHANGED', 'WINDOW LIVE - EXPOSED'].includes(r.outcome));
  summary(`- ${b.id}: ${rows.length} paths, ${bad.length} breach signals`);
}
if (mine && Object.keys(attempts).length) {
  const ids = Object.keys(attempts);
  const id = ids[Math.floor(Date.now() / 3_600_000 / 6) % ids.length];
  const which = order.find((e) => attempts[id][e]);
  if (which) {
    const a = attempts[id][which];
    const r = await fetch(`${API}/api/qday`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ to: a.to, data: a.data, botToken: process.env.QDAY_BOT_TOKEN }) });
    const j = await r.json().catch(() => ({}));
    summary(`- mined ${id}:${which} through the relayer: HTTP ${r.status} ${j.txHash ? `${j.status} ${j.explorer}` : JSON.stringify(j.error ?? j).slice(0, 200)}`);
  }
}
const broke = all.filter((r) => ['ACCEPTED', 'WOULD SUCCEED', 'CHANGED', 'WINDOW LIVE - EXPOSED'].includes(r.outcome));
summary(broke.length ? `\n**BREACH SIGNALS: ${broke.length}**\n${broke.map((r) => `- ${r.bait} ${r.id} ${r.outcome} ${r.detail}`).join('\n')}` : `\n${all.length} attempts, 0 succeeded.`);
process.exitCode = broke.length ? 2 : 0;

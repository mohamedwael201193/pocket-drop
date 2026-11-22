import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { REQUIREMENTS } from '../src/data/requirements';
import v4 from '../src/data/v4.json';

const repo = path.resolve(__dirname, '..', '..');
const qorex = fs.readFileSync(path.join(repo, 'frontend/evidence/v4/e2e/qorex-wallet-intent-2026-11-20.json'), 'utf8').toLowerCase();
const recorded = new Map(v4.liveRows.filter((r) => r.hash).map((r) => [r.hash!.toLowerCase(), r]));
const testNames = new Set(
  fs.readdirSync(path.join(repo, 'contracts-v4/test')).filter((f) => f.endsWith('.t.sol'))
    .flatMap((f) => [...fs.readFileSync(path.join(repo, 'contracts-v4/test', f), 'utf8').matchAll(/function (test\w+)/g)].map((m) => m[1])),
);

describe('/judges requirement table', () => {
  it('every live hash is a recorded transaction that reverify.mjs checks, with the status its label claims', () => {
    for (const r of REQUIREMENTS) for (const t of r.live) {
      if (!t.hash) { expect(t.note, `${r.id}: a row without a hash says why`).toBeTruthy(); continue; }
      const h = t.hash.toLowerCase();
      const row = recorded.get(h);
      if (!row) { expect(qorex, `${r.id}: ${t.hash} is in the evidence`).toContain(h); continue; }
      const claimsRevert = /reverted/i.test(t.label);
      expect(row.status === 'reverted', `${r.id}: ${t.label}`).toBe(claimsRevert);
    }
  });
  it('every code link points at a file that exists, and every Foundry test named exists', () => {
    for (const r of REQUIREMENTS) {
      for (const c of r.code) expect(fs.existsSync(path.join(repo, c.path.split('#')[0])), c.path).toBe(true);
      for (const t of r.tests) if (/^test\w+$/.test(t)) expect(testNames.has(t), t).toBe(true);
    }
  });
});

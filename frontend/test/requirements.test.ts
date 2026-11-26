import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { REQUIREMENTS } from '../src/data/requirements';
import v4 from '../src/data/v4.json';

const repo = path.resolve(__dirname, '..', '..');
const qorex = fs.readFileSync(path.join(repo, 'frontend/evidence/v4/e2e/qorex-wallet-intent-2026-11-20.json'), 'utf8').toLowerCase();
const hybrid = new Map<string, { code: number }>(
  fs.readdirSync(path.join(repo, 'frontend/evidence/v4/e2e')).filter((f) => /^hybrid-relay.*\.json$/.test(f))
    .flatMap((f) => (JSON.parse(fs.readFileSync(path.join(repo, 'frontend/evidence/v4/e2e', f), 'utf8')).txs as { hash: string; code: number }[]).map((t) => [t.hash.toLowerCase(), t] as const)),
);
const selfRelay = new Map<string, { status?: string; code?: number }>(
  fs.readdirSync(path.join(repo, 'frontend/evidence/v4/e2e')).filter((f) => /^self-relay-.*\.json$/.test(f))
    .flatMap((f) => (JSON.parse(fs.readFileSync(path.join(repo, 'frontend/evidence/v4/e2e', f), 'utf8')).rows as { hash?: string; status?: string; code?: number }[]).filter((r) => r.hash).map((r) => [r.hash!.toLowerCase(), r] as const)),
);
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
      const hy = hybrid.get(h);
      if (hy) { expect(hy.code !== 0, `${r.id}: ${t.label}`).toBe(/refused/i.test(t.label)); continue; }
      const sr = selfRelay.get(h);
      if (sr) { expect(sr.status === 'success' || sr.code === 0, `${r.id}: ${t.label}`).toBe(true); continue; }
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

import { isRefusedTx, splitRequirement, TEST_COLLAPSE_THRESHOLD } from '../src/components/RequirementsList';

describe('/judges requirement card helpers', () => {
  it('splits each requirement into a readable title and optional summary without dropping text', () => {
    for (const r of REQUIREMENTS) {
      const { title, summary } = splitRequirement(r.requirement);
      expect(title.length, r.id).toBeGreaterThanOrEqual(4);
      if (summary) {
        expect(summary.length, r.id).toBeGreaterThan(3);
        const rejoined = `${title} ${summary}`.replace(/\s+/g, ' ');
        for (const word of r.requirement.split(/\s+/)) {
          const clean = word.replace(/[.:;]$/, '');
          if (clean) expect(rejoined, `${r.id}: ${word}`).toContain(clean);
        }
      } else {
        expect(title).toBe(r.requirement);
      }
    }
  });

  it('flags reverted and refused live items cleanly', () => {
    expect(isRefusedTx('intent signed by another proven key: reverted BadSignature')).toBe(true);
    expect(isRefusedTx('Q-Day attempt: the Pocket refused the call (code 14)')).toBe(true);
    expect(isRefusedTx('owner intent accepted (lazy deploy + spend)')).toBe(false);
    expect(TEST_COLLAPSE_THRESHOLD).toBeGreaterThanOrEqual(3);
  });
});

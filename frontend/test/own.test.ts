import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import own from '../src/data/own.json';

const repo = path.resolve(__dirname, '..', '..');
const ownSet = new Set(Object.values((own as { accounts: Record<string, string> }).accounts).map((a) => a.toLowerCase()));
const contracts = new Set([...fs.readFileSync(path.join(repo, 'contracts-v4/deployments/diana.json'), 'utf8').toLowerCase().matchAll(/0x[0-9a-f]{40}/g)].map((m) => m[0]));
contracts.add('0x' + '0'.repeat(40)); contracts.add('0x29f53b4b8031e7ba1785dc8c7a1c0be413a4bd97');

describe('own accounts', () => {
  it('every account in a recorded hybrid-lane QA run is listed as own, so team runs never count as outside use', () => {
    const dir = path.join(repo, 'frontend/evidence/v4/e2e');
    for (const f of fs.readdirSync(dir).filter((x) => x.startsWith('hybrid-') && x.endsWith('.json'))) {
      for (const [a] of fs.readFileSync(path.join(dir, f), 'utf8').toLowerCase().matchAll(/0x[0-9a-f]{40}/g)) {
        if (!contracts.has(a)) expect(ownSet.has(a), `${a} in ${f}`).toBe(true);
      }
    }
  });
  it('the frontend copy equals backend/config/own-accounts.json', () => {
    expect(JSON.parse(fs.readFileSync(path.join(repo, 'backend/config/own-accounts.json'), 'utf8'))).toEqual(own);
  });
  it('every account in the v5.2 first-run reconstruction is listed as own', () => {
    const ev = JSON.parse(fs.readFileSync(path.join(repo, 'frontend/evidence/v4/e2e/chromium-390-v52-first-run-2026-11-26.json'), 'utf8')) as {
      ownAccountKeys: Record<string, string>;
      runs: { id: string; accounts: Record<string, string> }[];
    };
    for (const [k, a] of Object.entries(ev.ownAccountKeys)) {
      expect(ownSet.has(a.toLowerCase()), `${k} ${a}`).toBe(true);
      expect((own as { accounts: Record<string, string> }).accounts[k].toLowerCase(), k).toBe(a.toLowerCase());
    }
    for (const run of ev.runs) {
      for (const [role, a] of Object.entries(run.accounts)) {
        expect(ownSet.has(a.toLowerCase()), `${run.id} ${role} ${a}`).toBe(true);
      }
    }
    // The demo-film takes (TEAM-RUN, 26 Nov 2026) are team accounts too.
    const film = JSON.parse(fs.readFileSync(path.join(repo, 'frontend/evidence/v4/video/film-2026-11-26.json'), 'utf8')) as {
      ownAccountKeys: Record<string, string>;
      takes: { id: string; accounts: Record<string, string> }[];
    };
    for (const [k, a] of Object.entries(film.ownAccountKeys)) expect(ownSet.has(a.toLowerCase()), `${k} ${a}`).toBe(true);
    for (const t of film.takes) for (const [role, a] of Object.entries(t.accounts)) expect(ownSet.has(a.toLowerCase()), `${t.id} ${role} ${a}`).toBe(true);
  });

  it('every account in the 19 Nov 2026 phone-spike evidence is listed as own', () => {
    const ev = JSON.parse(fs.readFileSync(path.join(repo, 'frontend/evidence/mobile/spike-2026-11-19.json'), 'utf8')) as {
      ownAccountKeys: Record<string, string>;
      runs: { id: string; account: string }[];
    };
    for (const [k, a] of Object.entries(ev.ownAccountKeys)) {
      expect(ownSet.has(a.toLowerCase()), `${k} ${a}`).toBe(true);
      expect((own as { accounts: Record<string, string> }).accounts[k].toLowerCase(), k).toBe(a.toLowerCase());
    }
    for (const run of ev.runs) expect(ownSet.has(run.account.toLowerCase()), `${run.id} ${run.account}`).toBe(true);
  });
});

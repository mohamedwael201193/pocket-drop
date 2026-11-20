// Runs the frontend and backend unit tests and records their counts in src/data/tests.json, so the app shows
// numbers taken from a real run (RECORDED), never typed by hand. Foundry counts come from contracts-v4/COVERAGE.md via sync-v4.
// Usage: node scripts/count-tests.mjs   (backend needs `npm ci` in ../backend first)
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
function run(dir) {
  const out = path.join(os.tmpdir(), `vitest-${path.basename(dir)}-${process.pid}.json`);
  try { execSync(`npx vitest run --reporter=json --outputFile=${out}`, { cwd: dir, stdio: 'ignore', env: { ...process.env, CI: '1' } }); } catch { /* counts below still say what failed */ }
  const r = JSON.parse(fs.readFileSync(out, 'utf8'));
  fs.rmSync(out, { force: true });
  return { passed: r.numPassedTests, failed: r.numFailedTests, skipped: r.numPendingTests + (r.numTodoTests ?? 0), total: r.numTotalTests };
}
const res = {
  recordedAt: new Date().toISOString(),
  command: 'node frontend/scripts/count-tests.mjs (npx vitest run in frontend/ and backend/)',
  frontend: run(path.resolve(here, '..')),
  backend: run(path.resolve(here, '..', '..', 'backend')),
};
fs.writeFileSync(path.resolve(here, '..', 'src', 'data', 'tests.json'), JSON.stringify(res, null, 1) + '\n');
console.log(res);

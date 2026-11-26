import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AUDIT_MATRIX } from '../src/data/auditMatrix';

const root = path.resolve(__dirname, '../..');
const tests = fs.readdirSync(path.join(root, 'contracts-v4/test')).filter((f) => f.endsWith('.sol')).map((f) => fs.readFileSync(path.join(root, 'contracts-v4/test', f), 'utf8')).join('\n');
const audit = fs.readFileSync(path.join(root, 'docs/AUDIT.md'), 'utf8');

describe('/judges audit matrix', () => {
  it('names real tests, real code lines, and the same tests as docs/AUDIT.md section 0', () => {
    const sec0 = audit.slice(audit.indexOf('## 0. One screen'), audit.indexOf('## 1. Reports'));
    for (const c of AUDIT_MATRIX) {
      expect(tests, c.test).toContain(`function ${c.test}(`);
      expect(sec0, c.test).toContain(c.test);
      const line = fs.readFileSync(path.join(root, 'contracts-v4/src', c.code.file), 'utf8').split('\n')[c.code.line - 1];
      expect(line, `${c.code.file}:${c.code.line}`).toMatch(/function |if \(spent > DAILY_DRIP_CAP\)/);
      expect(sec0).toContain(`${c.code.file}#L${c.code.line}`);
    }
  });
});

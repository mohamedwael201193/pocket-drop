import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import meta from '../src/data/cbom-meta.json';

describe('CBOM date on /proof', () => {
  it('matches the timestamp of the committed docs/cbom/cbom.json', () => {
    const bom = JSON.parse(fs.readFileSync(path.join(process.cwd(), '..', 'docs', 'cbom', 'cbom.json'), 'utf8')) as { metadata: { timestamp: string } };
    expect(meta.timestamp).toBe(bom.metadata.timestamp);
  });
});

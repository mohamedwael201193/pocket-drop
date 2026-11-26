import { describe, expect, it } from 'vitest';
describe('requirements test counts', () => {
  it('the Foundry count on /judges comes from v4.json, not a typed number', async () => {
    const { REQUIREMENTS } = await import('../src/data/requirements');
    const v4 = (await import('../src/data/v4.json')).default;
    const all = JSON.stringify(REQUIREMENTS);
    expect(all).toContain(`forge test (${v4.tests.total},`);
    expect(all).not.toContain('forge test (178');
  });
});

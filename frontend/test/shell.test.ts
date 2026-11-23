import { describe, expect, it } from 'vitest';
import { PROOF_ITEMS, TABS } from '../src/components/Layout';

describe('app shell navigation', () => {
  it('the primary navigation is exactly Send, Receive, Pocket, Proof', () => {
    expect(TABS.map((t) => t.label)).toEqual(['Send', 'Receive', 'Pocket', 'Proof']);
    expect(TABS.map((t) => t.to)).toEqual(['/send', '/receive', '/pocket', '/proof']);
  });
  it('every route belongs to at most one primary tab', () => {
    for (const p of ['/send', '/send/inbox', '/receive', '/c/p12', '/pool/p5', '/pocket', '/proof', '/', '/qday', '/check/0xab']) {
      expect(TABS.filter((t) => t.match(p)).length).toBeLessThanOrEqual(1);
    }
    expect(TABS.find((t) => t.match('/c/p12'))?.key).toBe('receive');
    expect(TABS.some((t) => t.match('/'))).toBe(false); // Overview is the dashboard home, not a fifth tab
  });
  it('the Proof pages listed on /proof all exist as routes in the shell', () => {
    expect(PROOF_ITEMS.map((p) => p.to)).toEqual(['/qday', '/lab', '/radar', '/check', '/judges']);
  });
});

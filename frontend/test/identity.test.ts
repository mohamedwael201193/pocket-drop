import { beforeEach, describe, expect, it } from 'vitest';

// minimal browser storage + window for the key helpers (vitest runs in node here)
const mem = new Map<string, string>();
const events: string[] = [];
Object.assign(globalThis, {
  localStorage: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) },
  window: { dispatchEvent: (e: Event) => { events.push(e.type); return true; } },
});
const { createRoot, importRoot, loadRoot, forgetRoot, ROOT_EVENT, ROOT_STORAGE_KEY } = await import('../src/lib/identity');

describe('B-01: the browser key is never silently replaced', () => {
  beforeEach(() => { mem.clear(); events.length = 0; });
  it('createRoot creates a key only when none exists', () => {
    const a = createRoot();
    expect(a).toMatch(/^pd2:[0-9a-f]{64}$/);
    expect(loadRoot()).toBe(a);
    expect(events).toContain(ROOT_EVENT);
  });
  it('createRoot returns the existing key (for example one a claim page created) instead of overwriting it', () => {
    const claimed = 'ab'.repeat(32);
    mem.set(ROOT_STORAGE_KEY, claimed);
    expect(createRoot()).toBe(claimed);
    expect(createRoot()).toBe(claimed);
    expect(mem.get(ROOT_STORAGE_KEY)).toBe(claimed);
  });
  it('importRoot refuses to replace a different key unless asked explicitly', () => {
    mem.set(ROOT_STORAGE_KEY, 'ab'.repeat(32));
    expect(() => importRoot('cd'.repeat(32))).toThrow(/already holds a different key/);
    expect(loadRoot()).toBe('ab'.repeat(32));
    expect(importRoot('ab'.repeat(32))).toBe('ab'.repeat(32));
    expect(importRoot('0x' + 'CD'.repeat(32), { replace: true })).toBe('cd'.repeat(32));
    expect(loadRoot()).toBe('cd'.repeat(32));
  });
  it('forgetRoot clears it and tells the app', () => {
    createRoot(); events.length = 0; forgetRoot();
    expect(loadRoot()).toBeNull();
    expect(events).toEqual([ROOT_EVENT]);
  });
});

describe('legacy key upgrade bookkeeping', () => {
  beforeEach(() => { mem.clear(); events.length = 0; });
  it('stores the next v2 key before any money moves, keeps it stable, and remembers the legacy key after the switch', async () => {
    const { pendingUpgradeRoot, finishUpgrade, legacyRoots } = await import('../src/lib/identity');
    const legacy = 'ab'.repeat(32);
    mem.set(ROOT_STORAGE_KEY, legacy);
    const next = pendingUpgradeRoot();
    expect(next).toMatch(/^pd2:[0-9a-f]{64}$/);
    expect(pendingUpgradeRoot()).toBe(next);
    expect(loadRoot()).toBe(legacy);
    expect(finishUpgrade(legacy)).toBe(next);
    expect(loadRoot()).toBe(next);
    expect(legacyRoots()).toEqual([legacy]);
    expect(importRoot(legacy, { replace: true })).toBe(legacy);
  });
  it('accepts a v2 backup and keeps old 64-hex backups working', () => {
    const v2 = 'pd2:' + '1f'.repeat(32);
    expect(importRoot(v2)).toBe(v2);
    expect(() => importRoot('pd2:' + 'zz'.repeat(32), { replace: true })).toThrow(/backup key/);
  });
});

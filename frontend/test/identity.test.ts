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
    expect(a).toMatch(/^[0-9a-f]{64}$/);
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

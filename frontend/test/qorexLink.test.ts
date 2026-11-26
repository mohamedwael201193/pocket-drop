import { describe, expect, it } from 'vitest';
import { browseProblem, qorexBrowseLink } from '../src/lib/qorexLink';

describe('Open in QoreX (documented browse link)', () => {
  it('a page without secrets gets the https link form', () => {
    expect(qorexBrowseLink('https://pocket-drop.vercel.app/receive')).toEqual({ href: 'https://link.qore.network/browse?url=https%3A%2F%2Fpocket-drop.vercel.app%2Freceive', form: 'https' });
  });
  it('a claim link with its #k= link key only gets the on-device qorex:// form, never the web host', () => {
    const l = qorexBrowseLink('https://pocket-drop.vercel.app/c/p12#k=abcdef');
    expect(l?.form).toBe('app');
    expect(l?.href.startsWith('qorex://browse?url=')).toBe(true);
    expect(l?.href).not.toContain('link.qore.network');
    expect(decodeURIComponent(l!.href.split('url=')[1])).toBe('https://pocket-drop.vercel.app/c/p12#k=abcdef');
  });
  it('refuses what QoreX refuses', () => {
    expect(browseProblem('http://pocket-drop.vercel.app/')).toMatch(/https/);
    expect(browseProblem('https://pocket-drop.vercel.app:8443/')).toMatch(/port/);
    expect(browseProblem('https://u:p@pocket-drop.vercel.app/')).toMatch(/user/);
    expect(browseProblem('https://127.0.0.1/')).toMatch(/IP/);
    expect(browseProblem('https://localhost/')).toMatch(/localhost/);
    expect(browseProblem('https://a.b/x y')).toMatch(/whitespace/);
    expect(browseProblem('https://a.b/' + 'x'.repeat(2050))).toMatch(/2048/);
    expect(qorexBrowseLink('http://localhost:5173/receive')).toBeNull();
  });
});

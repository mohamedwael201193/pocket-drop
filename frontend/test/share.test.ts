import { describe, expect, it } from 'vitest';
import sample from '../src/data/sample-pool.json';
import { baitShare, samplePoolShare, shareMessage, whatsappUrl } from '../src/lib/share';

describe('share texts', () => {
  it('the sample pool link carries its key and says testnet', () => {
    const s = samplePoolShare('https://pocketdrop-app.vercel.app', 3);
    expect(s.url).toBe(`https://pocketdrop-app.vercel.app${sample.path}`);
    expect(s.url).toMatch(/\/pool\/p\d+#k=[0-9a-f]{64}$/);
    expect(s.text).toContain('3 slots left');
    expect(s.text).toContain('testnet');
    expect(samplePoolShare('https://x', 1).text).toContain('1 slot left');
    expect(samplePoolShare('https://x', null).text).not.toContain('left');
  });
  it('the bait challenge points at /qday and names the check', () => {
    const b = baitShare('https://pocketdrop-app.vercel.app', 5);
    expect(b.url).toBe('https://pocketdrop-app.vercel.app/qday');
    expect(b.text).toMatch(/5 testnet Pockets .* ML-DSA-87/);
  });
  it('one-field apps get text and link in one message, URL-encoded for WhatsApp', () => {
    const b = baitShare('https://a.b');
    expect(shareMessage(b).endsWith(' https://a.b/qday')).toBe(true);
    expect(whatsappUrl(b)).toBe(`https://wa.me/?text=${encodeURIComponent(shareMessage(b))}`);
  });
  it('no hype words', () => {
    for (const t of [samplePoolShare('https://x', 2).text, baitShare('https://x').text]) expect(t).not.toMatch(/revolution|game.?chang|unbreakable|guaranteed|100%/i);
  });
});

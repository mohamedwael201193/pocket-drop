// WhatsApp survival checks that can be automated: the wa.me URL carries the FULL link and the #fragment round-trips.
import { describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { buildClaimUrl, parseClaimFragment, shareMessage, whatsappUrl, hexToBytes } from '../src/lib/protocol';

const seed = crypto.getRandomValues(new Uint8Array(32));
const link = buildClaimUrl('https://pocketdrop-app.vercel.app', 42n, seed);
const msg = shareMessage('0.3');

describe('wa.me URL', () => {
  const wa = whatsappUrl(msg, link);
  it('starts with the wa.me text endpoint and has no raw # or space (they are percent-encoded)', () => {
    expect(wa.startsWith('https://wa.me/?text=')).toBe(true);
    const q = wa.slice('https://wa.me/?text='.length);
    expect(q).not.toMatch(/[#\s]/);
    expect(q).toContain('%23k%3D'); // "#k=" encoded
  });
  it('decodes to exactly "<message> <link>" including the full fragment', () => {
    const text = decodeURIComponent(wa.slice('https://wa.me/?text='.length));
    expect(text).toBe(`${msg} ${link}`);
    const extracted = text.slice(text.lastIndexOf('https://'));
    expect(extracted).toBe(link);
    expect(new URL(extracted).hash).toBe(new URL(link).hash);
  });
  it('the seed recovered from the shared text equals the original seed (bit-exact)', () => {
    const text = decodeURIComponent(wa.slice('https://wa.me/?text='.length));
    const back = parseClaimFragment(new URL(text.slice(text.lastIndexOf('https://'))).hash)!;
    expect(Buffer.from(back).equals(Buffer.from(seed))).toBe(true);
    expect(hexToBytes(Buffer.from(seed).toString('hex'))).toEqual(seed);
  });
  it('the link is 1 line, ASCII-only and under 200 chars, so WhatsApp will not wrap or truncate it', () => {
    expect(link).toMatch(/^[\x21-\x7e]+$/);
    expect(link.length).toBeLessThan(200);
  });
});

describe('the fragment never reaches a server', () => {
  it('a plain HTTP client request for the link omits the #fragment (what a link-preview crawler would send)', async () => {
    const seen: string[] = [];
    const srv = createServer((req, res) => { seen.push(req.url ?? ''); res.end('ok'); });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    const port = (srv.address() as { port: number }).port;
    await fetch(`http://127.0.0.1:${port}/c/42#k=${Buffer.from(seed).toString('hex')}`);
    srv.close();
    expect(seen).toEqual(['/c/42']);
  });
});

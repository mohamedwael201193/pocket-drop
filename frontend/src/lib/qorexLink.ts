// "Open in QoreX" links, from the public QoreX dApp integration guide (https://docs.qorechain.io/qorex/dapp-integration,
// section "Open a page in the app: browse"):
//   https://link.qore.network/browse?url=<encodeURIComponent(https URL)>   (shows a get-the-app page when QoreX is missing)
//   qorex://browse?url=<encodeURIComponent(https URL)>                      (handled on the phone only)
// QoreX refuses a page with a port, a user name or password, an IP address, localhost, a backslash or whitespace, or more
// than 2048 characters, and it must be https on a domain name.
// A claim link carries its secret link key in the #fragment. Browsers never send a fragment to a server, but inside a
// ?url= query it WOULD reach link.qore.network, so a URL with a fragment only ever gets the on-device qorex:// form.

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/** Why QoreX would refuse this page URL, or null when it is acceptable. */
export function browseProblem(pageUrl: string): string | null {
  if (pageUrl.length > 2048) return 'longer than 2048 characters';
  if (/[\s\\]/.test(pageUrl)) return 'contains whitespace or a backslash';
  let u: URL;
  try { u = new URL(pageUrl); } catch { return 'not a URL'; }
  if (u.protocol !== 'https:') return 'not https';
  if (u.port) return 'has a port';
  if (u.username || u.password) return 'has a user name or password';
  const h = u.hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost')) return 'is localhost';
  if (IPV4.test(h) || h.startsWith('[')) return 'is an IP address';
  if (!h.includes('.')) return 'is not a domain name';
  return null;
}

/** The link that opens `pageUrl` in the QoreX app's dApp browser, or null when QoreX would refuse it. */
export function qorexBrowseLink(pageUrl: string): { href: string; form: 'https' | 'app' } | null {
  if (browseProblem(pageUrl)) return null;
  const q = encodeURIComponent(pageUrl);
  return pageUrl.includes('#') ? { href: `qorex://browse?url=${q}`, form: 'app' } : { href: `https://link.qore.network/browse?url=${q}`, form: 'https' };
}

/** True inside QoreX (extension or in-app browser), where the link is not needed. */
export const insideQorex = (): boolean => typeof window !== 'undefined' && !!(window as unknown as { qorex?: unknown }).qorex;

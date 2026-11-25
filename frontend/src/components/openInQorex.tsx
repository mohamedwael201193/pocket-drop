import { insideQorex, qorexBrowseLink } from '../lib/qorexLink';

/** "Open in QoreX" for the current page; hidden inside QoreX and when QoreX would refuse the address. */
export function OpenInQorex({ url, testId = 'open-in-qorex' }: { url?: string; testId?: string }) {
  if (typeof window === 'undefined' || insideQorex()) return null;
  const l = qorexBrowseLink(url ?? window.location.href);
  if (!l) return null;
  return (
    <p className="text-xs text-zinc-500" data-testid={testId} data-form={l.form}>
      Have the QoreX app on this phone? <a className="font-medium text-zinc-800 underline" href={l.href}>Open this page in QoreX</a>.
      {l.form === 'app' ? ' The link key stays on this phone: the app link is never sent to a server.' : ''} Pocket Drop runs on Diana testnet; QoreX needs testnet mode.
    </p>
  );
}

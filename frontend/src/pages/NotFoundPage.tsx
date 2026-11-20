import { Link, useLocation } from 'react-router-dom';
import { Page, PageTitle } from '../components/ui';

/** Unknown path: say so, instead of silently showing the landing page (B-14). */
export default function NotFoundPage() {
  const { pathname } = useLocation();
  return (
    <Page narrow testId="not-found">
      <div className="space-y-4">
        <PageTitle eyebrow="Not found" title="Page not found" />
        <p className="text-sm leading-relaxed text-zinc-700">There is nothing at <code className="break-all font-mono text-xs">{pathname}</code>. If someone sent you a Pocket Drop link, paste it on the Receive page.</p>
        <div className="flex flex-wrap gap-2 text-sm">
          <Link to="/receive" className="inline-flex min-h-[44px] items-center rounded-full bg-accent px-5 font-medium text-stone-50 hover:bg-accentHover">Paste a link</Link>
          <Link to="/" className="inline-flex min-h-[44px] items-center rounded-full border border-zinc-300 bg-white px-5 font-medium text-zinc-900">Home</Link>
        </div>
      </div>
    </Page>
  );
}

import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { Page, PageTitle, SourceBadge } from '../components/ui';
import { PROOF_ITEMS } from '../components/Layout';

const KIND: Record<string, 'LIVE' | 'RECORDED'> = { '/lab': 'RECORDED', '/radar': 'LIVE', '/judges': 'RECORDED' };

export default function ProofPage() {
  return (
    <Page narrow testId="proof-page">
      <PageTitle eyebrow="Proof" title="Check our claims">Every number here is labelled LIVE (read from the chain just now) or RECORDED (a mined transaction or file you can open).</PageTitle>
      <ul className="space-y-3">
        {PROOF_ITEMS.map(({ to, label, sub, Icon }) => (
          <li key={to}>
            <Link to={to} data-testid={`proof-card-${label.toLowerCase()}`} className="flex items-center gap-4 rounded-3xl border border-zinc-200 bg-white/90 p-5 shadow-sm hover:bg-stoneBg">
              <span className="flex h-11 w-11 items-center justify-center rounded-full border border-zinc-200 bg-stoneBg"><Icon className="h-5 w-5" aria-hidden /></span>
              <span className="min-w-0 flex-1"><span className="block font-serif text-2xl text-zinc-900">{label}</span><span className="block text-sm text-zinc-600">{sub}</span></span>
              <SourceBadge kind={KIND[to]} /><ArrowRight className="h-4 w-4 text-zinc-400" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </Page>
  );
}

import { motion } from 'framer-motion';
import { MessageCircle, Share2 } from 'lucide-react';
import { CopyButton } from './ui';
import { shareMessage, whatsappUrl } from '../lib/protocol';

/** Share sheet for a v4 drop or pool link. The key is in the #fragment, which browsers never send to a server. */
export function ShareCard({ url, amountText, headline, kind = 'drop', id }: { url: string; amountText: string; headline: string; kind?: 'drop' | 'pool'; id: string }) {
  const msg = kind === 'pool' ? `There are testnet QOR slots for the first accounts to open this link (${amountText} each):` : shareMessage(amountText);
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-3 rounded-2xl border border-zinc-300 bg-stoneBg p-4" data-testid="share-card">
      <span className="flex items-center gap-1.5 text-sm font-semibold text-zinc-900"><Share2 className="h-4 w-4" aria-hidden />{headline}</span>
      <div className="break-all rounded-xl border border-zinc-200 bg-white p-3 font-mono text-xs text-zinc-800" data-testid="claim-link" data-url={url}>{url}</div>
      <div className="flex flex-wrap gap-2">
        <a href={whatsappUrl(msg, url)} target="_blank" rel="noopener noreferrer" data-testid="whatsapp"
          className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-full bg-emerald-600 px-5 text-sm font-medium text-white hover:bg-emerald-700"><MessageCircle className="h-4 w-4" aria-hidden />Send on WhatsApp</a>
        {canShare && <button type="button" data-testid="web-share" onClick={() => navigator.share({ title: 'Pocket Drop', text: msg, url }).catch(() => undefined)} className="min-h-[44px] rounded-full border border-zinc-300 bg-white px-5 text-sm font-medium text-zinc-900">Share…</button>}
        <CopyButton text={url} label="Copy link" testId="copy-link" className="!min-h-[44px]" />
      </div>
      <p className="text-xs text-zinc-600">{kind === 'pool' ? 'Pool' : 'Link'} {id}. {kind === 'pool' ? 'Anyone with this link can take a slot with a distinct proven account, until all slots are taken.' : 'Treat it like cash: whoever opens it first becomes the recipient. Confirmed mode lets you check them first.'} The key is after the # and never reaches a server.</p>
    </motion.div>
  );
}

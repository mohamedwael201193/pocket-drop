import { useState } from 'react';
import { MessageCircle } from './icons';
import { Button, CopyButton } from './ui';
import { Qr } from './qr';
import { shareMessage, whatsappUrl, type ShareSpec } from '../lib/share';

/** One tap to pass a link on: the phone's share sheet, copy, WhatsApp, or a QR to scan. The app never posts anything itself. */
export function SharePanel({ spec, testId, label = 'Share' }: { spec: ShareSpec; testId: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  return (
    <div className="mt-3" data-testid={testId}>
      <Button type="button" variant="secondary" className="min-h-[44px] px-4" aria-expanded={open} onClick={() => setOpen((v) => !v)} data-testid={`${testId}-toggle`}>{open ? 'Hide sharing' : label}</Button>
      {open && (
        <div className="mt-3 space-y-3 rounded-2xl border border-zinc-200 bg-white p-4" data-testid={`${testId}-panel`}>
          <p className="text-sm text-zinc-700" data-testid={`${testId}-text`}>{spec.text}</p>
          <p className="break-all font-mono text-xs text-zinc-500" data-testid={`${testId}-url`}>{spec.url}</p>
          <div className="flex flex-wrap gap-2">
            {canShare && <Button type="button" onClick={() => navigator.share({ title: spec.title, text: spec.text, url: spec.url }).catch(() => undefined)} data-testid={`${testId}-native`}>Share…</Button>}
            <CopyButton text={shareMessage(spec)} label="Copy message" testId={`${testId}-copy`} />
            <a href={whatsappUrl(spec)} target="_blank" rel="noopener noreferrer" data-testid={`${testId}-whatsapp`}
              className="inline-flex min-h-[40px] items-center gap-2 rounded-full bg-emerald-600 px-4 text-sm font-medium text-white hover:bg-emerald-700"><MessageCircle className="h-4 w-4" aria-hidden />WhatsApp</a>
          </div>
          <Qr text={spec.url} alt={`QR code of ${spec.url}`} testId={`${testId}-qr`} />
          <p className="text-xs text-zinc-500">Nothing is sent until you pick an app. Testnet only.</p>
        </div>
      )}
    </div>
  );
}

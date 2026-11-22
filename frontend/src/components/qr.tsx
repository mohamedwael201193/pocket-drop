import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

/** A QR code drawn in the browser (no network call). */
export function Qr({ text, alt = 'QR code of the address', testId = 'address-qr' }: { text: string; alt?: string; testId?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => { void QRCode.toDataURL(text, { margin: 1, width: 220, errorCorrectionLevel: 'M' }).then(setUrl).catch(() => setUrl(null)); }, [text]);
  return url
    ? <img src={url} alt={alt} width={176} height={176} className="rounded-xl border border-zinc-200 bg-white p-2" data-testid={testId} />
    : <div className="h-[176px] w-[176px] rounded-xl border border-zinc-200" />;
}

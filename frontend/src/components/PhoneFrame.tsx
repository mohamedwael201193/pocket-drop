import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';

/** The design's phone mock: a bordered handset from sm up, an edge-to-edge sheet on a real phone. */
export function PhoneFrame({ children, testId }: { children: ReactNode; testId?: string }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 15_000); return () => clearInterval(t); }, []);
  return (
    <div data-testid={testId} className="w-full max-w-[375px] overflow-hidden rounded-3xl border border-zinc-200 bg-stoneBg shadow-xl sm:rounded-[2.6rem] sm:border-[8px] sm:border-zinc-900 sm:shadow-2xl">
      <div className="hidden items-center justify-between bg-zinc-900 px-6 py-2 font-mono text-[10px] text-stone-300 sm:flex">
        <span>{now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span><span className="h-3.5 w-16 rounded-full bg-black" /><span>Diana 9800</span>
      </div>
      <div className="space-y-4 p-5">{children}</div>
    </div>
  );
}

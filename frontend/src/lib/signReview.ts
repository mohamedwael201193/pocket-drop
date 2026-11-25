// Clear signing in the app: every owner intent is shown to the user, in plain words, before the browser signs it.
// actions.owner() builds the readable summary with describeIntent() from the SAME fields that make the digest, checks the
// two digests are equal, and waits here for the user's answer. With no review host mounted (unit tests, scripts) it approves.
import type { ClearIntent } from './clearsign';

export interface ReviewRequest { clear: ClearIntent; resolve: (ok: boolean) => void }
type Host = (r: ReviewRequest) => void;
let host: Host | null = null;

/** The app shell mounts one host; returns the unmount function. */
export function setReviewHost(h: Host): () => void {
  host = h;
  return () => { if (host === h) host = null; };
}

export class SignCancelled extends Error {
  constructor() { super('You cancelled. Nothing was signed or sent.'); this.name = 'SignCancelled'; }
}
export const isCancelled = (e: unknown) => e instanceof SignCancelled || (e instanceof Error && e.name === 'SignCancelled');

/** Ask the user to approve this exact intent. Resolves true (sign) or false (cancel). */
export function reviewIntent(clear: ClearIntent): Promise<boolean> {
  const h = host;
  if (!h) return Promise.resolve(true);
  return new Promise((resolve) => h({ clear, resolve }));
}

/** One document title per route, so tabs, history and shared previews say where you are. */
const BRAND = 'Pocket Drop';
export function titleFor(p: string): string {
  const t: [RegExp, string][] = [
    [/^\/$/, 'Send QOR by link, guarded by ML-DSA-87'], [/^\/app$/, 'Overview'], [/^\/about/, 'Send QOR by link, guarded by ML-DSA-87'], [/^\/send\/inbox/, 'Your links'], [/^\/send/, 'Send QOR by link'],
    [/^\/receive/, 'Receive'], [/^\/c\//, 'Open your drop'], [/^\/pool(\/|$)/, 'Drop Pool'], [/^\/pocket/, 'Your Pocket'],
    [/^\/proof\/testers/, 'Outside testers'], [/^\/proof/, 'Proof'], [/^\/qday/, 'Q-Day Drill'], [/^\/lab/, 'Lab: attacks the chain refused'], [/^\/radar/, 'Radar'], [/^\/judges/, 'Judges checklist'], [/^\/check/, 'Check a transaction'],
  ];
  const hit = t.find(([r]) => r.test(p));
  return hit ? `${hit[1]} · ${BRAND}` : `Page not found · ${BRAND}`;
}

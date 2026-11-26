/** Last run of the warm-up job (.github/workflows/warm-stats.yml), read from the public GitHub Actions API.
 *  Cached per instance for 10 minutes (the job runs every 10 minutes), so /api/health adds at most one GitHub call per
 *  instance per 10 minutes. On any error the answer says so; it never guesses a time. */
export const WARMUP_RUNS_URL = 'https://api.github.com/repos/mohamedwael201193/pocket-drop/actions/workflows/warm-stats.yml/runs?per_page=1&status=completed';
export interface WarmUp { job: string; lastRunAt: string | null; conclusion: string | null; url: string | null; error?: string }

let cache: { at: number; value: WarmUp } | null = null;
export const resetWarmUpCache = () => { cache = null; };

export async function lastWarmUp(f: typeof fetch = fetch, now: () => number = Date.now, ttlMs = 600_000): Promise<WarmUp> {
  if (cache && now() - cache.at < ttlMs) return cache.value;
  const base = { job: '.github/workflows/warm-stats.yml (every 10 min: /api/stats, /api/qday, /api/health)' };
  let value: WarmUp;
  try {
    const r = await f(WARMUP_RUNS_URL, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'pocket-drop-api' }, signal: AbortSignal.timeout(4_000) });
    if (!r.ok) value = { ...base, lastRunAt: null, conclusion: null, url: null, error: `github ${r.status}` };
    else {
      const j = (await r.json()) as { workflow_runs?: { updated_at?: string; conclusion?: string; html_url?: string }[] };
      const run = j.workflow_runs?.[0];
      value = run ? { ...base, lastRunAt: run.updated_at ?? null, conclusion: run.conclusion ?? null, url: run.html_url ?? null } : { ...base, lastRunAt: null, conclusion: null, url: null, error: 'no completed run' };
    }
  } catch (e) {
    value = { ...base, lastRunAt: null, conclusion: null, url: null, error: e instanceof Error ? e.message : String(e) };
  }
  // errors are cached for 1 minute only, so a GitHub hiccup does not hide the answer for 10
  cache = { at: value.error ? now() - ttlMs + 60_000 : now(), value };
  return value;
}

/** A browser-level fetch failure (offline, CORS on an error response, aborted), as opposed to an RPC or contract error.
 *  Dependency-free so the entry chunk (main.tsx) can use it without pulling in viem. */
export const isNetworkFailure = (e: unknown): boolean => {
  const m = String((e as { message?: string })?.message ?? e);
  return /Failed to fetch|Load failed|NetworkError|access control checks|HTTP request failed|fetch failed|The network connection was lost/i.test(m);
};

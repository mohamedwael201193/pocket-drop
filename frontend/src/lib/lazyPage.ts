import { lazy, type ComponentType } from 'react';

const FLAG = 'pd.chunk-reload';
// A navigation away aborts in-flight chunk loads; that is not a stale build, so never reload over it.
let leaving = false;
if (typeof window !== 'undefined') {
  const mark = () => { leaving = true; };
  window.addEventListener('beforeunload', mark);
  window.addEventListener('pagehide', mark);
  window.addEventListener('pageshow', () => { leaving = false; });
}
const never = <T,>() => new Promise<T>(() => undefined);
/** React.lazy that survives a redeploy: if a page chunk of the old build is gone ("Importing a module script failed",
 *  "Failed to fetch dynamically imported module"), reload once to get the new build instead of a blank page. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyPage<T extends ComponentType<any>>(load: () => Promise<{ default: T }>) {
  return lazy(async () => {
    try {
      const m = await load();
      try { sessionStorage.removeItem(FLAG); } catch { /* ignore */ }
      return m;
    } catch (e) {
      await new Promise((r) => setTimeout(r, 250));
      if (leaving) return never<{ default: T }>();
      let reloaded = false;
      try { reloaded = sessionStorage.getItem(FLAG) === '1'; sessionStorage.setItem(FLAG, '1'); } catch { /* ignore */ }
      if (!reloaded) { window.location.reload(); return never<{ default: T }>(); }
      throw e;
    }
  });
}

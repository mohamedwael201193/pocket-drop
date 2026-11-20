import { lazy, type ComponentType } from 'react';

const FLAG = 'pd.chunk-reload';
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
      let reloaded = false;
      try { reloaded = sessionStorage.getItem(FLAG) === '1'; sessionStorage.setItem(FLAG, '1'); } catch { /* ignore */ }
      if (!reloaded) { window.location.reload(); return new Promise<{ default: T }>(() => undefined); }
      throw e;
    }
  });
}

import { lazy } from "react";

/** Chunk loader with one automatic reload when a stale deploy makes a chunk 404. */
export function lazyRetry<T extends { default: any }>(
  loader: () => Promise<T>,
): Promise<T> {
  return loader().catch((err) => {
    const key = "chunk_reload_attempted";
    const attempted = sessionStorage.getItem(key);
    if (!attempted) {
      sessionStorage.setItem(key, "1");
      window.location.reload();
      return new Promise(() => {});
    }
    sessionStorage.removeItem(key);
    throw err;
  });
}

/** React.lazy for a NAMED export, with the same chunk-retry as the pages. */
export function lazyNamed<M extends Record<string, any>, K extends keyof M>(load: () => Promise<M>, name: K) {
  return lazy(() => lazyRetry(() => load().then(m => ({ default: m[name] as React.ComponentType<any> }))));
}

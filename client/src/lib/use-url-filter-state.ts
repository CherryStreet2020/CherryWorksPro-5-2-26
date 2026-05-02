import { useCallback, useMemo, useRef } from "react";
import { useSearch } from "wouter";

type FilterValue = string;
type FilterMap = Record<string, FilterValue>;

interface SetOptions {
  replace?: boolean;
}

export function useUrlFilterState<T extends FilterMap>(
  defaults: T,
): readonly [
  T,
  <K extends keyof T>(key: K, value: T[K], options?: SetOptions) => void,
  (patch: Partial<T>, options?: SetOptions) => void,
] {
  const search = useSearch();
  const defaultsRef = useRef(defaults);

  const filters = useMemo(() => {
    const params = new URLSearchParams(search);
    const next = { ...defaultsRef.current } as T;
    for (const k of Object.keys(defaultsRef.current)) {
      const v = params.get(k);
      if (v !== null) (next as Record<string, FilterValue>)[k] = v;
    }
    return next;
  }, [search]);

  const writeUrl = useCallback((patch: Partial<T>, options?: SetOptions) => {
    const params = new URLSearchParams(window.location.search);
    for (const k of Object.keys(patch)) {
      const value = (patch as Record<string, FilterValue | undefined>)[k];
      const def = (defaultsRef.current as Record<string, FilterValue>)[k];
      if (value === undefined || value === null || value === "" || value === def) {
        params.delete(k);
      } else {
        params.set(k, String(value));
      }
    }
    const qs = params.toString();
    const newUrl = window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash;
    const currentUrl = window.location.pathname + window.location.search + window.location.hash;
    if (newUrl === currentUrl) return;
    if (options?.replace) {
      window.history.replaceState(null, "", newUrl);
    } else {
      window.history.pushState(null, "", newUrl);
    }
  }, []);

  const setFilter = useCallback(
    <K extends keyof T>(key: K, value: T[K], options?: SetOptions) => {
      writeUrl({ [key]: value } as unknown as Partial<T>, options);
    },
    [writeUrl],
  );

  const setFilters = useCallback(
    (patch: Partial<T>, options?: SetOptions) => {
      writeUrl(patch, options);
    },
    [writeUrl],
  );

  return [filters, setFilter, setFilters] as const;
}

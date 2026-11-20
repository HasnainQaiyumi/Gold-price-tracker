import { useCallback, useState } from 'react';

/**
 * useState persisted in localStorage. Stored data is untrusted: it passes through `sanitize`
 * on load, and any failure falls back to the initial value. Storage errors never throw.
 */
export function useLocalStorage<T>(
  key: string,
  initial: T,
  sanitize: (raw: unknown) => T = (raw) => raw as T
): [T, (v: T | ((p: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? sanitize(JSON.parse(raw)) : initial;
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (v: T | ((p: T) => T)) => {
      setValue((prev) => {
        const next = typeof v === 'function' ? (v as (p: T) => T)(prev) : v;
        try {
          localStorage.setItem(key, JSON.stringify(next));
        } catch {
          /* storage unavailable */
        }
        return next;
      });
    },
    [key]
  );
  return [value, set];
}

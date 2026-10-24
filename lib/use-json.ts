"use client";

/**
 * @fileoverview Minimal data-fetching hook for client pages.
 *
 * @description
 * The app needs "load JSON, show a spinner, show an error, refetch after a
 * mutation" on a dozen pages. Rather than pull a data library into the bundle,
 * this hook wraps `fetch` + React state with three guarantees:
 *
 *  - **Stale responses are ignored** (an older request resolving after a newer
 *    one cannot overwrite fresher data).
 *  - **Errors are user-readable** via the shared `{ error: { message }`
 *    envelope from `server/errors.ts`.
 *  - **Refetch is explicit** so pages can reload after a mutation without a
 *    full navigation.
 *
 * @implementation
 *
 * Step 1: Keep `data`, `error`, `loading` and a request counter in state.
 * Step 2: On mount (and when `url`/`deps` change), fetch and parse JSON.
 * Step 3: Ignore results from superseded requests.
 * Step 4: Map failures to the server's error message, else a status fallback.
 * Step 5: Expose `reload` for post-mutation refreshes.
 * Step 6: An aborted/unmounted component must not set state (no leaks).
 *
 * @author HMS team
 * @version 1.0.0
 * @since 2026-10-24
 */

import { useCallback, useEffect, useRef, useState } from "react";

/** Shape returned by {@link useJson}. */
export type JsonState<T> = {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
};

/**
 * Fetches JSON from a URL and keeps it in component state.
 *
 * @param url Endpoint to GET; `null` skips fetching (useful for conditional loads).
 * @param deps Extra values that should trigger a refetch.
 * @returns `{ data, error, loading, reload }`.
 */
export function useJson<T>(
  url: string | null,
  deps: unknown[] = [],
): JsonState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(url));
  const [nonce, setNonce] = useState(0);
  const requestId = useRef(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    // `url === null` means "no request": don't touch state synchronously here
    // (that would cause a cascading render). The returned values are derived
    // below instead.
    if (!url) return;

    const id = ++requestId.current;
    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        const res = await fetch(url);
        const body = await res.json().catch(() => null);
        if (cancelled || id !== requestId.current) return;
        if (!res.ok) {
          setError(body?.error?.message ?? `Request failed (${res.status})`);
          setData(null);
        } else {
          setError(null);
          setData(body as T);
        }
      } catch (e) {
        if (cancelled || id !== requestId.current) return;
        setError(e instanceof Error ? e.message : "Network error");
      } finally {
        if (!cancelled && id === requestId.current) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deps are caller-supplied
  }, [url, nonce, ...deps]);

  // With no URL there is nothing to load — report that without a state write.
  if (!url) return { data: null, error: null, loading: false, reload };

  return { data, error, loading, reload };
}

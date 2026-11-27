import { useCallback, useEffect, useState } from "react";

export type ResourceOptions = {
  /** Keep the last loaded value while reloading and after a failed reload. Default: clear it. */
  keepStale?: boolean;
};

export type Resource<T> = {
  data: T | undefined;
  /** Failure message of the latest load; undefined while loading or after success. */
  error: string | undefined;
  loading: boolean;
  /** Bumped by `reload`; key children on it to reset their state per load. */
  revision: number;
  reload(): void;
};

type State<T> = Pick<Resource<T>, "data" | "error" | "loading">;

/** Turn a rejection reason into a non-empty message. */
export function errorMessage(reason: unknown): string {
  const message = reason instanceof Error ? reason.message : String(reason);
  return message || "Unknown error";
}

/**
 * Load `load()` on mount, whenever `load` changes identity, and on `reload()`.
 * Responses from superseded or unmounted loads are ignored.
 * Memoize `load` with `useCallback` so its dependencies decide when to refetch.
 */
export function useResource<T>(load: () => Promise<T>, { keepStale = false }: ResourceOptions = {}): Resource<T> {
  const [state, setState] = useState<State<T>>({ data: undefined, error: undefined, loading: true });
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((value) => value + 1), []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: revision intentionally triggers an explicit reload.
  useEffect(() => {
    let current = true;
    setState((prev) => ({ data: keepStale ? prev.data : undefined, error: undefined, loading: true }));
    load().then(
      (data) => {
        if (current) setState({ data, error: undefined, loading: false });
      },
      (reason: unknown) => {
        if (current)
          setState((prev) => ({
            data: keepStale ? prev.data : undefined,
            error: errorMessage(reason),
            loading: false,
          }));
      },
    );
    return () => {
      current = false;
    };
  }, [load, keepStale, revision]);

  return { ...state, revision, reload };
}

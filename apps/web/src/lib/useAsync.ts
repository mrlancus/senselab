import { useCallback, useEffect, useMemo, useState } from 'react';

/**
 * Minimal data loader: runs `fn` when `key` changes; `reload()` re-runs it. `loading` is
 * derived from whether the latest request has settled, so no state is set synchronously
 * inside the effect.
 */
export function useAsync<T>(fn: () => Promise<T>, key: string) {
  const [tick, setTick] = useState(0);
  // A fresh identity per (key, reload) marks which request the state belongs to.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const request = useMemo(() => ({}), [key, tick]);
  const [state, setState] = useState<{ data: T | null; error: string | null; for: object | null }>({
    data: null,
    error: null,
    for: null,
  });
  useEffect(() => {
    let alive = true;
    fn().then(
      (data) => alive && setState({ data, error: null, for: request }),
      (e: unknown) =>
        alive &&
        setState((s) => ({
          data: s.data,
          error: e instanceof Error ? e.message : String(e),
          for: request,
        })),
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  const setData = useCallback((data: T) => setState((s) => ({ ...s, data })), []);
  return { data: state.data, error: state.error, loading: state.for !== request, reload, setData };
}

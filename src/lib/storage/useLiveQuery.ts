import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { dataEvents } from './repositories';

export type QueryState<T> =
  | { status: 'loading'; data: undefined; error: null }
  | { status: 'ready'; data: T; error: null }
  | { status: 'error'; data: undefined; error: Error };

/**
 * Runs an async storage query and re-runs it whenever stored data changes.
 * Returns explicit loading / ready / error states so every screen can render
 * a real loading and failure state instead of spinning forever.
 */
export function useLiveQuery<T>(query: () => Promise<T>, deps: unknown[] = []): QueryState<T> & { reload: () => void } {
  const [state, setState] = useState<QueryState<T>>({ status: 'loading', data: undefined, error: null });
  const queryRef = useRef(query);
  useLayoutEffect(() => {
    queryRef.current = query;
  });
  const runId = useRef(0);

  const run = useCallback(() => {
    const id = ++runId.current;
    queryRef
      .current()
      .then((data) => {
        if (id === runId.current) setState({ status: 'ready', data, error: null });
      })
      .catch((err: unknown) => {
        if (id === runId.current) setState({ status: 'error', data: undefined, error: err instanceof Error ? err : new Error(String(err)) });
      });
  }, []);

  useEffect(() => {
    run();
    const onChange = () => run();
    dataEvents.addEventListener('change', onChange);
    return () => dataEvents.removeEventListener('change', onChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { ...state, reload: run };
}

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Channel, ChannelInput, ChannelOutput } from '@shared/ipc/contract';
import type { AppError, Result } from '@shared/ipc/result';

/** Typed call into the main process. Never throws; transport failures become INTERNAL errors. */
export async function call<C extends Channel>(
  channel: C,
  input: ChannelInput<C>,
): Promise<Result<ChannelOutput<C>>> {
  try {
    return await window.clubhouse.invoke(channel, input);
  } catch (err) {
    return {
      ok: false,
      error: { code: 'INTERNAL', message: err instanceof Error ? err.message : 'Bridge unavailable' },
    };
  }
}

export type QueryState<T> =
  | { status: 'loading' }
  | { status: 'error'; error: AppError }
  | { status: 'empty'; data: T }
  | { status: 'ready'; data: T };

export interface QueryOptions<T> {
  /** Decides when a successful response should render as an empty state. */
  isEmpty?: (data: T) => boolean;
}

/**
 * Runs a channel call and exposes it as loading / empty / error / ready,
 * the four states every module view handles explicitly.
 */
export function useQuery<C extends Channel>(
  channel: C,
  input: ChannelInput<C>,
  options: QueryOptions<ChannelOutput<C>> = {},
): QueryState<ChannelOutput<C>> & { reload: () => void } {
  const [state, setState] = useState<QueryState<ChannelOutput<C>>>({ status: 'loading' });
  const [tick, setTick] = useState(0);
  const key = JSON.stringify(input);
  const isEmptyRef = useRef(options.isEmpty);
  isEmptyRef.current = options.isEmpty;

  useEffect(() => {
    let live = true;
    setState({ status: 'loading' });
    void call(channel, JSON.parse(key) as ChannelInput<C>).then((res) => {
      if (!live) return;
      if (!res.ok) setState({ status: 'error', error: res.error });
      else if (isEmptyRef.current?.(res.data)) setState({ status: 'empty', data: res.data });
      else setState({ status: 'ready', data: res.data });
    });
    return () => {
      live = false;
    };
  }, [channel, key, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}

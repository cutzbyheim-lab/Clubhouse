import { useCallback, useEffect, useRef, useState } from 'react';
import type { Channel, ChannelInput, ChannelOutput } from '@shared/ipc/contract';
import type { AppError, Result } from '@shared/ipc/result';
import { useDataVersion } from '@/stores/dataVersion';
import { toast } from '@/stores/toasts';

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

/** A write: on success every open query refetches, and `done` (if given) is confirmed in a toast. */
export async function mutate<C extends Channel>(
  channel: C,
  input: ChannelInput<C>,
  opts: { done?: string | ((data: ChannelOutput<C>) => string) } = {},
): Promise<Result<ChannelOutput<C>>> {
  const res = await call(channel, input);
  if (res.ok) {
    useDataVersion.getState().bump();
    if (opts.done) toast(typeof opts.done === 'function' ? opts.done(res.data) : opts.done);
  }
  return res;
}

export type QueryState<T> =
  | { status: 'loading' }
  | { status: 'error'; error: AppError }
  | { status: 'empty'; data: T }
  | { status: 'ready'; data: T };

export interface QueryOptions<T> {
  /** Decides when a successful response should render as an empty state. */
  isEmpty?: (data: T) => boolean;
  /** Skip the call (e.g. until a selection exists). */
  enabled?: boolean;
}

/**
 * Runs a channel call and exposes it as loading / empty / error / ready,
 * the four states every module view handles explicitly. Refetches whenever
 * any write bumps the data version. Keeps showing the previous data while a
 * refetch is in flight so screens don't flash.
 */
export function useQuery<C extends Channel>(
  channel: C,
  input: ChannelInput<C>,
  options: QueryOptions<ChannelOutput<C>> = {},
): QueryState<ChannelOutput<C>> & { reload: () => void } {
  const [state, setState] = useState<QueryState<ChannelOutput<C>>>({ status: 'loading' });
  const [tick, setTick] = useState(0);
  const version = useDataVersion((s) => s.version);
  const key = JSON.stringify(input);
  const isEmptyRef = useRef(options.isEmpty);
  isEmptyRef.current = options.isEmpty;
  const enabled = options.enabled ?? true;
  const lastKey = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    // Only show the loading state when the question changed, not on a background refresh.
    if (lastKey.current !== key) setState({ status: 'loading' });
    lastKey.current = key;
    void call(channel, JSON.parse(key) as ChannelInput<C>).then((res) => {
      if (!live) return;
      if (!res.ok) setState({ status: 'error', error: res.error });
      else if (isEmptyRef.current?.(res.data)) setState({ status: 'empty', data: res.data });
      else setState({ status: 'ready', data: res.data });
    });
    return () => {
      live = false;
    };
  }, [channel, key, tick, version, enabled]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}

/** Renders the right state view; children get data only when ready. */
export function hasData<T>(q: QueryState<T>): q is { status: 'ready'; data: T } | { status: 'empty'; data: T } {
  return q.status === 'ready' || q.status === 'empty';
}

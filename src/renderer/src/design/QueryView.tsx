import type { ReactNode } from 'react';
import type { QueryState } from '@/lib/api';
import { Panel } from './Page';
import { EmptyState, ErrorState, LoadingState } from './StateViews';

/** One place that turns a query into its loading / error / empty / ready view. */
export function QueryView<T>({
  q,
  label,
  empty,
  onRetry,
  children,
}: {
  q: QueryState<T>;
  label: string;
  empty?: { title: string; body: ReactNode; action?: ReactNode };
  onRetry?: () => void;
  children: (data: T) => ReactNode;
}) {
  if (q.status === 'loading') return <LoadingState label={label} />;
  if (q.status === 'error') return <ErrorState error={q.error} {...(onRetry ? { onRetry } : {})} />;
  if (q.status === 'empty' && empty) {
    return (
      <Panel>
        <EmptyState title={empty.title} action={empty.action}>
          {empty.body}
        </EmptyState>
      </Panel>
    );
  }
  return <>{children(q.data)}</>;
}

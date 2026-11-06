import { isRouteErrorResponse, useRouteError } from 'react-router';
import { ErrorState } from '@/design/StateViews';

/** Catches render-time crashes inside a module so the rest of the app stays usable. */
export function RouteError() {
  const err = useRouteError();
  const message = isRouteErrorResponse(err)
    ? `${err.status} ${err.statusText}`
    : err instanceof Error
      ? err.message
      : 'This screen failed to load';
  return (
    <ErrorState error={{ code: 'INTERNAL', message }} onRetry={() => window.location.reload()} />
  );
}

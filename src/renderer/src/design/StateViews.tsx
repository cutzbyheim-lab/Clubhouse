import type { ReactNode } from 'react';
import type { AppError } from '@shared/ipc/result';

const ERROR_GUIDANCE: Record<AppError['code'], string> = {
  VALIDATION: 'Check the highlighted values and try again.',
  NOT_FOUND: 'It may have been deleted. Go back and pick another.',
  CONFLICT: 'Something with the same details already exists.',
  DATABASE: 'Your data file could not be read or written. Your existing data has not been changed.',
  UNAVAILABLE: 'Nothing on your computer changed. Check your connection and try again.',
  INTERNAL: 'Try again. If it keeps happening, restart Clubhouse.',
};

export function LoadingState({ label }: { label: string }) {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-3 p-6">
      <span className="sr-only">{label}</span>
      {[72, 54, 64].map((w) => (
        <div
          key={w}
          className="h-3 animate-pulse rounded-full bg-raised"
          style={{ width: `${w}%` }}
          aria-hidden
        />
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex max-w-[52ch] flex-col items-start gap-2 px-6 py-10">
      <h3 className="figures text-xl font-semibold text-ink">{title}</h3>
      <div className="text-ink-muted">{children}</div>
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: AppError; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex max-w-[60ch] flex-col items-start gap-2 px-6 py-8">
      <h3 className="figures text-lg font-semibold text-hazard">{error.message}</h3>
      <p className="text-ink-muted">{ERROR_GUIDANCE[error.code]}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 rounded-control border border-rule-strong px-3 py-1.5 text-sm text-ink hover:bg-raised"
        >
          Try again
        </button>
      ) : null}
    </div>
  );
}

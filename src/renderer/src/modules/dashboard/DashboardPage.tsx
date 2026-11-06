import { useState } from 'react';
import type { AppError } from '@shared/ipc/result';
import type { Counts, DataSummary } from '@shared/ipc/contract';
import { Button } from '@/design/Button';
import { Page, Panel } from '@/design/Page';
import { EmptyState, ErrorState, LoadingState } from '@/design/StateViews';
import { call, useQuery } from '@/lib/api';

const COUNT_LABELS: [keyof Counts, string][] = [
  ['rounds', 'Rounds'],
  ['shots', 'Shots'],
  ['sessions', 'Sessions'],
  ['clubs', 'Clubs'],
  ['courses', 'Courses'],
  ['practiceLogs', 'Practice logs'],
];

function SampleControls({ summary, onChanged }: { summary: DataSummary; onChanged: () => void }) {
  const [busy, setBusy] = useState<'load' | 'clear' | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const run = async (kind: 'load' | 'clear') => {
    setBusy(kind);
    setError(null);
    setNote(null);
    const res = await call(kind === 'load' ? 'data.loadSample' : 'data.clearSample', {});
    setBusy(null);
    if (!res.ok) return setError(res.error);
    if (kind === 'clear' && 'kept' in res.data && res.data.kept.clubs > 0) {
      setNote(`Sample data removed. ${res.data.kept.clubs} sample club(s) kept because your own shots use them.`);
    }
    onChanged();
  };

  if (summary.hasSample) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-panel border border-brass/40 bg-brass/8 px-5 py-3.5">
        <p className="text-ink-soft">
          You're looking at <span className="font-medium text-brass">sample data</span>: an invented player at a
          fictional course. Nothing here is a measurement of you.
        </p>
        <Button variant="danger" busy={busy === 'clear'} onClick={() => void run('clear')}>
          Remove sample data
        </Button>
        {error && <p className="w-full text-sm text-hazard">{error.message}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <div className="flex gap-2">
        <Button variant="primary" busy={busy === 'load'} onClick={() => void run('load')}>
          Load sample data
        </Button>
      </div>
      <p className="text-sm text-ink-faint">Sample data is clearly marked and can be removed in one click.</p>
      {note && <p className="text-sm text-ink-muted">{note}</p>}
      {error && <p className="text-sm text-hazard">{error.message}</p>}
    </div>
  );
}

function CountsPanel({ summary }: { summary: DataSummary }) {
  return (
    <Panel className="p-5">
      <h2 className="figures mb-4 text-lg font-semibold">On record</h2>
      <dl className="grid grid-cols-3 gap-x-6 gap-y-4">
        {COUNT_LABELS.map(([key, label]) => {
          const own = summary.own[key];
          const sample = summary.sample[key];
          return (
            <div key={key}>
              <dt className="text-sm text-ink-muted">{label}</dt>
              <dd className="figures text-2xl font-semibold text-ink">{(own + sample).toLocaleString()}</dd>
              {sample > 0 && <dd className="text-xs text-brass">{sample.toLocaleString()} sample</dd>}
            </div>
          );
        })}
      </dl>
    </Panel>
  );
}

export default function DashboardPage() {
  const summary = useQuery('data.summary', {});
  const health = useQuery('db.health', {});

  return (
    <Page title="Dashboard" lede="Where your game stands, drawn only from what you have recorded.">
      {summary.status === 'loading' && <LoadingState label="Reading your data" />}
      {summary.status === 'error' && <ErrorState error={summary.error} onRetry={summary.reload} />}
      {(summary.status === 'ready' || summary.status === 'empty') && (
        <div className="flex flex-col gap-6">
          {summary.data.hasSample && <SampleControls summary={summary.data} onChanged={summary.reload} />}

          <div className="grid grid-cols-[minmax(0,2fr)_minmax(280px,1fr)] gap-6">
            {summary.data.hasSample || summary.data.hasOwn ? (
              <CountsPanel summary={summary.data} />
            ) : (
              <Panel>
                <EmptyState
                  title="No rounds or shots yet"
                  action={<SampleControls summary={summary.data} onChanged={summary.reload} />}
                >
                  <p>
                    Your scoring, distances and trends will appear here once you record a round or log a session.
                    Nothing is estimated: every number on this screen will come from your own entries. To look around
                    first, load the sample data.
                  </p>
                </EmptyState>
              </Panel>
            )}

            <Panel className="p-5">
              <h2 className="figures mb-3 text-lg font-semibold">Your data file</h2>
              {health.status === 'loading' && <LoadingState label="Checking your data file" />}
              {health.status === 'error' && <ErrorState error={health.error} onRetry={health.reload} />}
              {(health.status === 'ready' || health.status === 'empty') && (
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                  <dt className="text-ink-muted">Stored on</dt>
                  <dd className="truncate text-ink-soft" title={health.data.path} data-selectable>
                    this computer
                  </dd>
                  <dt className="text-ink-muted">Schema</dt>
                  <dd className="figures text-ink">v{health.data.schemaVersion}</dd>
                  <dt className="text-ink-muted">SQLite</dt>
                  <dd className="figures text-ink">{health.data.sqliteVersion}</dd>
                  <dt className="text-ink-muted">Integrity</dt>
                  <dd className={health.data.foreignKeys ? 'text-green-speed' : 'text-hazard'}>
                    {health.data.foreignKeys ? 'Relationships enforced' : 'Relationships not enforced'}
                  </dd>
                </dl>
              )}
            </Panel>
          </div>
        </div>
      )}
    </Page>
  );
}

import { Page, Panel } from '@/design/Page';
import { EmptyState, ErrorState, LoadingState } from '@/design/StateViews';
import { useQuery } from '@/lib/api';

/**
 * Phase-1 dashboard: proves the full path (renderer → preload → main → SQLite)
 * and shows the honest empty state. Summary widgets arrive once the schema and
 * the round and shot modules exist.
 */
export default function DashboardPage() {
  const health = useQuery('db.health', {});

  return (
    <Page title="Dashboard" lede="Where your game stands, drawn only from what you have recorded.">
      <div className="grid grid-cols-[minmax(0,2fr)_minmax(280px,1fr)] gap-6">
        <Panel>
          <EmptyState title="No rounds or shots yet">
            <p>
              Your scoring, distances and trends will appear here once you record a round or log a practice
              session. Nothing is estimated: every number on this screen will come from your own entries.
            </p>
          </EmptyState>
        </Panel>

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
    </Page>
  );
}

import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import type { Insight } from '@shared/dto';
import { MIN_ROUNDS_FOR_AVERAGE, MIN_SAMPLE_FOR_AVERAGE } from '@shared/constants';
import { Segmented } from '@/design/controls';
import { InsightCard } from '@/design/golf';
import { Page, Panel } from '@/design/Page';
import { QueryView } from '@/design/QueryView';
import { mutate, useQuery } from '@/lib/api';

type Filter = 'all' | Insight['kind'];

function DismissButton({ insight }: { insight: Insight }) {
  const [busy, setBusy] = useState(false);
  const Icon = insight.dismissed ? Eye : EyeOff;
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await mutate('insights.setDismissed', { key: insight.key, dismissed: !insight.dismissed });
        setBusy(false);
      }}
      className="inline-flex items-center gap-1 rounded-control px-1.5 py-0.5 text-ink-faint hover:bg-overlay hover:text-ink"
    >
      <Icon size={13} aria-hidden /> {insight.dismissed ? 'Restore' : 'Hide'}
    </button>
  );
}

export default function IntelligencePage() {
  const insights = useQuery('insights.list', {});
  const [filter, setFilter] = useState<Filter>('all');
  const [showHidden, setShowHidden] = useState(false);

  return (
    <Page title="Intelligence" lede="Findings from your data, each shown with the evidence and sample size behind it.">
      <div className="grid grid-cols-[minmax(0,1fr)_300px] gap-6">
        <QueryView q={insights} label="Analysing your data" onRetry={insights.reload}>
          {(list) => {
            const hidden = list.filter((i) => i.dismissed).length;
            const shown = list.filter((i) => (filter === 'all' || i.kind === filter) && (showHidden || !i.dismissed));
            return (
              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <Segmented
                    label="Filter insights"
                    value={filter}
                    options={[
                      { value: 'all', label: `All (${list.filter((i) => !i.dismissed).length})` },
                      { value: 'opportunity', label: 'Opportunities' },
                      { value: 'strength', label: 'Strengths' },
                      { value: 'note', label: 'Notes' },
                    ]}
                    onChange={setFilter}
                  />
                  {hidden > 0 && (
                    <button type="button" onClick={() => setShowHidden((v) => !v)} className="text-sm text-ink-muted hover:text-ink">
                      {showHidden ? 'Hide' : 'Show'} {hidden} hidden
                    </button>
                  )}
                </div>
                {shown.length === 0 ? (
                  <Panel className="p-6">
                    <h3 className="figures text-lg font-semibold">Nothing to report{filter !== 'all' ? ' in this category' : ''}</h3>
                    <p className="mt-1 max-w-[60ch] text-sm text-ink-muted">
                      Insights only appear when your data clearly supports them. Record more rounds with putts and tee-shot results, and log range sessions,
                      to give the rules something to work with.
                    </p>
                  </Panel>
                ) : (
                  <div className="grid grid-cols-2 gap-4">
                    {shown.map((i) => (
                      <InsightCard key={i.key} insight={i} actions={<DismissButton insight={i} />} />
                    ))}
                  </div>
                )}
              </div>
            );
          }}
        </QueryView>

        <aside className="flex flex-col gap-4">
          <Panel className="p-5">
            <h2 className="figures mb-2 text-lg font-semibold">How this works</h2>
            <ul className="flex flex-col gap-2.5 text-sm text-ink-muted">
              <li>Every finding is a fixed rule applied to rows you recorded. Each card states its rule.</li>
              <li>
                Nothing is compared with outside averages. "Better" and "worse" always mean better or worse than <span className="text-ink-soft">your own</span> history.
              </li>
              <li>
                A rule stays silent until it has enough data: {MIN_SAMPLE_FOR_AVERAGE} shots per club, {MIN_ROUNDS_FOR_AVERAGE} rounds for round averages, and more for
                the patterns that need it.
              </li>
              <li>Cards built on sample data carry a Sample badge.</li>
            </ul>
          </Panel>
        </aside>
      </div>
    </Page>
  );
}

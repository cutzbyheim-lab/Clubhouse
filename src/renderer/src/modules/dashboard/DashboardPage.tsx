import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { DashboardOverview, Kpi } from '@shared/dto';
import type { AppError } from '@shared/ipc/result';
import type { DataSummary } from '@shared/ipc/contract';
import { formatToPar } from '@shared/domain/golf';
import { Button } from '@/design/Button';
import { ChartCard, ChartTooltip, GRID, SINGLE, axisProps } from '@/design/charts';
import { InsightCard, ToPar, YardageLadder } from '@/design/golf';
import { Page, Panel } from '@/design/Page';
import { QueryView } from '@/design/QueryView';
import { StatTile, type Delta } from '@/design/StatTile';
import { EmptyState } from '@/design/StateViews';
import { SampleBadge } from '@/design/controls';
import { hasData, mutate, useQuery } from '@/lib/api';

const shortDate = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

function delta(k: Kpi, scale = 1, lowerIsBetter = false, fmt?: (v: number) => string): Delta | null {
  if (k.value === null || k.priorValue === null) return null;
  return { value: (k.value - k.priorValue) * scale, lowerIsBetter, against: `previous ${k.priorN}`, ...(fmt ? { format: fmt } : {}) };
}

function SampleBanner({ summary }: { summary: DataSummary }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  if (!summary.hasSample) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-panel border border-brass/40 bg-brass/8 px-5 py-3">
      <p className="text-sm text-ink-soft">
        You're looking at <span className="font-medium text-brass">sample data</span>: an invented player at a fictional course. Nothing here is a
        measurement of you.
      </p>
      <Button
        variant="danger"
        busy={busy}
        onClick={async () => {
          setBusy(true);
          const res = await mutate('data.clearSample', {});
          setBusy(false);
          if (!res.ok) setError(res.error);
        }}
      >
        Remove sample data
      </Button>
      {error && <p className="w-full text-sm text-hazard">{error.message}</p>}
    </div>
  );
}

function Welcome() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  return (
    <Panel>
      <EmptyState
        title="No rounds or shots yet"
        action={
          <div className="flex flex-col items-start gap-2">
            <div className="flex gap-2">
              <Button
                variant="primary"
                busy={busy}
                onClick={async () => {
                  setBusy(true);
                  const res = await mutate('data.loadSample', {});
                  setBusy(false);
                  if (!res.ok) setError(res.error);
                }}
              >
                Load sample data
              </Button>
              <Link to="/rounds" className="rounded-control border border-rule-strong px-3.5 py-1.5 text-sm text-ink-soft hover:bg-overlay hover:text-ink">
                Record a round
              </Link>
            </div>
            <p className="text-sm text-ink-faint">Sample data is clearly marked and can be removed in one click.</p>
            {error && <p className="text-sm text-hazard">{error.message}</p>}
          </div>
        }
      >
        <p>
          Your scoring, distances and trends will appear here once you record a round or log a session. Nothing is estimated: every number on this
          screen will come from your own entries. To look around first, load the sample data.
        </p>
      </EmptyState>
    </Panel>
  );
}

function Overview({ d }: { d: DashboardOverview }) {
  const navigate = useNavigate();
  const trend = d.recentRounds
    .filter((r) => r.holesPlayed === 18)
    .slice()
    .reverse()
    .map((r) => ({ date: r.playedOn, toPar: r.strokes - r.par, strokes: r.strokes }));
  const pct = (v: number | null) => (v === null ? null : `${Math.round(v * 100)}`);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-4 gap-4">
        <StatTile
          accent
          label="Scoring average"
          value={d.scoring.value === null ? null : d.scoring.value.toFixed(1)}
          basis={`last ${d.scoring.n} full rounds`}
          delta={delta(d.scoring, 1, true)}
          emptyReason="Needs 3 complete 18-hole rounds"
        />
        <StatTile
          label="Greens in regulation"
          value={pct(d.girPct.value)}
          unit="%"
          basis={`last ${d.girPct.n} rounds`}
          delta={delta(d.girPct, 100, false, (v) => `${v.toFixed(0)} pts`)}
          emptyReason="Needs putts recorded on 3 rounds"
        />
        <StatTile
          label="Fairways hit"
          value={pct(d.fairwayPct.value)}
          unit="%"
          basis={`last ${d.fairwayPct.n} rounds`}
          delta={delta(d.fairwayPct, 100, false, (v) => `${v.toFixed(0)} pts`)}
          emptyReason="Needs fairways recorded on 3 rounds"
        />
        <StatTile
          label="Putts per round"
          value={d.puttsPerRound.value === null ? null : d.puttsPerRound.value.toFixed(1)}
          basis={`last ${d.puttsPerRound.n} full rounds`}
          delta={delta(d.puttsPerRound, 1, true)}
          emptyReason="Needs putts on 3 full rounds"
        />
      </div>

      <div className="grid grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] gap-6">
        <ChartCard
          title="Score to par"
          subtitle="Complete 18-hole rounds, oldest to newest"
          height={368}
          table={{ columns: ['Date', 'Score', 'To par'], rows: trend.map((t) => [t.date, t.strokes, formatToPar(t.toPar)]) }}
        >
          {trend.length < 2 ? (
            <p className="pt-10 text-sm text-ink-faint">A trend line appears after two complete rounds.</p>
          ) : (
            <ResponsiveContainer>
              <LineChart data={trend} margin={{ top: 8, right: 12, bottom: 0, left: -18 }}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="date" {...axisProps} tickFormatter={shortDate} minTickGap={24} />
                <YAxis {...axisProps} tickFormatter={(v: number) => formatToPar(v)} domain={['dataMin - 2', 'dataMax + 2']} allowDecimals={false} />
                <ReferenceLine y={0} stroke="#5b645d" strokeDasharray="4 4" />
                <Tooltip
                  cursor={{ stroke: '#46504a' }}
                  content={(p) => (
                    <ChartTooltip
                      {...(p as object)}
                      labelFormat={(l) => shortDate(String(l))}
                      format={(v) => formatToPar(v)}
                    />
                  )}
                />
                <Line type="linear" dataKey="toPar" name="To par" stroke={SINGLE} strokeWidth={2} dot={{ r: 4, fill: SINGLE, stroke: '#242825', strokeWidth: 2 }} activeDot={{ r: 6 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <Panel className="p-5">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="figures text-lg font-semibold">Yardage book</h2>
            <span className="text-xs text-ink-muted">Average carry · band is ±1 sd</span>
          </div>
          {d.ladder.length === 0 ? (
            <p className="text-sm text-ink-faint">Add clubs to your bag to see their distances.</p>
          ) : (
            <YardageLadder rows={d.ladder} onSelect={(id) => void navigate(`/shots?club=${id}`)} />
          )}
        </Panel>
      </div>

      <div className="grid grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] gap-6">
        <section>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="figures text-lg font-semibold">What your data says</h2>
            <Link to="/intelligence" className="text-sm text-green-speed hover:underline">
              All insights
            </Link>
          </div>
          {d.insights.length === 0 ? (
            <Panel className="p-5 text-sm text-ink-faint">Insights appear once there are enough rounds and shots to support them.</Panel>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              {d.insights.slice(0, 2).map((i) => (
                <InsightCard key={i.key} insight={i} compact />
              ))}
            </div>
          )}
        </section>

        <Panel className="p-5">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="figures text-lg font-semibold">Recent rounds</h2>
            <Link to="/rounds" className="text-sm text-green-speed hover:underline">
              All rounds
            </Link>
          </div>
          {d.recentRounds.length === 0 ? (
            <p className="text-sm text-ink-faint">No rounds recorded yet.</p>
          ) : (
            <ul className="flex flex-col">
              {d.recentRounds.slice(0, 5).map((r) => (
                <li key={r.id}>
                  <Link to={`/rounds?id=${r.id}`} className="grid grid-cols-[64px_1fr_auto_44px] items-center gap-3 rounded-control px-2 py-2 hover:bg-overlay">
                    <span className="figures text-sm text-ink-muted">{shortDate(r.playedOn)}</span>
                    <span className="flex items-center gap-2 truncate text-sm text-ink-soft">
                      {r.courseName}
                      {r.holesPlayed < 18 && <span className="text-xs text-ink-faint">{r.holesPlayed} holes</span>}
                      <SampleBadge show={r.source === 'sample'} />
                    </span>
                    <span className="figures text-lg font-semibold">{r.strokes}</span>
                    <ToPar strokes={r.strokes} par={r.par} className="text-right text-sm" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4 border-t border-rule pt-3 text-sm text-ink-muted">
            <span className="figures text-ink">{d.practice.minutesLast30}</span> min practised in 30 days
            {d.practice.nextPlan && (
              <>
                {' · '}next: <Link to="/practice" className="text-green-speed hover:underline">{d.practice.nextPlan.name}</Link>
              </>
            )}
          </div>
        </Panel>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const summary = useQuery('data.summary', {});
  const overview = useQuery('dashboard.overview', {});
  const hasAny = hasData(summary) && (summary.data.hasOwn || summary.data.hasSample);

  return (
    <Page title="Dashboard" lede="Where your game stands, drawn only from what you have recorded.">
      <QueryView q={summary} label="Reading your data">
        {(s) => (
          <div className="flex flex-col gap-6">
            <SampleBanner summary={s} />
            {!hasAny ? (
              <Welcome />
            ) : (
              <QueryView q={overview} label="Building your dashboard" onRetry={overview.reload}>
                {(d) => <Overview d={d} />}
              </QueryView>
            )}
          </div>
        )}
      </QueryView>
    </Page>
  );
}

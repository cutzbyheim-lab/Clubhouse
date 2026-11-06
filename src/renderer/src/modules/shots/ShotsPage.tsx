import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { ClubSummary, ShotPoint } from '@shared/dto';
import { ChartCard, ChartTooltip, GRID, SINGLE, axisProps } from '@/design/charts';
import { SampleBadge } from '@/design/controls';
import { Page, Panel } from '@/design/Page';
import { QueryView } from '@/design/QueryView';
import { StatTile } from '@/design/StatTile';
import { EmptyState } from '@/design/StateViews';
import { mutate, useQuery } from '@/lib/api';
import { useUnits } from '@/stores/profile';
import { RangeView } from './RangeView';

function ClubPicker({ clubs, value, onChange }: { clubs: ClubSummary[]; value: number; onChange: (id: number) => void }) {
  return (
    <div role="tablist" aria-label="Club" className="flex flex-wrap gap-1.5">
      {clubs.map((c) => (
        <button
          key={c.id}
          role="tab"
          type="button"
          aria-selected={c.id === value}
          onClick={() => onChange(c.id)}
          className={`rounded-full border px-3 py-1 text-sm transition-colors ${
            c.id === value ? 'border-green-speed bg-fairway-deep text-ink' : 'border-rule text-ink-soft hover:border-rule-strong hover:text-ink'
          }`}
        >
          {c.label}
          <span className="figures ml-1.5 text-xs text-ink-faint">{c.stats.n}</span>
        </button>
      ))}
    </div>
  );
}

function Histogram({ shots }: { shots: readonly ShotPoint[] }) {
  const u = useUnits();
  const carries = shots.filter((s) => !s.excluded && s.carryM !== null).map((s) => u.d(s.carryM ?? 0));
  const bins = useMemo(() => {
    if (carries.length === 0) return [];
    const width = 5;
    const lo = Math.floor(Math.min(...carries) / width) * width;
    const hi = Math.ceil((Math.max(...carries) + 0.01) / width) * width;
    const out: { range: string; from: number; count: number }[] = [];
    for (let b = lo; b < hi; b += width) out.push({ range: `${b}–${b + width}`, from: b, count: carries.filter((c) => c >= b && c < b + width).length });
    return out;
  }, [carries]);
  return (
    <ChartCard
      title="Carry distribution"
      subtitle={`${carries.length} shots in ${u.du === 'yards' ? '5-yard' : '5-metre'} bands`}
      height={220}
      table={{ columns: [`Carry (${u.dSuffix})`, 'Shots'], rows: bins.map((b) => [b.range, b.count]) }}
    >
      <ResponsiveContainer>
        <BarChart data={bins} margin={{ top: 4, right: 4, bottom: 0, left: -26 }} barCategoryGap={2}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="from" {...axisProps} />
          <YAxis {...axisProps} allowDecimals={false} />
          <Tooltip
            cursor={{ fill: 'rgba(255,255,255,0.04)' }}
            content={(p) => <ChartTooltip {...(p as object)} labelFormat={(l) => `${l}–${Number(l) + 5} ${u.dSuffix}`} />}
          />
          <Bar dataKey="count" name="Shots" fill={SINGLE} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

function ShotTable({ shots }: { shots: readonly ShotPoint[] }) {
  const u = useUnits();
  const [busyId, setBusyId] = useState<number | null>(null);
  const toggle = async (s: ShotPoint) => {
    setBusyId(s.id);
    await mutate('shots.setExcluded', { id: s.id, excluded: !s.excluded });
    setBusyId(null);
  };
  return (
    <Panel>
      <div className="flex items-baseline justify-between px-5 pt-5 pb-3">
        <h2 className="figures text-lg font-semibold">Shots</h2>
        <span className="text-xs text-ink-muted">Flag a mishit to keep it on record but out of your averages.</span>
      </div>
      <div className="max-h-[360px] overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-raised text-left text-xs text-ink-muted">
            <tr className="border-y border-rule">
              {['Date', 'Carry', 'Total', 'Offline', 'Ball speed', 'Launch', 'Spin', 'Mishit'].map((h) => (
                <th key={h} className="px-5 py-2 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="figures">
            {shots.map((s) => (
              <tr key={s.id} className={`border-b border-rule last:border-0 ${s.excluded ? 'text-ink-faint' : 'text-ink-soft'}`}>
                <td className="px-5 py-2">
                  <span className="flex items-center gap-2">
                    {s.startedAt.slice(0, 10)} <SampleBadge show={s.source === 'sample'} />
                  </span>
                </td>
                <td className="px-5 py-2 text-ink">{u.dist(s.carryM, 1)}</td>
                <td className="px-5 py-2">{u.dist(s.totalM, 1)}</td>
                <td className="px-5 py-2">
                  {s.offlineM === null ? '—' : `${u.dist(Math.abs(s.offlineM), 1)} ${s.offlineM > 0 ? 'R' : s.offlineM < 0 ? 'L' : ''}`}
                </td>
                <td className="px-5 py-2">{u.speed(s.ballSpeedMps)}</td>
                <td className="px-5 py-2">{s.launchDeg === null ? '—' : `${s.launchDeg.toFixed(1)}°`}</td>
                <td className="px-5 py-2">{s.spinRpm === null ? '—' : s.spinRpm.toLocaleString()}</td>
                <td className="px-5 py-2">
                  <input
                    type="checkbox"
                    checked={s.excluded}
                    disabled={busyId === s.id}
                    onChange={() => void toggle(s)}
                    aria-label={`Flag shot from ${s.startedAt.slice(0, 10)} as a mishit`}
                    className="h-4 w-4 accent-[#c4a35e]"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function ClubDetail({ club }: { club: ClubSummary }) {
  const u = useUnits();
  const shots = useQuery('shots.forClub', { clubId: club.id });
  const s = club.stats;
  const c = s.counts;
  const basis = (k: string) => `${c[k] ?? 0} shots`;
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-6 gap-3">
        <StatTile
          accent
          label="Average carry"
          value={s.carryMean === null ? null : Math.round(u.d(s.carryMean)).toString()}
          unit={u.dSuffix}
          basis={s.carryP10 !== null && s.carryP90 !== null ? `80% between ${Math.round(u.d(s.carryP10))}–${Math.round(u.d(s.carryP90))}` : basis('carry')}
          emptyReason={`${s.n} of 5 shots needed`}
        />
        <StatTile label="Total" value={s.totalMean === null ? null : Math.round(u.d(s.totalMean)).toString()} unit={u.dSuffix} basis={basis('total')} />
        <StatTile
          label="Side spread"
          value={s.offlineSd === null ? null : `±${Math.round(u.d(s.offlineSd))}`}
          unit={u.dSuffix}
          basis={s.offlineMean === null ? basis('offline') : `avg ${Math.round(u.d(Math.abs(s.offlineMean)))} ${s.offlineMean >= 0 ? 'right' : 'left'}`}
          emptyReason="Needs direction data"
        />
        <StatTile label="Ball speed" value={s.ballSpeedMean === null ? null : Math.round(u.s(s.ballSpeedMean)).toString()} unit={u.sSuffix} basis={basis('ballSpeed')} />
        <StatTile label="Smash factor" value={s.smashMean === null ? null : s.smashMean.toFixed(2)} basis={basis('smash')} emptyReason="Needs club speed data" />
        <StatTile
          label="Launch · spin"
          value={s.launchMean === null ? null : `${s.launchMean.toFixed(1)}°`}
          basis={s.spinMean === null ? basis('launch') : `${Math.round(s.spinMean).toLocaleString()} rpm`}
        />
      </div>
      <QueryView q={shots} label="Loading shots" onRetry={shots.reload}>
        {(list) =>
          list.length === 0 ? (
            <Panel>
              <EmptyState art="flight" title={`No shots with ${club.label} yet`}>
                <p>Shots appear here once you log a range or simulator session with this club.</p>
              </EmptyState>
            </Panel>
          ) : (
            <>
              <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] gap-6">
                <Panel className="p-5">
                  <div className="mb-2 flex items-baseline justify-between">
                    <h2 className="figures text-lg font-semibold">Where they land</h2>
                    <span className="text-xs text-ink-muted">Top-down view, {u.dSuffix} from you</span>
                  </div>
                  <RangeView shots={list} />
                </Panel>
                <div className="flex flex-col gap-6">
                  <Histogram shots={list} />
                  <SessionsPanel />
                </div>
              </div>
              <ShotTable shots={list} />
            </>
          )
        }
      </QueryView>
    </div>
  );
}

function SessionsPanel() {
  const sessions = useQuery('sessions.list', {});
  return (
    <Panel className="p-5">
      <h2 className="figures mb-3 text-lg font-semibold">Recent sessions</h2>
      <QueryView q={sessions} label="Loading sessions">
        {(list) =>
          list.length === 0 ? (
            <p className="text-sm text-ink-faint">No range or simulator sessions yet.</p>
          ) : (
            <ul className="flex max-h-[176px] flex-col gap-2 overflow-y-auto pr-1">
              {list.slice(0, 8).map((s) => (
                <li key={s.id} className="flex items-baseline gap-3 text-sm">
                  <span className="figures w-[74px] shrink-0 text-ink-muted">{s.startedAt.slice(0, 10)}</span>
                  <span className="min-w-0 flex-1 truncate text-ink-soft" title={s.clubs.join(', ')}>
                    {s.device ?? s.location ?? s.kind}
                  </span>
                  <span className="figures shrink-0 text-ink">{s.shotCount}</span>
                  <SampleBadge show={s.source === 'sample'} />
                </li>
              ))}
            </ul>
          )
        }
      </QueryView>
    </Panel>
  );
}

export default function ShotsPage() {
  const clubs = useQuery('clubs.list', {});
  const [params, setParams] = useSearchParams();
  return (
    <Page title="Shot analytics" lede="Carry, dispersion and launch by club, from the shots you have logged.">
      <QueryView
        q={clubs}
        label="Loading clubs"
        onRetry={clubs.reload}
      >
        {(all) => {
          const withShots = all.filter((c) => c.kind !== 'putter' && c.stats.n + c.stats.excluded > 0).sort((a, b) => (a.loftDeg ?? 99) - (b.loftDeg ?? 99));
          if (withShots.length === 0) {
            return (
              <Panel>
                <EmptyState art="flight" title="No shots logged yet">
                  <p>Once you record range or simulator sessions, each club's carry, dispersion and launch numbers show up here.</p>
                </EmptyState>
              </Panel>
            );
          }
          const requested = Number(params.get('club'));
          const fallback = withShots.find((c) => c.stats.carryMean !== null) ?? withShots[0]!;
          const selected = withShots.find((c) => c.id === requested) ?? fallback;
          return (
            <div className="flex flex-col gap-6">
              <ClubPicker clubs={withShots} value={selected.id} onChange={(id) => setParams({ club: String(id) })} />
              <ClubDetail key={selected.id} club={selected} />
            </div>
          );
        }}
      </QueryView>
    </Page>
  );
}

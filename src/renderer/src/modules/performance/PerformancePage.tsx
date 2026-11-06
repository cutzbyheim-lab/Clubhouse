import { Bar, BarChart, CartesianGrid, Cell, LabelList, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Performance } from '@shared/dto';
import { SCORE_NAMES, formatToPar } from '@shared/domain/golf';
import { ChartCard, ChartTooltip, GRID, SCORE_COLORS, SINGLE, axisProps } from '@/design/charts';
import { Page } from '@/design/Page';
import { QueryView } from '@/design/QueryView';
import { useQuery } from '@/lib/api';
import { useUnits } from '@/stores/profile';

const shortDate = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const MIX_LABEL = { eagle: 'Eagle+', birdie: 'Birdie', par: 'Par', bogey: 'Bogey', double: 'Double', triple: 'Triple+' } as const;

function Trend({ title, subtitle, data, unit, format, refY }: { title: string; subtitle: string; data: { date: string; v: number }[]; unit?: string; format: (v: number) => string; refY?: number }) {
  return (
    <ChartCard title={title} subtitle={subtitle} height={170} table={{ columns: ['Date', title], rows: data.map((d) => [d.date, format(d.v)]) }}>
      {data.length < 2 ? (
        <p className="pt-8 text-sm text-ink-faint">Needs at least two rounds with this recorded.</p>
      ) : (
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -20 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="date" {...axisProps} tickFormatter={shortDate} minTickGap={28} />
            <YAxis {...axisProps} tickFormatter={(v: number) => format(v)} domain={['auto', 'auto']} width={44} />
            {refY !== undefined && <ReferenceLine y={refY} stroke="#5b645d" strokeDasharray="4 4" />}
            <Tooltip cursor={{ stroke: '#46504a' }} content={(p) => <ChartTooltip {...(p as object)} labelFormat={(l) => shortDate(String(l))} format={(v) => `${format(v)}${unit ?? ''}`} />} />
            <Line type="linear" dataKey="v" name={title} stroke={SINGLE} strokeWidth={2} dot={{ r: 3.5, fill: SINGLE, stroke: '#242825', strokeWidth: 2 }} activeDot={{ r: 5 }} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}

function Lab({ p }: { p: Performance }) {
  const u = useUnits();
  const full = p.rounds.filter((r) => r.holesPlayed === 18);
  const toPar = full.map((r) => ({ date: r.playedOn, v: r.strokes - r.par }));
  const putts = full.filter((r) => r.puttsHoles === 18).map((r) => ({ date: r.playedOn, v: r.putts ?? 0 }));
  const gir = p.rounds.filter((r) => r.girHoles > 0).map((r) => ({ date: r.playedOn, v: (r.gir / r.girHoles) * 100 }));
  const fw = p.rounds.filter((r) => r.fairwayHoles > 0).map((r) => ({ date: r.playedOn, v: (r.fairways / r.fairwayHoles) * 100 }));

  const mix = p.rounds.map((r) => {
    const total = SCORE_NAMES.reduce((s, n) => s + r.mix[n], 0) || 1;
    return { date: r.playedOn, holes: r.holesPlayed, ...Object.fromEntries(SCORE_NAMES.map((n) => [n, (r.mix[n] / total) * 100])), raw: r.mix };
  });
  const byPar = p.byPar.map((b) => ({ ...b, label: `Par ${b.par}`, v: b.avgToPar ?? 0 }));
  const putt = p.puttMakeByDistance.map((b) => ({
    ...b,
    label: b.maxM >= 60 ? `${Math.round(u.d(b.minM))}+` : `${Math.round(u.d(b.minM))}–${Math.round(u.d(b.maxM))}`,
    v: b.attempts >= 5 ? (b.oneputts / b.attempts) * 100 : null,
  }));

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-6 xl:grid-cols-4">
        <Trend title="Score to par" subtitle="18-hole rounds" data={toPar} format={(v) => formatToPar(Math.round(v))} refY={0} />
        <Trend title="Putts" subtitle="18-hole rounds with putts" data={putts} format={(v) => v.toFixed(0)} />
        <Trend title="Greens hit" subtitle="% of holes in regulation" data={gir} unit="%" format={(v) => v.toFixed(0)} />
        <Trend title="Fairways hit" subtitle="% of par 4s and 5s" data={fw} unit="%" format={(v) => v.toFixed(0)} />
      </div>

      <ChartCard
        title="How each round was made"
        subtitle="Share of holes by score, every round"
        height={240}
        legend={SCORE_NAMES.map((n) => ({ label: MIX_LABEL[n], color: SCORE_COLORS[n], square: true }))}
        table={{ columns: ['Date', ...SCORE_NAMES.map((n) => MIX_LABEL[n])], rows: mix.map((m) => [m.date, ...SCORE_NAMES.map((n) => m.raw[n])]) }}
      >
        <ResponsiveContainer>
          <BarChart data={mix} margin={{ top: 4, right: 8, bottom: 0, left: -20 }} barCategoryGap={6}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="date" {...axisProps} tickFormatter={shortDate} minTickGap={16} />
            <YAxis {...axisProps} unit="%" domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} />
            <Tooltip
              cursor={{ fill: 'rgba(255,255,255,0.04)' }}
              content={(props) => {
                const row = (props as { payload?: readonly { payload?: (typeof mix)[number] }[] }).payload?.[0]?.payload;
                return <ChartTooltip {...(props as object)} labelFormat={(l) => `${shortDate(String(l))}${row && row.holes < 18 ? ` · ${row.holes} holes` : ''}`} format={(_v, name) => {
                  const key = SCORE_NAMES.find((n) => MIX_LABEL[n] === name);
                  return key && row ? `${row.raw[key]} holes` : '';
                }} />;
              }}
            />
            {SCORE_NAMES.map((n, i) => (
              <Bar key={n} dataKey={n} name={MIX_LABEL[n]} stackId="mix" fill={SCORE_COLORS[n]} stroke="#242825" strokeWidth={1} radius={i === SCORE_NAMES.length - 1 ? [4, 4, 0, 0] : 0} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <div className="grid grid-cols-3 gap-6">
        <ChartCard title="Score by hole type" subtitle="Average strokes over par" height={220} table={{ columns: ['Hole type', 'Holes', 'Avg to par'], rows: byPar.map((b) => [b.label, b.holes, b.avgToPar === null ? '—' : `+${b.avgToPar.toFixed(2)}`]) }}>
          <ResponsiveContainer>
            <BarChart data={byPar} margin={{ top: 20, right: 8, bottom: 0, left: -20 }} barCategoryGap="30%">
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="label" {...axisProps} />
              <YAxis {...axisProps} domain={[0, 'auto']} tickFormatter={(v: number) => `+${v.toFixed(1)}`} />
              <Tooltip cursor={{ fill: 'rgba(255,255,255,0.04)' }} content={(props) => <ChartTooltip {...(props as object)} format={(v) => `+${v.toFixed(2)}`} />} />
              <Bar dataKey="v" name="Average to par" fill={SINGLE} radius={[4, 4, 0, 0]}>
                <LabelList dataKey="holes" position="top" formatter={(v: unknown) => `${String(v)} holes`} style={{ fill: '#8c958d', fontSize: 10 }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="One-putt rate by distance"
          subtitle={`First-putt length in ${u.dSuffix}; shown with 5+ attempts`}
          height={220}
          table={{ columns: [`Distance (${u.dSuffix})`, 'Attempts', 'One-putts', 'Rate'], rows: putt.map((b) => [b.label, b.attempts, b.oneputts, b.v === null ? '—' : `${b.v.toFixed(0)}%`]) }}
        >
          <ResponsiveContainer>
            <BarChart data={putt} margin={{ top: 20, right: 8, bottom: 0, left: -20 }} barCategoryGap="25%">
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="label" {...axisProps} />
              <YAxis {...axisProps} unit="%" domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} />
              <Tooltip cursor={{ fill: 'rgba(255,255,255,0.04)' }} content={(props) => <ChartTooltip {...(props as object)} format={(v) => `${v.toFixed(0)}%`} />} />
              <Bar dataKey="v" name="Holed first putt" fill={SINGLE} radius={[4, 4, 0, 0]}>
                <LabelList dataKey="attempts" position="top" formatter={(v: unknown) => `n=${String(v)}`} style={{ fill: '#8c958d', fontSize: 10 }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Hole by hole"
          subtitle={`Average over par${p.courseName ? ` at ${p.courseName}` : ''}`}
          height={220}
          table={{ columns: ['Hole', 'Par', 'Played', 'Avg to par'], rows: p.byHole.map((h) => [h.number, h.par, h.played, h.avgToPar === null ? '—' : h.avgToPar.toFixed(2)]) }}
        >
          <ResponsiveContainer>
            <BarChart data={p.byHole.map((h) => ({ ...h, v: h.avgToPar ?? 0 }))} margin={{ top: 4, right: 8, bottom: 0, left: -20 }} barCategoryGap={2}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="number" {...axisProps} interval={0} />
              <YAxis {...axisProps} tickFormatter={(v: number) => (v > 0 ? `+${v.toFixed(1)}` : v.toFixed(1))} />
              <ReferenceLine y={0} stroke="#5b645d" />
              <Tooltip cursor={{ fill: 'rgba(255,255,255,0.04)' }} content={(props) => <ChartTooltip {...(props as object)} labelFormat={(l) => `Hole ${l}`} format={(v) => (v > 0 ? `+${v.toFixed(2)}` : v.toFixed(2))} />} />
              <Bar dataKey="v" name="Average to par" radius={[3, 3, 0, 0]}>
                {p.byHole.map((h) => (
                  <Cell key={h.number} fill={(h.avgToPar ?? 0) <= 0 ? SCORE_COLORS.birdie : (h.avgToPar ?? 0) >= 1 ? SCORE_COLORS.double : SCORE_COLORS.bogey} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
    </div>
  );
}

export default function PerformancePage() {
  const perf = useQuery('performance.get', {}, { isEmpty: (p) => p.rounds.length === 0 });
  return (
    <Page title="Performance lab" lede="Trends across your rounds, measured against your own history.">
      <QueryView
        q={perf}
        label="Analysing your rounds"
        onRetry={perf.reload}
        empty={{ art: 'chart', title: 'No rounds to analyse yet', body: <p>Trends, scoring patterns and putting stats appear once you've recorded a few rounds.</p> }}
      >
        {(p) => <Lab p={p} />}
      </QueryView>
    </Page>
  );
}


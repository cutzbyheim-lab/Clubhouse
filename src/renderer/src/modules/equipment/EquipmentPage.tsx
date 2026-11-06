import { useState } from 'react';
import { CartesianGrid, LabelList, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from 'recharts';
import { Plus } from 'lucide-react';
import type { ClubSummary } from '@shared/dto';
import { GAP_TIGHT_M, GAP_WIDE_M, computeGaps, type Gap } from '@shared/domain/gapping';
import { Button } from '@/design/Button';
import { ChartCard, ChartTooltip, GRID, SINGLE, axisProps } from '@/design/charts';
import { SampleBadge } from '@/design/controls';
import { Page, Panel } from '@/design/Page';
import { QueryView } from '@/design/QueryView';
import { useQuery } from '@/lib/api';
import { useUnits } from '@/stores/profile';
import { ClubEditor, kindLabel } from './ClubEditor';

const STATUS: Record<Gap['status'], { label: string; cls: string }> = {
  ok: { label: 'Even', cls: 'text-ink-muted' },
  tight: { label: 'Tight', cls: 'text-brass' },
  wide: { label: 'Wide', cls: 'text-brass' },
  overlap: { label: 'Overlap', cls: 'text-hazard' },
};

/** Clubs as rungs down a ladder, with the gap to the next club between rungs. */
function GapLadder({ clubs }: { clubs: ClubSummary[] }) {
  const u = useUnits();
  const withCarry = clubs.filter((c) => c.stats.carryMean !== null).sort((a, b) => (a.loftDeg ?? 99) - (b.loftDeg ?? 99));
  const gaps = computeGaps(withCarry.map((c) => ({ clubId: c.id, label: c.label, loftDeg: c.loftDeg, carryM: c.stats.carryMean })));
  const max = Math.max(...withCarry.map((c) => c.stats.carryMean ?? 0), 1);
  if (withCarry.length < 2) return <p className="text-sm text-ink-faint">Gapping needs at least two clubs with five or more shots each.</p>;
  return (
    <ol className="flex flex-col">
      {withCarry.map((c, i) => {
        const gap = gaps[i];
        return (
          <li key={c.id}>
            <div className="grid grid-cols-[110px_1fr_56px] items-center gap-3 py-1">
              <span className="truncate text-sm text-ink-soft">{c.label}</span>
              <span className="relative h-2 rounded-full bg-sunken">
                <span className="absolute inset-y-0 left-0 rounded-full bg-fairway" style={{ width: `${((c.stats.carryMean ?? 0) / max) * 100}%` }} />
              </span>
              <span className="figures text-right text-sm text-ink">{Math.round(u.d(c.stats.carryMean ?? 0))}</span>
            </div>
            {gap && (
              <div className="grid grid-cols-[110px_1fr_56px] items-center gap-3 py-0.5">
                <span />
                <span className={`flex items-center gap-2 border-l border-dashed border-rule-strong pl-3 text-xs ${STATUS[gap.status].cls}`}>
                  <span className="figures">{gap.gapM <= 0 ? `${Math.round(u.d(-gap.gapM))} ${u.dSuffix} overlap` : `${Math.round(u.d(gap.gapM))} ${u.dSuffix} gap`}</span>
                  {gap.status !== 'ok' && <span className="font-medium">{STATUS[gap.status].label}</span>}
                </span>
                <span />
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

export default function EquipmentPage() {
  const clubs = useQuery('clubs.list', {});
  const u = useUnits();
  const [editing, setEditing] = useState<ClubSummary | null>(null);
  const [adding, setAdding] = useState(false);

  return (
    <Page
      title="Equipment lab"
      lede="Every club you own, its specs, and how evenly your distances step down through the bag."
      actions={
        <Button variant="primary" onClick={() => setAdding(true)}>
          <Plus size={15} /> Add club
        </Button>
      }
    >
      <QueryView q={clubs} label="Loading equipment" onRetry={clubs.reload}>
        {(all) => {
          const bag = all.filter((c) => c.inBag && c.kind !== 'putter');
          const points = bag
            .filter((c) => c.loftDeg !== null && c.stats.carryMean !== null)
            .map((c) => ({ loft: c.loftDeg ?? 0, carry: Math.round(u.d(c.stats.carryMean ?? 0)), label: c.label }));
          return (
            <div className="flex flex-col gap-6">
              <div className="grid grid-cols-2 gap-6">
                <Panel className="p-5">
                  <div className="mb-3">
                    <h2 className="figures text-lg font-semibold">Distance gapping</h2>
                    <p className="text-xs text-ink-muted">
                      Clubs in your bag by loft. Fitting rule of thumb: under {Math.round(u.d(GAP_TIGHT_M))} {u.dSuffix} is tight, over{' '}
                      {Math.round(u.d(GAP_WIDE_M))} {u.dSuffix} is wide.
                    </p>
                  </div>
                  <GapLadder clubs={bag} />
                </Panel>

                <ChartCard
                  title="Loft against carry"
                  subtitle="A smooth curve means each degree of loft buys a predictable distance"
                  height={420}
                  table={{ columns: ['Club', 'Loft (°)', `Carry (${u.dSuffix})`], rows: points.map((p) => [p.label, p.loft, p.carry]) }}
                >
                  {points.length < 2 ? (
                    <p className="pt-10 text-sm text-ink-faint">Needs lofts and at least five shots for two clubs.</p>
                  ) : (
                    <ResponsiveContainer>
                      <ScatterChart margin={{ top: 16, right: 24, bottom: 8, left: -8 }}>
                        <CartesianGrid stroke={GRID} />
                        <XAxis type="number" dataKey="loft" name="Loft" unit="°" {...axisProps} domain={[0, 65]} ticks={[0, 10, 20, 30, 40, 50, 60]} />
                        <YAxis type="number" dataKey="carry" name="Carry" {...axisProps} domain={[0, (max: number) => Math.ceil((max + 10) / 50) * 50]} allowDecimals={false} tickCount={6} />
                        <Tooltip
                          cursor={{ stroke: '#46504a' }}
                          content={(p) => <ChartTooltip {...(p as object)} format={(v, name) => (name === 'Loft' ? `${v}°` : `${v} ${u.dSuffix}`)} />}
                        />
                        <Scatter data={points} fill={SINGLE} line={{ stroke: '#2e6b47', strokeWidth: 2 }} shape="circle">
                          <LabelList dataKey="label" position="right" offset={8} style={{ fill: '#8c958d', fontSize: 10 }} />
                        </Scatter>
                      </ScatterChart>
                    </ResponsiveContainer>
                  )}
                </ChartCard>
              </div>

              <Panel>
                <div className="flex items-baseline justify-between px-5 pt-5 pb-3">
                  <h2 className="figures text-lg font-semibold">Inventory</h2>
                  <span className="text-xs text-ink-muted">Specs are as you entered them. Select a club to edit.</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs text-ink-muted">
                      <tr className="border-y border-rule">
                        {['Club', 'Type', 'Loft', 'Lie', 'Length', 'Shaft', 'Flex', 'Status', 'Shots'].map((h) => (
                          <th key={h} className="px-5 py-2 font-medium">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="figures">
                      {all.map((c) => (
                        <tr key={c.id} onClick={() => setEditing(c)} className={`cursor-pointer border-b border-rule last:border-0 hover:bg-overlay ${c.retiredOn ? 'text-ink-faint' : 'text-ink-soft'}`}>
                          <td className="px-5 py-2.5 font-semibold text-ink">
                            <span className="flex items-center gap-2">
                              {c.label} <SampleBadge show={c.source === 'sample'} />
                            </span>
                          </td>
                          <td className="px-5 py-2.5">{kindLabel(c.kind)}</td>
                          <td className="px-5 py-2.5">{c.loftDeg !== null ? `${c.loftDeg}°` : '—'}</td>
                          <td className="px-5 py-2.5">{c.lieDeg !== null ? `${c.lieDeg}°` : '—'}</td>
                          <td className="px-5 py-2.5">
                            {c.lengthM !== null ? (u.du === 'metres' ? `${(c.lengthM * 100).toFixed(1)} cm` : `${(c.lengthM * 39.3701).toFixed(2)}″`) : '—'}
                          </td>
                          <td className="px-5 py-2.5">{[c.shaftMake, c.shaftModel].filter(Boolean).join(' ') || '—'}</td>
                          <td className="px-5 py-2.5">{c.shaftFlex ?? '—'}</td>
                          <td className="px-5 py-2.5">{c.retiredOn ? `Retired ${c.retiredOn}` : c.inBag ? 'In bag' : 'Spare'}</td>
                          <td className="px-5 py-2.5">{c.stats.n + c.stats.excluded}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>
            </div>
          );
        }}
      </QueryView>
      <ClubEditor club={editing} open={editing !== null || adding} onClose={() => (setEditing(null), setAdding(false))} />
    </Page>
  );
}

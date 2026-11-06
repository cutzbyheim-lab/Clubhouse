import { useEffect, useState } from 'react';
import { localDate } from '@shared/domain/dates';
import { Line, LineChart, ResponsiveContainer, YAxis } from 'recharts';
import { CalendarCheck, Plus } from 'lucide-react';
import { PlanCreate, PracticeLogInput, type DrillSummary, type PlanSummary, type PracticeOverview } from '@shared/dto';
import type { DrillCategory } from '@shared/schemas';
import type { AppError } from '@shared/ipc/result';
import { Button } from '@/design/Button';
import { SINGLE } from '@/design/charts';
import { Drawer, Field, Meter, SampleBadge, Segmented, Select, TextInput } from '@/design/controls';
import { Page, Panel } from '@/design/Page';
import { QueryView } from '@/design/QueryView';
import { StatTile } from '@/design/StatTile';
import { mutate, useQuery } from '@/lib/api';

const CATEGORY: Record<DrillCategory, string> = {
  driving: 'Driving',
  full_swing: 'Full swing',
  approach: 'Approach',
  short_game: 'Short game',
  putting: 'Putting',
};
const today = () => localDate();
const niceDate = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

function Sparkline({ drill }: { drill: DrillSummary }) {
  const pts = drill.history.filter((h) => h.result !== null).map((h, i) => ({ i, v: h.result ?? 0 }));
  if (pts.length < 2) return <div className="h-10 text-xs leading-10 text-ink-faint">{pts.length === 1 ? 'One result so far' : 'No results yet'}</div>;
  return (
    <div className="h-10" aria-label={`Results trend: ${pts.map((p) => p.v).join(', ')}`} role="img">
      <ResponsiveContainer>
        <LineChart data={pts} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
          <YAxis hide domain={['dataMin - 1', 'dataMax + 1']} />
          <Line type="linear" dataKey="v" stroke={SINGLE} strokeWidth={2} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function DrillCard({ drill, onLog }: { drill: DrillSummary; onLog: () => void }) {
  const results = drill.history.filter((h) => h.result !== null);
  const last = results.at(-1);
  const best = results.length ? (drill.higherIsBetter ? Math.max(...results.map((r) => r.result ?? 0)) : Math.min(...results.map((r) => r.result ?? 0))) : null;
  return (
    <article className="flex flex-col gap-2 rounded-panel border border-rule bg-raised p-4">
      <div className="flex items-center justify-between text-xs">
        <span className="text-ink-muted">{CATEGORY[drill.category]}</span>
        <SampleBadge show={drill.history.some((h) => h.source === 'sample')} />
      </div>
      <h3 className="figures text-lg font-semibold">{drill.name}</h3>
      <p className="line-clamp-3 text-sm text-ink-muted">{drill.description}</p>
      <Sparkline drill={drill} />
      <div className="flex items-end justify-between text-sm">
        <div className="text-xs text-ink-faint">
          {drill.resultLabel}
          {last && (
            <div className="figures mt-0.5 text-sm text-ink-soft">
              Last <span className="text-ink">{last.result}</span> · best <span className="text-ink">{best}</span>
            </div>
          )}
        </div>
        <Button onClick={onLog}>Log result</Button>
      </div>
    </article>
  );
}

function PlanRow({ plan }: { plan: PlanSummary }) {
  const minutes = plan.items.reduce((s, i) => s + i.minutes, 0);
  const [busy, setBusy] = useState(false);
  const set = async (status: PlanSummary['status']) => {
    setBusy(true);
    await mutate('practice.setPlanStatus', { id: plan.id, status }, { done: status === 'done' ? 'Marked done' : status === 'skipped' ? 'Skipped' : 'Back on the plan' });
    setBusy(false);
  };
  return (
    <li className="flex items-start gap-4 border-b border-rule px-5 py-4 last:border-0">
      <CalendarCheck size={18} className={plan.status === 'planned' ? 'mt-0.5 text-green-speed' : 'mt-0.5 text-ink-faint'} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="figures font-semibold">{plan.name}</span>
          <SampleBadge show={plan.source === 'sample'} />
          {plan.status !== 'planned' && <span className="text-xs text-ink-faint">{plan.status === 'done' ? 'Done' : 'Skipped'}</span>}
        </div>
        <div className="text-sm text-ink-muted">
          {plan.scheduledFor ? niceDate(plan.scheduledFor) : 'Unscheduled'} · {minutes} min{plan.focus ? ` · ${plan.focus}` : ''}
        </div>
        <div className="mt-1 text-xs text-ink-faint">{plan.items.map((i) => `${i.drillName} (${i.minutes})`).join(' · ')}</div>
      </div>
      {plan.status === 'planned' && (
        <div className="flex gap-2">
          <Button busy={busy} onClick={() => void set('skipped')}>
            Skip
          </Button>
          <Button variant="primary" busy={busy} onClick={() => void set('done')}>
            Mark done
          </Button>
        </div>
      )}
    </li>
  );
}

function LogDrawer({ drill, plans, onClose }: { drill: DrillSummary | null; plans: PlanSummary[]; onClose: () => void }) {
  const [date, setDate] = useState(today());
  const [minutes, setMinutes] = useState('20');
  const [result, setResult] = useState('');
  const [planId, setPlanId] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<AppError | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (drill) {
      setDate(today());
      setMinutes('20');
      setResult('');
      setPlanId('');
      setNotes('');
      setError(null);
    }
  }, [drill]);
  if (!drill) return null;
  const save = async () => {
    const parsed = PracticeLogInput.safeParse({
      drillId: drill.id,
      planId: planId === '' ? null : Number(planId),
      performedOn: date,
      minutes: Number(minutes),
      result: result.trim() === '' ? null : Number(result),
      notes: notes.trim() || null,
    });
    if (!parsed.success) return setError({ code: 'VALIDATION', message: parsed.error.issues[0]?.message ?? 'Check the details' });
    setBusy(true);
    const res = await mutate('practice.log', parsed.data, { done: 'Result logged' });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    onClose();
  };
  return (
    <Drawer
      open
      title={`Log: ${drill.name}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={busy} onClick={() => void save()}>
            Save result
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-ink-muted">{drill.description}</p>
        {error && <p className="text-sm text-hazard">{error.message}</p>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date">{(id) => <TextInput id={id} type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} />}</Field>
          <Field label="Minutes">{(id) => <TextInput id={id} inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value)} />}</Field>
        </div>
        <Field label={drill.resultLabel ?? 'Result'} hint="Leave blank if you didn't keep score">
          {(id) => <TextInput id={id} inputMode="decimal" value={result} onChange={(e) => setResult(e.target.value)} />}
        </Field>
        <Field label="Part of a plan">
          {(id) => (
            <Select id={id} value={planId} onChange={(e) => setPlanId(e.target.value)}>
              <option value="">No plan</option>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Notes">{(id) => <TextInput id={id} value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)} />}</Field>
      </div>
    </Drawer>
  );
}

function PlanDrawer({ open, drills, onClose }: { open: boolean; drills: DrillSummary[]; onClose: () => void }) {
  const [name, setName] = useState('');
  const [focus, setFocus] = useState('');
  const [date, setDate] = useState('');
  const [items, setItems] = useState<Record<number, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setName('');
      setFocus('');
      setDate('');
      setItems({});
      setError(null);
    }
  }, [open]);
  const total = Object.values(items).reduce((a, b) => a + b, 0);
  const save = async () => {
    const parsed = PlanCreate.safeParse({
      name,
      focus: focus.trim() || null,
      scheduledFor: date || null,
      items: drills.filter((d) => items[d.id]).map((d) => ({ drillId: d.id, minutes: items[d.id] ?? 0 })),
    });
    if (!parsed.success) return setError(parsed.error.issues[0]?.path[0] === 'items' ? 'Pick at least one drill' : (parsed.error.issues[0]?.message ?? 'Check the plan'));
    setBusy(true);
    const res = await mutate('practice.createPlan', parsed.data, { done: 'Session planned' });
    setBusy(false);
    if (!res.ok) return setError(res.error.message);
    onClose();
  };
  return (
    <Drawer
      open={open}
      title="Plan a session"
      onClose={onClose}
      footer={
        <>
          <span className="figures mr-auto self-center text-sm text-ink-muted">{total} min</span>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={busy} onClick={() => void save()}>
            Save plan
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error && <p className="text-sm text-hazard">{error}</p>}
        <Field label="Name">{(id) => <TextInput id={id} value={name} onChange={(e) => setName(e.target.value)} placeholder="Short game tune-up" maxLength={80} />}</Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Focus">{(id) => <TextInput id={id} value={focus} onChange={(e) => setFocus(e.target.value)} maxLength={200} />}</Field>
          <Field label="Date">{(id) => <TextInput id={id} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
        </div>
        <div>
          <div className="mb-2 text-xs font-medium text-ink-soft">Drills and minutes</div>
          <ul className="flex flex-col gap-2">
            {drills.map((d) => (
              <li key={d.id} className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id={`plan-${d.id}`}
                  checked={items[d.id] !== undefined}
                  onChange={(e) =>
                    setItems((it) => {
                      const next = { ...it };
                      if (e.target.checked) next[d.id] = 15;
                      else delete next[d.id];
                      return next;
                    })
                  }
                  className="h-4 w-4 accent-[#2e6b47]"
                />
                <label htmlFor={`plan-${d.id}`} className="flex-1 text-sm text-ink-soft">
                  {d.name} <span className="text-xs text-ink-faint">{CATEGORY[d.category]}</span>
                </label>
                {items[d.id] !== undefined && (
                  <TextInput
                    aria-label={`Minutes for ${d.name}`}
                    inputMode="numeric"
                    value={items[d.id]}
                    onChange={(e) => setItems((it) => ({ ...it, [d.id]: Number(e.target.value) || 0 }))}
                    className="w-16"
                  />
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Drawer>
  );
}

function Center({ o }: { o: PracticeOverview }) {
  const [logging, setLogging] = useState<DrillSummary | null>(null);
  const [planning, setPlanning] = useState(false);
  const [cat, setCat] = useState<DrillCategory | 'all'>('all');
  const planned = o.plans.filter((p) => p.status === 'planned');
  const past = o.plans.filter((p) => p.status !== 'planned').slice(0, 4);
  const maxMin = Math.max(1, ...o.minutesByCategory.map((m) => m.minutes));
  const drills = o.drills.filter((d) => cat === 'all' || d.category === cat);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-[1fr_1fr_2fr] gap-4">
        <StatTile accent label="Practice, last 30 days" value={String(o.minutesLast30)} unit="min" basis={`${o.logsLast30} drills logged`} />
        <StatTile label="Planned sessions" value={String(planned.length)} basis={planned[0]?.scheduledFor ? `next ${niceDate(planned[0].scheduledFor)}` : 'none scheduled'} />
        <Panel className="px-5 py-4">
          <div className="mb-2 text-sm text-ink-muted">Time by area, last 60 days</div>
          <ul className="grid grid-cols-5 gap-3">
            {o.minutesByCategory.map((m) => (
              <li key={m.category}>
                <div className="text-xs text-ink-soft">{CATEGORY[m.category]}</div>
                <div className="figures text-lg font-semibold">{m.minutes}</div>
                <Meter value={m.minutes} max={maxMin} />
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="figures text-lg font-semibold">Plans</h2>
          <Button variant="primary" onClick={() => setPlanning(true)}>
            <Plus size={15} /> Plan a session
          </Button>
        </div>
        <Panel>
          {planned.length + past.length === 0 ? (
            <p className="px-5 py-6 text-sm text-ink-faint">No practice plans yet. Plan a session around whatever the Intelligence page says is costing you the most.</p>
          ) : (
            <ul>
              {[...planned, ...past].map((p) => (
                <PlanRow key={p.id} plan={p} />
              ))}
            </ul>
          )}
        </Panel>
      </section>

      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="figures text-lg font-semibold">Drill library</h2>
          <Segmented
            label="Filter drills"
            value={cat}
            options={[{ value: 'all' as const, label: 'All' }, ...(Object.keys(CATEGORY) as DrillCategory[]).map((c) => ({ value: c, label: CATEGORY[c] }))]}
            onChange={setCat}
          />
        </div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
          {drills.map((d) => (
            <DrillCard key={d.id} drill={d} onLog={() => setLogging(d)} />
          ))}
        </div>
      </section>

      <LogDrawer drill={logging} plans={planned} onClose={() => setLogging(null)} />
      <PlanDrawer open={planning} drills={o.drills} onClose={() => setPlanning(false)} />
    </div>
  );
}

export default function PracticePage() {
  const overview = useQuery('practice.overview', {});
  return (
    <Page title="Practice center" lede="Plan sessions around your weak spots and log what you actually practised.">
      <QueryView q={overview} label="Loading practice" onRetry={overview.reload}>
        {(o) => <Center o={o} />}
      </QueryView>
    </Page>
  );
}

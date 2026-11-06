import { useEffect, useMemo, useState } from 'react';
import { localDate } from '@shared/domain/dates';
import { Minus, Plus } from 'lucide-react';
import { RoundCreate, ScoreEntry, type CourseSummary } from '@shared/dto';
import { formatToPar } from '@shared/domain/golf';
import { fromDistance } from '@shared/domain/units';
import type { FairwayResult } from '@shared/schemas';
import type { AppError } from '@shared/ipc/result';
import { Button } from '@/design/Button';
import { Field, Segmented, Select, TextInput } from '@/design/controls';
import { Panel } from '@/design/Page';
import { QueryView } from '@/design/QueryView';
import { mutate, useQuery } from '@/lib/api';
import { useUnits } from '@/stores/profile';

function Stepper({ value, onChange, min, max, label }: { value: number | null; onChange: (v: number | null) => void; min: number; max: number; label: string }) {
  return (
    <div className="inline-flex items-center rounded-control border border-rule-strong bg-sunken">
      <button type="button" aria-label={`Decrease ${label}`} className="px-1.5 py-1 text-ink-muted hover:text-ink" onClick={() => onChange(value === null ? null : Math.max(min, value - 1))}>
        <Minus size={13} />
      </button>
      <input
        aria-label={label}
        inputMode="numeric"
        value={value ?? ''}
        onChange={(e) => {
          const n = e.target.value === '' ? null : Number(e.target.value);
          onChange(n === null || Number.isNaN(n) ? null : Math.max(min, Math.min(max, Math.round(n))));
        }}
        className="figures w-8 bg-transparent text-center text-sm text-ink focus:outline-none"
      />
      <button type="button" aria-label={`Increase ${label}`} className="px-1.5 py-1 text-ink-muted hover:text-ink" onClick={() => onChange(value === null ? min : Math.min(max, value + 1))}>
        <Plus size={13} />
      </button>
    </div>
  );
}

interface Row {
  strokes: number | null;
  putts: number | null;
  fairway: FairwayResult | null;
  penalties: number;
  firstPutt: string;
}

const FAIRWAY_OPTIONS: { value: FairwayResult | 'none'; label: string }[] = [
  { value: 'none', label: '—' },
  { value: 'left', label: 'L' },
  { value: 'hit', label: 'Hit' },
  { value: 'right', label: 'R' },
];

function EntryGrid({ courses, onDone, onCancel, onAddCourse }: { courses: CourseSummary[]; onDone: (id: number) => void; onCancel: () => void; onAddCourse: () => void }) {
  const u = useUnits();
  const [courseId, setCourseId] = useState(courses[0]?.id ?? 0);
  const course = courses.find((c) => c.id === courseId) ?? courses[0];
  const [teeId, setTeeId] = useState<number | null>(course?.tees[0]?.id ?? null);
  const [playedOn, setPlayedOn] = useState(() => localDate());
  const [holesPlanned, setHolesPlanned] = useState<9 | 18>(course && course.holes < 18 ? 9 : 18);
  const [startHole, setStartHole] = useState<1 | 10>(1);
  const [conditions, setConditions] = useState('');
  const detail = useQuery('courses.get', { id: courseId }, { enabled: courseId > 0 });
  const [rows, setRows] = useState<Record<number, Row>>({});
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [server, setServer] = useState<AppError | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setTeeId(course?.tees[0]?.id ?? null);
    setRows({});
    if (course && course.holes < 18) setHolesPlanned(9);
  }, [courseId, course]);

  const holes = useMemo(() => {
    if (detail.status !== 'ready') return [];
    const first = holesPlanned === 18 ? 1 : startHole;
    return detail.data.holes.filter((h) => h.number >= first && h.number < first + holesPlanned);
  }, [detail, holesPlanned, startHole]);

  const row = (id: number): Row => rows[id] ?? { strokes: null, putts: null, fairway: null, penalties: 0, firstPutt: '' };
  const setRow = (id: number, patch: Partial<Row>) => setRows((r) => ({ ...r, [id]: { ...row(id), ...patch } }));

  const totalStrokes = holes.reduce((s, h) => s + (row(h.id).strokes ?? 0), 0);
  const totalPar = holes.filter((h) => row(h.id).strokes !== null).reduce((s, h) => s + h.par, 0);
  const filled = holes.filter((h) => row(h.id).strokes !== null).length;

  const save = async () => {
    const errs: Record<number, string> = {};
    const scores = holes.map((h) => {
      const r = row(h.id);
      const entry = {
        holeId: h.id,
        strokes: r.strokes ?? 0,
        putts: r.putts,
        fairway: h.par === 3 ? null : r.fairway,
        penalties: r.penalties,
        sandShots: 0,
        firstPuttM: r.firstPutt.trim() === '' ? null : Math.round(fromDistance(Number(r.firstPutt), u.du === 'yards' ? 'yards' : 'metres') * 10) / 10,
      };
      if (r.strokes === null) errs[h.id] = 'Enter strokes';
      else {
        const p = ScoreEntry.safeParse(entry);
        if (!p.success) errs[h.id] = p.error.issues[0]?.message ?? 'Check this hole';
      }
      return entry;
    });
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    const input = { courseId, teeId, playedOn, holesPlanned, startHole: holesPlanned === 18 ? 1 : startHole, conditions: conditions.trim() || null, notes: null, scores };
    const parsed = RoundCreate.safeParse(input);
    if (!parsed.success) return setServer({ code: 'VALIDATION', message: parsed.error.issues[0]?.message ?? 'Check the round details' });
    setBusy(true);
    const res = await mutate('rounds.create', parsed.data);
    setBusy(false);
    if (!res.ok) return setServer(res.error);
    onDone(res.data.id);
  };

  if (!course) return null;
  return (
    <Panel className="p-6">
      <div className="mb-5 flex items-baseline justify-between">
        <h2 className="figures text-2xl font-semibold">Record a round</h2>
        <button type="button" onClick={onAddCourse} className="text-sm text-green-speed hover:underline">
          Course not listed? Add it
        </button>
      </div>
      <div className="mb-6 grid grid-cols-[2fr_1fr_1fr_auto_2fr] items-end gap-4">
        <Field label="Course">
          {(id) => (
            <Select id={id} value={courseId} onChange={(e) => setCourseId(Number(e.target.value))}>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.source === 'sample' ? ' (sample)' : ''}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Tees">
          {(id) => (
            <Select id={id} value={teeId ?? ''} onChange={(e) => setTeeId(e.target.value === '' ? null : Number(e.target.value))}>
              {course.tees.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Date">{(id) => <TextInput id={id} type="date" value={playedOn} max={localDate()} onChange={(e) => setPlayedOn(e.target.value)} />}</Field>
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-soft">Holes</span>
          <div className="flex gap-2">
            <Segmented
              label="Holes played"
              value={holesPlanned}
              options={course.holes >= 18 ? [{ value: 18, label: '18' }, { value: 9, label: '9' }] : [{ value: 9, label: '9' }]}
              onChange={setHolesPlanned}
            />
            {holesPlanned === 9 && course.holes >= 18 && (
              <Segmented label="Which nine" value={startHole} options={[{ value: 1, label: 'Front' }, { value: 10, label: 'Back' }]} onChange={setStartHole} />
            )}
          </div>
        </div>
        <Field label="Conditions (optional)">{(id) => <TextInput id={id} value={conditions} placeholder="Breezy, firm greens" maxLength={200} onChange={(e) => setConditions(e.target.value)} />}</Field>
      </div>

      <QueryView q={detail} label="Loading holes">
        {() => (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-ink-muted">
              <tr className="border-b border-rule">
                <th className="py-2 font-medium">Hole</th>
                <th className="py-2 font-medium">Par</th>
                <th className="py-2 font-medium">Strokes</th>
                <th className="py-2 font-medium">Putts</th>
                <th className="py-2 font-medium">Tee shot</th>
                <th className="py-2 font-medium">Penalties</th>
                <th className="py-2 font-medium">First putt ({u.du === 'yards' ? 'yd' : 'm'})</th>
                <th className="py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {holes.map((h) => {
                const r = row(h.id);
                return (
                  <tr key={h.id} className="border-b border-rule/60">
                    <td className="figures py-1.5 font-semibold">{h.number}</td>
                    <td className="figures py-1.5 text-ink-muted">{h.par}</td>
                    <td className="py-1.5">
                      <Stepper label={`strokes on hole ${h.number}`} value={r.strokes} min={1} max={20} onChange={(v) => setRow(h.id, { strokes: v })} />
                    </td>
                    <td className="py-1.5">
                      <Stepper label={`putts on hole ${h.number}`} value={r.putts} min={0} max={10} onChange={(v) => setRow(h.id, { putts: v })} />
                    </td>
                    <td className="py-1.5">
                      {h.par === 3 ? (
                        <span className="text-xs text-ink-faint">Par 3</span>
                      ) : (
                        <Segmented label={`Tee shot on hole ${h.number}`} value={r.fairway ?? 'none'} options={FAIRWAY_OPTIONS} onChange={(v) => setRow(h.id, { fairway: v === 'none' ? null : v })} />
                      )}
                    </td>
                    <td className="py-1.5">
                      <Stepper label={`penalties on hole ${h.number}`} value={r.penalties} min={0} max={10} onChange={(v) => setRow(h.id, { penalties: v ?? 0 })} />
                    </td>
                    <td className="py-1.5">
                      <TextInput aria-label={`First putt length on hole ${h.number}`} inputMode="decimal" value={r.firstPutt} onChange={(e) => setRow(h.id, { firstPutt: e.target.value })} className="w-20" />
                    </td>
                    <td className="py-1.5 text-xs text-hazard">{errors[h.id]}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </QueryView>

      <div className="mt-5 flex items-center gap-4">
        <div className="figures text-lg">
          {filled > 0 ? (
            <>
              <span className="font-semibold">{totalStrokes}</span>
              <span className="ml-2 text-ink-muted">{formatToPar(totalStrokes - totalPar)}</span>
              <span className="ml-3 text-sm text-ink-faint">
                {filled} of {holes.length} holes
              </span>
            </>
          ) : (
            <span className="text-sm text-ink-faint">Enter strokes for each hole. Putts and tee shots are optional but power your stats.</span>
          )}
        </div>
        {server && <span className="text-sm text-hazard">{server.message}</span>}
        <span className="ml-auto" />
        <Button onClick={onCancel}>Cancel</Button>
        <Button variant="primary" busy={busy} onClick={() => void save()}>
          Save round
        </Button>
      </div>
    </Panel>
  );
}

export function RoundEntry(props: { onDone: (id: number) => void; onCancel: () => void; onAddCourse: () => void }) {
  const courses = useQuery('courses.list', {});
  return (
    <QueryView q={courses} label="Loading courses" onRetry={courses.reload}>
      {(list) =>
        list.length === 0 ? (
          <Panel className="p-6">
            <h2 className="figures text-xl font-semibold">Add a course first</h2>
            <p className="mt-1 max-w-[60ch] text-ink-muted">Rounds are scored against a course's pars. Copy the pars, stroke index and lengths from its scorecard.</p>
            <div className="mt-4 flex gap-2">
              <Button variant="primary" onClick={props.onAddCourse}>
                Add a course
              </Button>
              <Button onClick={props.onCancel}>Cancel</Button>
            </div>
          </Panel>
        ) : (
          <EntryGrid courses={list} {...props} />
        )
      }
    </QueryView>
  );
}

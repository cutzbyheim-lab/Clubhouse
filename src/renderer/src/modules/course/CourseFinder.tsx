import { useEffect, useState } from 'react';
import { ArrowLeft, Check, Droplets, Flag, MapPin, Mountain, ScanSearch, Search } from 'lucide-react';
import { CourseImport, type CoursePreview, type CourseSearchResult } from '@shared/dto';
import { fromDistance } from '@shared/domain/units';
import type { AppError } from '@shared/ipc/result';
import { Button } from '@/design/Button';
import { Drawer, Field, Select, TextInput } from '@/design/controls';
import { ErrorState, LoadingState } from '@/design/StateViews';
import { call, mutate } from '@/lib/api';
import { useUnits } from '@/stores/profile';
import { CourseMap } from './CourseMap';

interface Row {
  key: string;
  include: boolean;
  number: string;
  par: string;
  si: string;
  length: string;
}

type Step =
  | { kind: 'search' }
  | { kind: 'loading'; target: CourseSearchResult }
  | { kind: 'preview'; preview: CoursePreview }
  | { kind: 'error'; error: AppError; target: CourseSearchResult };

function SearchStep({ onPick, onManual }: { onPick: (r: CourseSearchResult) => void; onManual: () => void }) {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<CourseSearchResult[] | null>(null);
  const [error, setError] = useState<AppError | null>(null);

  const run = async () => {
    if (q.trim().length < 2) return;
    setBusy(true);
    setError(null);
    const res = await call('courses.search', { query: q.trim() });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setResults(res.data);
  };

  return (
    <div className="flex flex-col gap-4">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <TextInput autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Course name, e.g. Chambers Bay" aria-label="Course name" maxLength={100} />
        <Button type="submit" variant="primary" busy={busy}>
          <Search size={15} /> Search
        </Button>
      </form>
      {error && <ErrorState error={error} onRetry={() => void run()} />}
      {busy && <LoadingState label="Searching for courses" />}
      {results && !busy && (
        results.length === 0 ? (
          <div className="rounded-panel border border-rule p-5 text-sm text-ink-muted">
            No golf courses matched "{q}". Try the name as it appears on the course's sign, or add the city.
          </div>
        ) : (
          <ul className="flex flex-col divide-y divide-rule rounded-panel border border-rule">
            {results.map((r) => (
              <li key={`${r.osm.type}${r.osm.id}`}>
                <button type="button" disabled={r.alreadyImported} onClick={() => onPick(r)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-overlay disabled:cursor-default disabled:hover:bg-transparent">
                  <MapPin size={16} className="shrink-0 text-green-speed" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="figures block truncate font-semibold text-ink">{r.name}</span>
                    <span className="block truncate text-xs text-ink-muted">{r.place}</span>
                  </span>
                  {r.alreadyImported && <span className="text-xs text-ink-faint">Already in your courses</span>}
                </button>
              </li>
            ))}
          </ul>
        )
      )}
      <p className="text-xs text-ink-faint">
        Course data comes from OpenStreetMap, which volunteers map hole by hole, so some courses have full layouts and others only an outline.{' '}
        <button type="button" onClick={onManual} className="text-green-speed hover:underline">
          Enter a course by hand instead
        </button>
      </p>
    </div>
  );
}

const VERDICT = {
  match: { label: 'Matches', cls: 'text-green-speed border-green-speed/40' },
  partial: { label: 'Partly', cls: 'text-brass border-brass/40' },
  mismatch: { label: "Doesn't match", cls: 'text-hazard border-hazard/40' },
  unchecked: { label: 'Not checked', cls: 'text-ink-faint border-rule' },
} as const;

function VerdictChip({ verdict, title }: { verdict: keyof typeof VERDICT; title: string }) {
  return (
    <span title={title} className={`inline-block rounded-full border px-2 py-px text-[11px] whitespace-nowrap ${VERDICT[verdict].cls}`}>
      {VERDICT[verdict].label}
    </span>
  );
}

function PhotoCheckBanner({ preview }: { preview: CoursePreview }) {
  const u = useUnits();
  const pc = preview.photoCheck;
  const bad = preview.holes.some((h) => h.geometry.check?.verdict === 'mismatch');
  const tone = !pc.available ? 'border-rule bg-sunken' : bad ? 'border-brass/40 bg-brass/5' : 'border-green-speed/30 bg-fairway-deep/30';
  const feet = u.du === 'yards';
  return (
    <div className={`flex flex-col gap-1.5 rounded-control border px-4 py-3 text-sm ${tone}`}>
      <div className="flex items-start gap-2 text-ink-soft">
        <ScanSearch size={16} className="mt-0.5 shrink-0 text-green-speed" aria-hidden />
        <span>{pc.summary}</span>
      </div>
      <div className="flex items-start gap-2 text-ink-soft">
        <Mountain size={16} className="mt-0.5 shrink-0 text-green-speed" aria-hidden />
        <span>
          {preview.terrain.available
            ? `Real terrain measured from elevation data: ${Math.round((preview.terrain.reliefM ?? 0) * (feet ? 3.2808 : 1))} ${feet ? 'ft' : 'm'} of elevation change across the course.`
            : 'No elevation data for this area, so holes are shown on flat ground.'}
        </span>
      </div>
      {pc.available && <p className="pl-6 text-xs text-ink-faint">The photo check compares the colours under each mapped bunker and water hazard with the aerial photo. It's a quick check, not a survey.</p>}
    </div>
  );
}

function PreviewStep({ preview, onBack, onImported }: { preview: CoursePreview; onBack: () => void; onImported: (id: number) => void }) {
  const u = useUnits();
  const [rows, setRows] = useState<Row[]>(() => {
    const count = preview.holes.length;
    return preview.holes.map((h, i) => ({
      key: h.key,
      include: count === 9 || count === 18 ? true : i < (count >= 18 ? 18 : 9),
      number: h.number ? String(h.number) : '',
      par: h.par ? String(h.par) : '',
      si: h.strokeIndex ? String(h.strokeIndex) : '',
      length: h.lengthM ? String(Math.round(u.d(h.lengthM))) : '',
    }));
  });
  const [name, setName] = useState(preview.name);
  const [teeName, setTeeName] = useState('White');
  const [rating, setRating] = useState('');
  const [slope, setSlope] = useState('');
  const [hover, setHover] = useState<string | null>(null);
  const [showPhoto, setShowPhoto] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const chosen = rows.filter((r) => r.include);
  const labels = Object.fromEntries(rows.map((r) => [r.key, r.number || '?']));
  const totalPar = chosen.reduce((s, r) => s + (Number(r.par) || 0), 0);
  const num = (s: string) => (s.trim() === '' ? null : Number(s));

  const doImport = async () => {
    setError(null);
    const holes = chosen.map((r) => {
      const h = preview.holes.find((x) => x.key === r.key)!;
      const len = num(r.length);
      return {
        key: r.key,
        number: Number(r.number),
        par: Number(r.par),
        strokeIndex: num(r.si),
        lengthM: len === null ? null : Math.round(fromDistance(len, u.du) * 10) / 10,
        geometry: h.geometry,
      };
    });
    if (holes.some((h) => !h.number)) return setError('Give every ticked hole a number.');
    if (holes.some((h) => !h.par)) return setError('Every ticked hole needs a par.');
    const parsed = CourseImport.safeParse({
      osm: preview.osm,
      name,
      location: preview.place || null,
      tee: { name: teeName, courseRating: num(rating), slopeRating: num(slope) },
      holes,
    });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Check the holes and try again.');
    setBusy(true);
    const res = await mutate('courses.import', parsed.data);
    setBusy(false);
    if (!res.ok) return setError(res.error.message);
    onImported(res.data.id);
  };

  const totals = {
    greens: preview.holes.filter((h) => h.has.green).length,
    bunkers: preview.holes.reduce((s, h) => s + h.has.bunkers, 0),
    water: new Set(preview.holes.filter((h) => h.has.water > 0).map((h) => h.key)).size,
  };

  return (
    <div className="flex flex-col gap-5">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1 self-start text-sm text-ink-muted hover:text-ink">
        <ArrowLeft size={14} /> Back to results
      </button>
      <div>
        <h3 className="figures text-2xl font-semibold">{preview.name}</h3>
        <p className="text-sm text-ink-muted">{preview.place}</p>
      </div>

      {preview.holes.length === 0 ? (
        <div className="rounded-panel border border-rule p-5 text-sm text-ink-muted">{preview.notes[0]}</div>
      ) : (
        <>
          <CourseMap overview={preview.overview} labels={labels} highlight={hover} photo={showPhoto ? preview.photo : null} />
          {preview.photo && (
            <div className="-mt-2 flex items-center justify-between text-xs text-ink-muted">
              <span>{showPhoto ? 'Aerial photo with the map traced on top: outlines should sit on the real features.' : 'Map only.'}</span>
              <button type="button" onClick={() => setShowPhoto((v) => !v)} className="text-green-speed hover:underline">
                {showPhoto ? 'Show map only' : 'Show aerial photo'}
              </button>
            </div>
          )}
          <PhotoCheckBanner preview={preview} />
          <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-ink-soft">
            <li><span className="figures text-ink">{preview.holes.length}</span> holes mapped</li>
            <li><span className="figures text-ink">{totals.greens}</span> greens</li>
            <li><span className="figures text-ink">{totals.bunkers}</span> bunkers</li>
            <li>water on <span className="figures text-ink">{totals.water}</span> holes</li>
          </ul>
          {preview.notes.length > 0 && (
            <ul className="flex flex-col gap-1 rounded-control border border-brass/30 bg-brass/5 px-4 py-3 text-sm text-ink-soft">
              {preview.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Course name">{(id) => <TextInput id={id} value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />}</Field>
            <div className="grid grid-cols-3 gap-2">
              <Field label="Tees">{(id) => <TextInput id={id} value={teeName} onChange={(e) => setTeeName(e.target.value)} maxLength={40} />}</Field>
              <Field label="Rating">{(id) => <TextInput id={id} inputMode="decimal" value={rating} placeholder="Optional" onChange={(e) => setRating(e.target.value)} />}</Field>
              <Field label="Slope">{(id) => <TextInput id={id} inputMode="numeric" value={slope} placeholder="Optional" onChange={(e) => setSlope(e.target.value)} />}</Field>
            </div>
          </div>
          <p className="-mt-2 text-xs text-ink-faint">
            Lengths below are measured along each hole's mapped line of play. Replace them with your scorecard yardages for the tees you play.
          </p>

          <table className="w-full text-sm">
            <thead className="text-left text-xs text-ink-muted">
              <tr className="border-b border-rule">
                <th className="py-2 pr-2 font-medium">Use</th>
                <th className="py-2 pr-2 font-medium">Hole</th>
                <th className="py-2 pr-2 font-medium">Par</th>
                <th className="py-2 pr-2 font-medium">Stroke index</th>
                <th className="py-2 pr-2 font-medium">Length ({u.dSuffix})</th>
                <th className="py-2 pr-2 font-medium">On the map</th>
                <th className="py-2 font-medium">Photo check</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const h = preview.holes.find((x) => x.key === r.key)!;
                return (
                  <tr key={r.key} onMouseEnter={() => setHover(r.key)} onMouseLeave={() => setHover(null)} className={`border-b border-rule/60 ${r.include ? '' : 'opacity-45'}`}>
                    <td className="py-1.5 pr-2">
                      <input type="checkbox" checked={r.include} onChange={(e) => set(r.key, { include: e.target.checked })} aria-label={`Include hole ${r.number || '?'}`} className="h-4 w-4 accent-[#2e6b47]" />
                    </td>
                    <td className="py-1.5 pr-2">
                      <TextInput aria-label="Hole number" inputMode="numeric" value={r.number} onChange={(e) => set(r.key, { number: e.target.value })} className="w-14" />
                    </td>
                    <td className="py-1.5 pr-2">
                      <Select aria-label="Par" value={r.par} onChange={(e) => set(r.key, { par: e.target.value })} className={`w-16 ${r.par ? '' : 'border-brass'}`}>
                        <option value="">—</option>
                        {[3, 4, 5, 6].map((p) => (
                          <option key={p} value={p}>
                            {p}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td className="py-1.5 pr-2">
                      <TextInput aria-label="Stroke index" inputMode="numeric" value={r.si} onChange={(e) => set(r.key, { si: e.target.value })} className="w-14" />
                    </td>
                    <td className="py-1.5 pr-2">
                      <TextInput aria-label="Length" inputMode="numeric" value={r.length} onChange={(e) => set(r.key, { length: e.target.value })} className="w-20" />
                    </td>
                    <td className="py-1.5">
                      <span className="flex items-center gap-2 text-xs text-ink-muted">
                        <span title={h.has.green ? 'Green mapped' : 'No green mapped'} className={h.has.green ? 'text-green-speed' : 'text-ink-faint'}>
                          <Flag size={13} aria-label={h.has.green ? 'Green mapped' : 'No green'} />
                        </span>
                        {h.has.fairway && <Check size={13} className="text-green-speed" aria-label="Fairway mapped" />}
                        {h.has.bunkers > 0 && <span className="figures">{h.has.bunkers} bunker{h.has.bunkers === 1 ? '' : 's'}</span>}
                        {h.has.water > 0 && <Droplets size={13} className="text-[#5b9ccc]" aria-label="Water" />}
                      </span>
                    </td>
                    <td className="py-1.5">
                      <VerdictChip verdict={h.geometry.check?.verdict ?? 'unchecked'} title={h.geometry.check?.detail ?? ''} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="flex items-center gap-3">
            <span className="figures text-sm text-ink-muted">
              {chosen.length} holes · par {totalPar}
            </span>
            {error && <span className="text-sm text-hazard">{error}</span>}
            <span className="ml-auto" />
            <Button variant="primary" busy={busy} onClick={() => void doImport()}>
              Add course
            </Button>
          </div>
        </>
      )}
      <p className="border-t border-rule pt-3 text-xs text-ink-faint">{preview.credits.join(' · ')}</p>
    </div>
  );
}

/** Find a real course on OpenStreetMap, check its data, and add it. */
export function CourseFinder({ open, onClose, onImported, onManual }: { open: boolean; onClose: () => void; onImported: (id: number) => void; onManual: () => void }) {
  const [step, setStep] = useState<Step>({ kind: 'search' });
  useEffect(() => {
    if (open) setStep({ kind: 'search' });
  }, [open]);

  const load = async (target: CourseSearchResult) => {
    setStep({ kind: 'loading', target });
    const { alreadyImported: _ignored, ...rest } = target;
    const res = await call('courses.preview', rest);
    setStep(res.ok ? { kind: 'preview', preview: res.data } : { kind: 'error', error: res.error, target });
  };

  return (
    <Drawer open={open} title="Find a course" onClose={onClose} width={780}>
      {step.kind === 'search' && (
        <SearchStep
          onPick={(r) => void load(r)}
          onManual={() => {
            onClose();
            onManual();
          }}
        />
      )}
      {step.kind === 'loading' && (
        <div>
          <p className="figures text-lg font-semibold">{step.target.name}</p>
          <p className="text-sm text-ink-muted">Loading the course map. Large courses can take up to half a minute.</p>
          <LoadingState label="Loading course map" />
        </div>
      )}
      {step.kind === 'error' && (
        <div className="flex flex-col gap-3">
          <button type="button" onClick={() => setStep({ kind: 'search' })} className="inline-flex items-center gap-1 self-start text-sm text-ink-muted hover:text-ink">
            <ArrowLeft size={14} /> Back to search
          </button>
          <ErrorState error={step.error} onRetry={() => void load(step.target)} />
        </div>
      )}
      {step.kind === 'preview' && (
        <PreviewStep
          preview={step.preview}
          onBack={() => setStep({ kind: 'search' })}
          onImported={(id) => {
            onClose();
            onImported(id);
          }}
        />
      )}
    </Drawer>
  );
}

import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Search } from 'lucide-react';
import { Button, Spinner } from '@/design/Button';
import { CourseFinder } from './CourseFinder';
import type { CourseDetail, HoleTrack } from '@shared/dto';
import type { HoleGeometry } from '@shared/schemas';
import { ShieldAlert, ShieldCheck, ShieldQuestion, ShieldX } from 'lucide-react';
import { formatToPar } from '@shared/domain/golf';
import { CAT } from '@/design/charts';
import { SampleBadge, Select } from '@/design/controls';
import { ScoreMark } from '@/design/golf';
import { Page, Panel } from '@/design/Page';
import { QueryView } from '@/design/QueryView';
import { LoadingState } from '@/design/StateViews';
import { EmptyState } from '@/design/StateViews';
import { mutate, useQuery } from '@/lib/api';
import { useUnits } from '@/stores/profile';

const HoleViewer = lazy(() => import('./HoleViewer').then((m) => ({ default: m.HoleViewer })));
const shortDate = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const MAX_TRACKS = 4;

const CHECK_META = {
  match: { label: 'Matches the aerial photo', cls: 'text-green-speed', Icon: ShieldCheck },
  partial: { label: 'Partly matches the photo', cls: 'text-brass', Icon: ShieldAlert },
  mismatch: { label: "Doesn't match the photo", cls: 'text-hazard', Icon: ShieldX },
  unchecked: { label: 'Not checked against a photo', cls: 'text-ink-faint', Icon: ShieldQuestion },
} as const;

function PhotoCheck({ check }: { check: NonNullable<HoleGeometry['check']> }) {
  const m = CHECK_META[check.verdict];
  return (
    <div className="mt-3 border-t border-rule pt-3">
      <div className={`flex items-center gap-1.5 text-sm font-medium ${m.cls}`}>
        <m.Icon size={15} aria-hidden /> {m.label}
      </div>
      <p className="mt-1 text-xs text-ink-muted">{check.detail}</p>
    </div>
  );
}

/** Measured height of the green relative to the tee, and the hole's total relief. */
function Terrain({ geometry }: { geometry: HoleGeometry }) {
  const u = useUnits();
  const e = geometry.elevation;
  if (!e) return null;
  const feet = u.du === 'yards';
  const fmt = (m: number) => `${Math.round(Math.abs(feet ? m * 3.2808 : m))} ${feet ? 'ft' : 'm'}`;
  const rel = geometry.greenElevationM;
  const relief = Math.max(...e.heights) - Math.min(...e.heights);
  return (
    <>
      <dt className="text-ink-muted">Green vs tee</dt>
      <dd className="figures text-ink">{Math.abs(rel) < 0.5 ? 'Level' : `${fmt(rel)} ${rel > 0 ? 'uphill' : 'downhill'}`}</dd>
      <dt className="text-ink-muted">Elevation change</dt>
      <dd className="figures text-ink">{fmt(relief)}</dd>
    </>
  );
}

function HolePanel({ course, holeIdx, preferRound }: { course: CourseDetail; holeIdx: number; preferRound: number | null }) {
  const u = useUnits();
  const hole = course.holes[holeIdx];
  const record = useQuery('courses.holeRecord', { holeId: hole?.id ?? 0 }, { enabled: !!hole });
  const wantsPhoto = !!hole?.geometry?.imageryBounds;
  const imagery = useQuery('courses.holeImagery', { holeId: hole?.id ?? 0 }, { enabled: wantsPhoto });
  const photo = imagery.status === 'ready' || imagery.status === 'empty' ? imagery.data : null;
  const [chosen, setChosen] = useState<number[] | null>(null);

  const tracks = record.status === 'ready' || record.status === 'empty' ? record.data.tracks : [];
  const visibleIds = chosen ?? (preferRound && tracks.some((t) => t.roundId === preferRound) ? [preferRound] : tracks.slice(0, 1).map((t) => t.roundId));
  // Colour follows the round, not its position in the visible set.
  const colorOf = (roundId: number) => CAT[Math.max(0, tracks.findIndex((t) => t.roundId === roundId)) % CAT.length] ?? CAT[0];
  const visible = useMemo(
    () => tracks.filter((t) => visibleIds.includes(t.roundId)).map((t) => ({ track: t, color: colorOf(t.roundId) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tracks, visibleIds.join(',')],
  );
  const markers = useMemo(() => {
    const step = u.du === 'yards' ? 0.9144 : 1;
    return [100, 150, 200, 250].map((v) => ({ m: v * step, label: `${v}` }));
  }, [u.du]);

  if (!hole) return null;
  const toggle = (id: number) => {
    const cur = visibleIds;
    setChosen(cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id].slice(-MAX_TRACKS));
  };
  const lengths = course.tees.map((t) => ({ tee: t.name, m: hole.lengthsM[String(t.id)] ?? null }));
  const primary: HoleTrack | undefined = visible[0]?.track;

  return (
    <div className="grid h-[calc(100vh-250px)] min-h-[560px] grid-cols-[minmax(0,1fr)_300px] gap-6">
      <Panel className="relative overflow-hidden">
        {hole.geometry && wantsPhoto && imagery.status === 'loading' ? (
          <LoadingState shape="block" label="Loading aerial photo" />
        ) : hole.geometry ? (
          <>
            <Suspense fallback={<LoadingState shape="block" label="Preparing 3D view" />}>
              <HoleViewer geometry={hole.geometry} holeNumber={hole.number} tracks={visible} markers={markers} photoUrl={photo?.dataUrl ?? null} />
            </Suspense>
            {course.attribution && (
              <span className="pointer-events-none absolute right-3 bottom-3 max-w-[60%] rounded-control bg-ground/80 px-2 py-1 text-right text-[11px] leading-snug text-ink-muted">
                {[course.attribution, photo?.attribution, hole.geometry.elevation?.source].filter(Boolean).join(' · ')}
              </span>
            )}
          </>
        ) : (
          <EmptyState title="No layout for this hole">
            <p>
              The 3D view draws holes from real layout data. Courses you add from a scorecard have pars and lengths but no layout, so Clubhouse
              doesn't invent one. Your scores for this hole are still on the right.
            </p>
          </EmptyState>
        )}
      </Panel>

      <aside className="flex min-h-0 flex-col gap-4 overflow-y-auto">
        <Panel className="p-5">
          <div className="flex items-baseline justify-between">
            <h2 className="figures text-3xl font-semibold">Hole {hole.number}</h2>
            <span className="figures text-lg text-ink-muted">Par {hole.par}</span>
          </div>
          <dl className="mt-3 grid grid-cols-[1fr_auto] gap-y-1.5 text-sm">
            {lengths.map((l) => (
              <div key={l.tee} className="contents">
                <dt className="text-ink-muted">{l.tee} tees</dt>
                <dd className="figures text-ink">{u.dist(l.m)}</dd>
              </div>
            ))}
            {hole.strokeIndex !== null && (
              <>
                <dt className="text-ink-muted">Stroke index</dt>
                <dd className="figures text-ink">{hole.strokeIndex}</dd>
              </>
            )}
            {hole.geometry?.elevation && <Terrain geometry={hole.geometry} />}
            {hole.geometry?.photoTrees && (
              <>
                <dt className="text-ink-muted" title="Positions and crown sizes come from the aerial photo; heights are estimated from crown size.">
                  Trees in photo
                </dt>
                <dd className="figures text-ink">{hole.geometry.photoTrees.length.toLocaleString()}</dd>
              </>
            )}
          </dl>
          {hole.geometry?.check && <PhotoCheck check={hole.geometry.check} />}
          <QueryView q={record} label="Loading scores">
            {(r) =>
              r.played === 0 ? (
                <p className="mt-3 border-t border-rule pt-3 text-sm text-ink-faint">Not played yet.</p>
              ) : (
                <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-rule pt-3 text-center">
                  <div>
                    <dt className="text-xs text-ink-muted">Played</dt>
                    <dd className="figures text-xl font-semibold">{r.played}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-ink-muted">Average</dt>
                    <dd className="figures text-xl font-semibold">{r.avgStrokes?.toFixed(2)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-ink-muted">Best</dt>
                    <dd className="figures text-xl font-semibold">{r.bestStrokes}</dd>
                  </div>
                </dl>
              )
            }
          </QueryView>
        </Panel>

        <Panel className="p-5">
          <h3 className="figures mb-1 text-lg font-semibold">Shot tracks</h3>
          <p className="mb-3 text-xs text-ink-muted">Rounds where shots were tracked on this hole. Show up to {MAX_TRACKS} at once.</p>
          {tracks.length === 0 ? (
            <p className="text-sm text-ink-faint">No tracked shots on this hole.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {tracks.map((t) => {
                const on = visibleIds.includes(t.roundId);
                return (
                  <li key={t.roundId}>
                    <label className="flex cursor-pointer items-center gap-3 rounded-control px-2 py-1.5 hover:bg-overlay">
                      <input type="checkbox" checked={on} onChange={() => toggle(t.roundId)} className="sr-only" />
                      <span
                        className="inline-block h-3 w-3 rounded-full border-2"
                        style={{ borderColor: colorOf(t.roundId), background: on ? colorOf(t.roundId) : 'transparent' }}
                        aria-hidden
                      />
                      <span className="flex-1 text-sm text-ink-soft">{shortDate(t.playedOn)}</span>
                      <ScoreMark strokes={t.strokes} par={t.par} />
                      <span className="figures w-6 text-right text-xs text-ink-muted">{formatToPar(t.strokes - t.par)}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        {primary && (
          <Panel className="p-5">
            <h3 className="figures mb-2 text-lg font-semibold">
              <span className="mr-2 inline-block h-2.5 w-2.5 rounded-full" style={{ background: colorOf(primary.roundId) }} aria-hidden />
              {shortDate(primary.playedOn)}, shot by shot
            </h3>
            <ol className="flex flex-col gap-1 text-sm">
              {primary.shots.map((s, i) => (
                <li key={s.seq} className="grid grid-cols-[18px_1fr_auto] gap-2">
                  <span className="figures text-ink-faint">{i + 1}</span>
                  <span className="text-ink-soft">
                    {s.club}
                    {s.lie && s.lie !== 'tee' && <span className="text-ink-faint"> · from {s.lie}</span>}
                  </span>
                  <span className="figures text-ink">{u.dist(s.distanceM)}</span>
                </li>
              ))}
            </ol>
          </Panel>
        )}
      </aside>
    </div>
  );
}

/** Courses added before tree detection get their trees found from the photos they already have. */
function useTreeSearch(course: CourseDetail | null): { searching: boolean; error: string | null } {
  const [state, setState] = useState<{ searching: boolean; error: string | null }>({ searching: false, error: null });
  const tried = useRef(new Set<number>());
  const needs = !!course?.holes.some((h) => h.geometry?.source === 'map' && h.geometry.imageryBounds && h.geometry.photoTrees === undefined);
  useEffect(() => {
    if (!course || !needs || tried.current.has(course.id)) return;
    tried.current.add(course.id);
    setState({ searching: true, error: null });
    void mutate('courses.detectTrees', { courseId: course.id }, { done: (r) => (r.trees > 0 ? `Found ${r.trees.toLocaleString()} trees` : 'No trees found in the photos') }).then((res) =>
      setState({ searching: false, error: res.ok ? null : res.error.message }),
    );
  }, [course, needs]);
  return state;
}

function CourseView({ courseId, preferRound }: { courseId: number; preferRound: number | null }) {
  const course = useQuery('courses.get', { id: courseId });
  const [holeIdx, setHoleIdx] = useState(0);
  const trees = useTreeSearch(course.status === 'ready' ? course.data : null);
  return (
    <QueryView q={course} label="Loading course" onRetry={course.reload}>
      {(c) => (
        <div className="flex flex-col gap-4">
          {(trees.searching || trees.error) && (
            <p role="status" className={`flex items-center gap-2 text-sm ${trees.error ? 'text-hazard' : 'text-ink-muted'}`}>
              {trees.searching && <Spinner />}
              {trees.error ?? 'Finding trees in this course’s aerial photos…'}
            </p>
          )}
          <div role="tablist" aria-label="Hole" className="flex gap-1 overflow-x-auto pb-1">
            {c.holes.map((h, i) => (
              <button
                key={h.id}
                role="tab"
                type="button"
                aria-selected={i === holeIdx}
                onClick={() => setHoleIdx(i)}
                className={`flex min-w-[46px] flex-col items-center rounded-control border px-2 py-1 transition-colors ${
                  i === holeIdx ? 'border-green-speed bg-fairway-deep text-ink' : 'border-rule text-ink-soft hover:border-rule-strong'
                }`}
              >
                <span className="figures text-base font-semibold">{h.number}</span>
                <span className="text-[10px] text-ink-faint">Par {h.par}</span>
              </button>
            ))}
          </div>
          <HolePanel key={`${c.id}-${holeIdx}`} course={c} holeIdx={holeIdx} preferRound={preferRound} />
        </div>
      )}
    </QueryView>
  );
}

export default function CoursePage() {
  const courses = useQuery('courses.list', {}, { isEmpty: (l) => l.length === 0 });
  const [params, setParams] = useSearchParams();
  const [finding, setFinding] = useState(false);
  const navigate = useNavigate();
  const preferRound = params.get('round') ? Number(params.get('round')) : null;
  const findButton = (
    <Button variant="primary" onClick={() => setFinding(true)}>
      <Search size={15} /> Find a course
    </Button>
  );
  return (
    <Page title="Course visualizer" lede="Walk each hole in 3D with your recorded shots laid over it." actions={findButton}>
      <CourseFinder
        open={finding}
        onClose={() => setFinding(false)}
        onImported={(id) => setParams({ course: String(id) })}
        onManual={() => void navigate('/rounds?new=1')}
      />
      <QueryView
        q={courses}
        label="Loading courses"
        onRetry={courses.reload}
        empty={{
          art: 'contours',
          title: 'No courses yet',
          body: <p>Search for a real course to see its holes in 3D, or load the sample data to explore a demo course.</p>,
          action: findButton,
        }}
      >
        {(list) => {
          const selected = list.find((c) => c.id === Number(params.get('course'))) ?? list[0]!;
          return (
            <div className="flex flex-col gap-4">
              {list.length > 1 && (
                <div className="flex items-center gap-3">
                  <Select aria-label="Course" value={selected.id} onChange={(e) => setParams({ course: e.target.value })} className="max-w-[320px]">
                    {list.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                </div>
              )}
              <div className="flex items-center gap-2 text-sm text-ink-muted">
                <span className="figures text-ink">{selected.name}</span>
                {selected.location && <span>· {selected.location}</span>}
                <span>
                  · Par {selected.par} · {selected.rounds} round{selected.rounds === 1 ? '' : 's'}
                </span>
                <SampleBadge show={selected.source === 'sample'} />
              </div>
              <CourseView key={selected.id} courseId={selected.id} preferRound={preferRound} />
            </div>
          );
        }}
      </QueryView>
    </Page>
  );
}

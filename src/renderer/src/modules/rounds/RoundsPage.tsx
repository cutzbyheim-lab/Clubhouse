import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Mountain, Plus } from 'lucide-react';
import type { RoundSummary } from '@shared/dto';
import { formatToPar } from '@shared/domain/golf';
import { Button } from '@/design/Button';
import { SampleBadge } from '@/design/controls';
import { ToPar } from '@/design/golf';
import { Page, Panel } from '@/design/Page';
import { QueryView } from '@/design/QueryView';
import { StatTile } from '@/design/StatTile';
import { EmptyState } from '@/design/StateViews';
import { mutate, useQuery } from '@/lib/api';
import { CourseEditor } from './CourseEditor';
import { RoundEntry } from './RoundEntry';
import { ScoreMixBar, Scorecard } from './Scorecard';

const longDate = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' });
const shortDate = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

function RoundList({ rounds, selected, onSelect }: { rounds: RoundSummary[]; selected: number; onSelect: (id: number) => void }) {
  const max = Math.max(...rounds.map((r) => r.strokes - r.par), 1);
  return (
    <Panel className="overflow-hidden">
      <ul className="max-h-[calc(100vh-220px)] overflow-y-auto">
        {rounds.map((r) => {
          const rel = r.strokes - r.par;
          return (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => onSelect(r.id)}
                aria-current={r.id === selected}
                className={`grid w-full grid-cols-[1fr_auto] gap-1 border-b border-rule px-4 py-3 text-left last:border-0 ${
                  r.id === selected ? 'bg-fairway-deep/70 shadow-[inset_2px_0_0_var(--color-green-speed)]' : 'hover:bg-overlay'
                }`}
              >
                <span className="flex items-center gap-2 text-sm text-ink-soft">
                  {shortDate(r.playedOn)}
                  <SampleBadge show={r.source === 'sample'} />
                </span>
                <span className="figures row-span-2 self-center text-right">
                  <span className="text-xl font-semibold text-ink">{r.strokes}</span>
                  <span className="block text-xs text-ink-muted">{formatToPar(rel)}</span>
                </span>
                <span className="truncate text-xs text-ink-faint">
                  {r.courseName}
                  {r.holesPlayed < 18 ? ` · ${r.holesPlayed} holes` : ''}
                </span>
                <span className="col-span-2 mt-1 h-1 rounded-full bg-sunken">
                  <span className="block h-full rounded-full bg-[#e0875f]/70" style={{ width: `${Math.max(2, (Math.max(0, rel) / max) * 100)}%` }} />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

function RoundView({ id }: { id: number }) {
  const round = useQuery('rounds.get', { id });
  const [confirm, setConfirm] = useState(false);
  const [, setParams] = useSearchParams();
  return (
    <QueryView q={round} label="Loading round" onRetry={round.reload}>
      {(r) => {
        const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}` : null);
        return (
          <div className="flex flex-col gap-5">
            <div className="flex items-end justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 text-sm text-ink-muted">
                  {longDate(r.playedOn)} <SampleBadge show={r.source === 'sample'} />
                </div>
                <h2 className="figures text-2xl font-semibold">
                  {r.courseName}
                  {r.teeName && <span className="ml-2 text-base font-normal text-ink-muted">{r.teeName} tees</span>}
                </h2>
                {r.conditions && <p className="text-sm text-ink-faint">{r.conditions}</p>}
              </div>
              <div className="flex items-center gap-2">
                {r.hasShots && (
                  <Link to={`/course?course=${r.courseId}&round=${r.id}`} className="inline-flex items-center gap-2 rounded-control border border-rule-strong px-3.5 py-1.5 text-sm text-ink-soft hover:bg-overlay hover:text-ink">
                    <Mountain size={15} /> See shots in 3D
                  </Link>
                )}
                {confirm ? (
                  <>
                    <span className="text-sm text-ink-muted">Delete this round?</span>
                    <Button
                      variant="danger"
                      onClick={async () => {
                        const res = await mutate('rounds.delete', { id: r.id });
                        if (res.ok) setParams({});
                      }}
                    >
                      Delete
                    </Button>
                    <Button onClick={() => setConfirm(false)}>Keep</Button>
                  </>
                ) : (
                  <Button variant="quiet" onClick={() => setConfirm(true)}>
                    Delete
                  </Button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-5 gap-3">
              <StatTile accent label="Score" value={String(r.strokes)} basis={<ToPar strokes={r.strokes} par={r.par} />} />
              <StatTile label="Putts" value={r.putts === null ? null : String(r.putts)} basis={`${r.puttsHoles} holes recorded`} emptyReason="Not recorded" />
              <StatTile label="Greens in regulation" value={pct(r.gir, r.girHoles)} unit="%" basis={`${r.gir} of ${r.girHoles}`} emptyReason="Needs putts" />
              <StatTile label="Fairways" value={pct(r.fairways, r.fairwayHoles)} unit="%" basis={`${r.fairways} of ${r.fairwayHoles}`} emptyReason="Not recorded" />
              <StatTile label="Penalties" value={String(r.penalties)} basis="strokes" />
            </div>

            <Panel className="p-5">
              <Scorecard round={r} />
              <div className="mt-5 border-t border-rule pt-4">
                <ScoreMixBar holes={r.holes} />
              </div>
            </Panel>
          </div>
        );
      }}
    </QueryView>
  );
}

export default function RoundsPage() {
  const rounds = useQuery('rounds.list', {});
  const [params, setParams] = useSearchParams();
  const [courseOpen, setCourseOpen] = useState(false);
  const entering = params.get('new') === '1';

  return (
    <Page
      title="Round tracker"
      lede="Score rounds hole by hole: strokes, putts, fairways and penalties."
      actions={
        !entering && (
          <Button variant="primary" onClick={() => setParams({ new: '1' })}>
            <Plus size={15} /> Record a round
          </Button>
        )
      }
    >
      {entering ? (
        <RoundEntry onDone={(id) => setParams({ id: String(id) })} onCancel={() => setParams({})} onAddCourse={() => setCourseOpen(true)} />
      ) : (
        <QueryView q={rounds} label="Loading rounds" onRetry={rounds.reload}>
          {(list) => {
            if (list.length === 0) {
              return (
                <Panel>
                  <EmptyState
                    title="No rounds yet"
                    action={
                      <Button variant="primary" onClick={() => setParams({ new: '1' })}>
                        Record your first round
                      </Button>
                    }
                  >
                    <p>Enter your strokes hole by hole. Add putts and tee-shot results to unlock greens in regulation, scrambling and putting stats.</p>
                  </EmptyState>
                </Panel>
              );
            }
            const selected = list.find((r) => r.id === Number(params.get('id')))?.id ?? list[0]!.id;
            return (
              <div className="grid grid-cols-[260px_minmax(0,1fr)] gap-6">
                <RoundList rounds={list} selected={selected} onSelect={(id) => setParams({ id: String(id) })} />
                <RoundView key={selected} id={selected} />
              </div>
            );
          }}
        </QueryView>
      )}
      <CourseEditor open={courseOpen} onClose={() => setCourseOpen(false)} onCreated={() => undefined} />
    </Page>
  );
}

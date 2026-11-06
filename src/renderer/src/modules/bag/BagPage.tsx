import { useState } from 'react';
import { Link } from 'react-router';
import { Minus, Plus, Sparkles } from 'lucide-react';
import type { ClubSummary } from '@shared/dto';
import type { AppError } from '@shared/ipc/result';
import { Button } from '@/design/Button';
import { SampleBadge } from '@/design/controls';
import { Page, Panel } from '@/design/Page';
import { QueryView } from '@/design/QueryView';
import { mutate, useQuery } from '@/lib/api';
import { useProfile, useUnits } from '@/stores/profile';
import { ClubEditor, kindLabel } from '../equipment/ClubEditor';
import { ChatGptSettings, useAiStatus } from './ChatGpt';
import { PlayerRead } from './PlayerRead';
import { clubSpec } from './three/clubModel';
import { useClubThumb } from './three/thumbs';

const byLoft = (a: ClubSummary, b: ClubSummary) =>
  Number(a.kind === 'putter') - Number(b.kind === 'putter') || (a.loftDeg ?? 99) - (b.loftDeg ?? 99) || a.label.localeCompare(b.label);

/** Head silhouette per club type, drawn in the card corner. */
function HeadGlyph({ kind }: { kind: ClubSummary['kind'] }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinejoin: 'round' as const };
  return (
    <svg viewBox="0 0 40 28" className="h-7 w-10 text-green-speed/70" aria-hidden>
      <line x1="8" y1="2" x2="20" y2="16" stroke="currentColor" strokeWidth={1.4} />
      {kind === 'driver' || kind === 'wood' ? (
        <path d={kind === 'driver' ? 'M14 15c4-3 16-4 22 2 1 4-4 8-12 8S12 22 14 15z' : 'M16 16c3-2 12-3 17 1 1 3-3 6-9 6s-9-2-8-7z'} {...common} />
      ) : kind === 'hybrid' ? (
        <path d="M17 16c3-1.5 10-2 14 1 0 3-3 5-8 5s-7-2-6-6z" {...common} />
      ) : kind === 'putter' ? (
        <path d="M16 16h18v6H16z" {...common} />
      ) : (
        <path d={kind === 'wedge' ? 'M18 15l14 2-3 7h-10z' : 'M18 15l14 3-2 6h-11z'} {...common} />
      )}
    </svg>
  );
}

/** Rendered 3D head for a card; the line glyph stands in if this computer can't draw 3D. */
function ClubThumb({ club }: { club: ClubSummary }) {
  const left = useProfile((s) => s.profile?.handedness === 'left');
  const url = useClubThumb(clubSpec({ kind: club.kind, loftDeg: club.loftDeg, lieDeg: club.lieDeg, head: club.modelInfo?.head }, left));
  if (url === null) {
    return (
      <div className="flex h-[92px] items-center justify-center">
        <HeadGlyph kind={club.kind} />
      </div>
    );
  }
  return url === undefined ? <div className="h-[92px]" aria-hidden /> : <img src={url} alt="" className="pointer-events-none mx-auto h-[92px] w-[138px] object-contain" draggable={false} />;
}

function ClubCard({ club, onEdit, onRemove, busy }: { club: ClubSummary; onEdit: () => void; onRemove: () => void; busy: boolean }) {
  const u = useUnits();
  const s = club.stats;
  return (
    <div className="group relative flex flex-col rounded-panel border border-rule bg-raised p-4 transition-colors hover:border-rule-strong">
      <button type="button" onClick={onEdit} className="absolute inset-0 rounded-panel" aria-label={`Edit ${club.label}`} />
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <div className="figures truncate text-lg font-semibold text-ink">{club.label}</div>
          <div className="text-xs text-ink-muted">
            {kindLabel(club.kind)}
            {club.loftDeg !== null && <span className="figures"> · {club.loftDeg}°</span>}
          </div>
        </div>
        {club.modelInfo && (
          <span title="Identified by ChatGPT" className="mt-1 text-brass">
            <Sparkles size={13} aria-label="Identified by ChatGPT" />
          </span>
        )}
      </div>
      <div className="truncate text-[11px] text-ink-faint" title={[club.make, club.model].filter(Boolean).join(' ')}>
        {club.make || club.model ? [club.make, club.model].filter(Boolean).join(' ') : '\u00a0'}
      </div>
      <ClubThumb club={club} />
      <div className="mt-1 flex items-end justify-between">
        {club.kind === 'putter' ? (
          <span className="text-xs text-ink-faint">Putting stats live in rounds</span>
        ) : s.carryMean !== null ? (
          <div>
            <div className="figures text-2xl font-semibold text-ink">
              {Math.round(u.d(s.carryMean))}
              <span className="ml-1 text-sm font-normal text-ink-muted">{u.dSuffix}</span>
            </div>
            <div className="text-xs text-ink-faint">avg carry · {s.n} shots</div>
          </div>
        ) : (
          <div className="text-xs text-ink-faint">{s.n === 0 ? 'No shots logged' : `${s.n} of 5 shots needed`}</div>
        )}
        <div className="relative z-10 flex items-center gap-1">
          <SampleBadge show={club.source === 'sample'} />
          <button
            type="button"
            onClick={onRemove}
            disabled={busy}
            title="Take out of the bag"
            aria-label={`Take ${club.label} out of the bag`}
            className="rounded-control p-1 text-ink-faint opacity-0 group-hover:opacity-100 hover:bg-overlay hover:text-ink focus:opacity-100"
          >
            <Minus size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}

export default function BagPage() {
  const clubs = useQuery('clubs.list', {});
  const ai = useAiStatus();
  const analysis = useQuery('ai.analysis', {});
  const [editing, setEditing] = useState<ClubSummary | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState<AppError | null>(null);
  const connected = (ai.status === 'ready' || ai.status === 'empty') && ai.data.connected;

  const readBag = async () => {
    setReading(true);
    setReadError(null);
    const res = await mutate('ai.analyzeBag', {}, { done: 'ChatGPT read your bag' });
    setReading(false);
    if (!res.ok) setReadError(res.error);
  };

  const setBag = async (ids: number[]) => {
    setBusy(true);
    setError(null);
    const res = await mutate('bag.setClubs', { clubIds: ids }, { done: 'Bag updated' });
    setBusy(false);
    if (!res.ok) setError(res.error);
  };

  return (
    <Page
      title="Golf bag"
      lede="The clubs you carry, drawn at their real loft and lie, with your own average carry for each."
      actions={
        <>
          <Button onClick={() => setSettingsOpen(true)}>
            <Sparkles size={14} className="text-brass" /> ChatGPT{connected ? '' : ': connect'}
          </Button>
          <Button variant="primary" onClick={() => setAdding(true)}>
            <Plus size={15} /> Add club
          </Button>
        </>
      }
    >
      <QueryView q={clubs} label="Loading your clubs" onRetry={clubs.reload}>
        {(all) => {
          const bag = all.filter((c) => c.inBag).sort(byLoft);
          const spare = all.filter((c) => !c.inBag && c.retiredOn === null).sort(byLoft);
          const retired = all.filter((c) => c.retiredOn !== null);
          const ids = bag.map((c) => c.id);
          return (
            <div className="flex flex-col gap-8">
              {error && <p className="text-sm text-hazard">{error.message}</p>}
              <PlayerRead
                analysis={analysis.status === 'ready' || analysis.status === 'empty' ? analysis.data : null}
                connected={connected}
                busy={reading}
                error={readError}
                bagSize={bag.length}
                onAnalyze={() => void readBag()}
                onConnect={() => setSettingsOpen(true)}
              />
              <section>
                <div className="mb-3 flex items-baseline justify-between">
                  <h2 className="figures text-lg font-semibold">
                    In the bag <span className="text-ink-muted">{bag.length} of 14</span>
                  </h2>
                  <Link to="/equipment" className="text-sm text-green-speed hover:underline">
                    Check distance gaps
                  </Link>
                </div>
                <div className="mb-4 flex h-1.5 gap-[2px]" aria-hidden>
                  {Array.from({ length: 14 }, (_, i) => (
                    <span key={i} className={`flex-1 rounded-full ${i < bag.length ? 'bg-fairway' : 'bg-sunken'}`} />
                  ))}
                </div>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-3">
                  {bag.map((c) => (
                    <ClubCard key={c.id} club={c} busy={busy} onEdit={() => setEditing(c)} onRemove={() => void setBag(ids.filter((id) => id !== c.id))} />
                  ))}
                  {Array.from({ length: 14 - bag.length }, (_, i) => (
                    <button
                      key={`empty-${i}`}
                      type="button"
                      onClick={() => setAdding(true)}
                      className="flex min-h-[132px] items-center justify-center rounded-panel border border-dashed border-rule text-sm text-ink-faint hover:border-rule-strong hover:text-ink-muted"
                    >
                      Empty slot
                    </button>
                  ))}
                </div>
              </section>

              {spare.length > 0 && (
                <section>
                  <h2 className="figures mb-3 text-lg font-semibold">Not in the bag</h2>
                  <Panel>
                    <ul>
                      {spare.map((c) => (
                        <li key={c.id} className="flex items-center gap-4 border-b border-rule px-5 py-3 last:border-0">
                          <button type="button" onClick={() => setEditing(c)} className="figures text-left font-semibold hover:underline">
                            {c.label}
                          </button>
                          <span className="text-sm text-ink-muted">{kindLabel(c.kind)}</span>
                          <span className="ml-auto" />
                          <Button disabled={bag.length >= 14} busy={busy} onClick={() => void setBag([...ids, c.id])}>
                            {bag.length >= 14 ? 'Bag is full' : 'Put in bag'}
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </Panel>
                </section>
              )}

              {retired.length > 0 && (
                <p className="text-sm text-ink-faint">
                  {retired.length} retired club{retired.length === 1 ? '' : 's'} kept for history in the{' '}
                  <Link to="/equipment" className="text-green-speed hover:underline">
                    Equipment lab
                  </Link>
                  .
                </p>
              )}
            </div>
          );
        }}
      </QueryView>
      <ClubEditor
        club={editing}
        open={editing !== null || adding}
        onClose={() => (setEditing(null), setAdding(false))}
        onSaved={({ identified }) => {
          // A newly identified club changes the picture, so refresh ChatGPT's read straight away.
          if (identified && connected && !reading) void readBag();
        }}
      />
      <ChatGptSettings open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </Page>
  );
}

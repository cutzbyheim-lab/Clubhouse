import { Link } from 'react-router';
import { ArrowUpRight, CircleAlert, Sparkles, TrendingUp } from 'lucide-react';
import type { Insight } from '@shared/dto';
import { formatToPar, scoreName } from '@shared/domain/golf';
import { useUnits } from '@/stores/profile';
import { SampleBadge } from './controls';

// ─── Yardage ladder ─────────────────────────────────────────────────────────

export interface LadderRow {
  clubId: number;
  label: string;
  carryMean: number | null;
  carrySd: number | null;
  n: number;
}

/**
 * Average carry per club, ±1 sd as a faint band. Clubs without enough shots
 * keep their row with a note instead of a bar.
 */
export function YardageLadder({ rows, onSelect }: { rows: readonly LadderRow[]; onSelect?: (clubId: number) => void }) {
  const u = useUnits();
  const max = Math.max(1, ...rows.map((r) => (r.carryMean ?? 0) + (r.carrySd ?? 0)));
  const scaleMax = Math.ceil(u.d(max) / 25) * 25;
  const pct = (m: number) => `${(u.d(m) / scaleMax) * 100}%`;
  const ticks = Array.from({ length: Math.floor(scaleMax / 50) + 1 }, (_, i) => i * 50);

  return (
    <div className="relative">
      <div className="pointer-events-none absolute inset-y-0 right-[64px] left-[118px]" aria-hidden>
        {ticks.map((t) => (
          <div key={t} className="absolute inset-y-0 border-l border-rule/70" style={{ left: `${(t / scaleMax) * 100}%` }}>
            <span className="figures absolute -bottom-5 -translate-x-1/2 text-[10px] text-ink-faint">{t}</span>
          </div>
        ))}
      </div>
      <ul className="relative flex flex-col gap-1.5 pb-5">
        {rows.map((r) => {
          const content = (
            <>
              <span className="w-[110px] shrink-0 truncate pr-2 text-sm text-ink-soft">{r.label}</span>
              <span className="relative h-[18px] flex-1">
                {r.carryMean !== null ? (
                  <>
                    {r.carrySd !== null && (
                      <span
                        className="absolute top-1/2 h-[14px] -translate-y-1/2 rounded-[3px] bg-green-speed/15"
                        style={{ left: pct(Math.max(0, r.carryMean - r.carrySd)), width: pct(2 * r.carrySd) }}
                      />
                    )}
                    <span
                      className="absolute top-1/2 left-0 h-[6px] -translate-y-1/2 rounded-r-[3px] bg-fairway"
                      style={{ width: pct(r.carryMean) }}
                    />
                    <span
                      className="absolute top-1/2 h-[14px] w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-green-speed"
                      style={{ left: pct(r.carryMean) }}
                    />
                  </>
                ) : (
                  <span className="absolute inset-y-0 left-0 flex items-center text-xs text-ink-faint">
                    {r.n === 0 ? 'No shots logged' : `${r.n} shot${r.n === 1 ? '' : 's'}, need 5`}
                  </span>
                )}
              </span>
              <span className="figures w-[56px] shrink-0 text-right text-sm text-ink">
                {r.carryMean !== null ? Math.round(u.d(r.carryMean)) : '—'}
              </span>
            </>
          );
          return (
            <li key={r.clubId}>
              {onSelect ? (
                <button type="button" onClick={() => onSelect(r.clubId)} className="flex w-full items-center rounded-control px-1 py-0.5 text-left hover:bg-overlay">
                  {content}
                </button>
              ) : (
                <div className="flex items-center px-1 py-0.5">{content}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ─── Scorecard marks ────────────────────────────────────────────────────────

/** Traditional scorecard notation: circles under par, squares over. */
export function ScoreMark({ strokes, par }: { strokes: number; par: number }) {
  const name = scoreName(strokes, par);
  const base = 'figures inline-flex h-7 w-7 items-center justify-center text-sm';
  const ring =
    name === 'eagle'
      ? 'rounded-full border border-[#3987e5] outline outline-1 outline-offset-2 outline-[#3987e5] text-ink'
      : name === 'birdie'
        ? 'rounded-full border border-[#3987e5] text-ink'
        : name === 'bogey'
          ? 'border border-[#e0875f]/80 text-ink'
          : name === 'double'
            ? 'border border-[#d95926] outline outline-1 outline-offset-2 outline-[#d95926] text-ink'
            : name === 'triple'
              ? 'bg-[#a8401b]/40 border border-[#a8401b] text-ink'
              : 'text-ink-soft';
  return (
    <span className={`${base} ${ring}`} title={name === 'triple' ? 'triple bogey or worse' : name}>
      {strokes}
    </span>
  );
}

export function ToPar({ strokes, par, className = '' }: { strokes: number; par: number; className?: string }) {
  const rel = strokes - par;
  return <span className={`figures ${rel < 0 ? 'text-[#7fb0ee]' : rel === 0 ? 'text-ink-soft' : 'text-ink-muted'} ${className}`}>{formatToPar(rel)}</span>;
}

// ─── Insights ───────────────────────────────────────────────────────────────

const KIND_META = {
  opportunity: { icon: CircleAlert, label: 'Opportunity', cls: 'text-brass' },
  strength: { icon: TrendingUp, label: 'Strength', cls: 'text-green-speed' },
  note: { icon: Sparkles, label: 'Note', cls: 'text-ink-muted' },
} as const;

export function InsightCard({ insight, compact = false, actions }: { insight: Insight; compact?: boolean; actions?: React.ReactNode }) {
  const meta = KIND_META[insight.kind];
  const Icon = meta.icon;
  return (
    <article className={`flex flex-col gap-2 rounded-panel border border-rule bg-raised p-4 ${insight.dismissed ? 'opacity-55' : ''}`}>
      <div className="flex items-center gap-2 text-xs">
        <Icon size={14} className={meta.cls} aria-hidden />
        <span className={meta.cls}>{meta.label}</span>
        <SampleBadge show={insight.usesSample} />
        {actions && <div className="ml-auto flex gap-1">{actions}</div>}
      </div>
      <h3 className="figures text-lg leading-snug font-semibold text-ink">{insight.title}</h3>
      {!compact && <p className="text-sm text-ink-muted">{insight.detail}</p>}
      <dl className="mt-1 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
        {insight.evidence.map((e) => (
          <div key={e.label} className="contents">
            <dt className="truncate text-ink-muted">{e.label}</dt>
            <dd className="figures text-right text-ink">
              {e.value}
              {e.n !== null && !compact && <span className="ml-2 text-xs text-ink-faint">n={e.n}</span>}
            </dd>
          </div>
        ))}
      </dl>
      {!compact && <p className="mt-1 border-t border-rule pt-2 text-xs text-ink-faint">{insight.rule}</p>}
      {insight.suggestedDrill && (
        <Link to="/practice" className="mt-1 inline-flex items-center gap-1 self-start text-sm text-green-speed hover:underline">
          Practise: {insight.suggestedDrill} <ArrowUpRight size={14} aria-hidden />
        </Link>
      )}
    </article>
  );
}

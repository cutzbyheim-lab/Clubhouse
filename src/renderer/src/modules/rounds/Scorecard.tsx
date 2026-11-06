import { ArrowLeft, ArrowRight, ArrowDown, ArrowUp, Check } from 'lucide-react';
import type { RoundDetail, RoundHole } from '@shared/dto';
import { SCORE_NAMES, scoreName, type ScoreName } from '@shared/domain/golf';
import { SCORE_COLORS } from '@/design/charts';
import { ScoreMark } from '@/design/golf';
import { useUnits } from '@/stores/profile';

const FAIRWAY_ICON = { hit: Check, left: ArrowLeft, right: ArrowRight, short: ArrowDown, long: ArrowUp } as const;
const MIX_LABEL: Record<ScoreName, string> = { eagle: 'Eagle+', birdie: 'Birdie', par: 'Par', bogey: 'Bogey', double: 'Double', triple: 'Triple+' };

function Nine({ holes, label }: { holes: RoundHole[]; label: string }) {
  const u = useUnits();
  if (holes.length === 0) return null;
  const scored = holes.filter((h) => h.score);
  const sum = (f: (h: RoundHole) => number | null | undefined) => scored.reduce((s, h) => s + (f(h) ?? 0), 0);
  const cell = 'px-1 py-1.5 text-center';
  return (
    <table className="w-full table-fixed text-sm">
      <thead>
        <tr className="text-xs text-ink-muted">
          <th className="w-[84px] py-1.5 pr-2 text-left font-medium">Hole</th>
          {holes.map((h) => (
            <th key={h.holeId} className={`${cell} figures font-medium`}>
              {h.number}
            </th>
          ))}
          <th className={`${cell} w-[52px] font-medium`}>{label}</th>
        </tr>
      </thead>
      <tbody className="figures">
        <tr className="border-t border-rule text-xs text-ink-faint">
          <td className="py-1 pr-2">{u.dSuffix === 'yd' ? 'Yards' : 'Metres'}</td>
          {holes.map((h) => (
            <td key={h.holeId} className={cell}>
              {h.lengthM ? Math.round(u.d(h.lengthM)) : '—'}
            </td>
          ))}
          <td className={cell}>{holes.every((h) => h.lengthM) ? Math.round(u.d(holes.reduce((s, h) => s + (h.lengthM ?? 0), 0))) : ''}</td>
        </tr>
        <tr className="border-t border-rule text-ink-muted">
          <td className="py-1.5 pr-2 text-xs">Par</td>
          {holes.map((h) => (
            <td key={h.holeId} className={cell}>
              {h.par}
            </td>
          ))}
          <td className={cell}>{holes.reduce((s, h) => s + h.par, 0)}</td>
        </tr>
        <tr className="border-t border-rule">
          <td className="py-1.5 pr-2 text-xs text-ink-muted">Score</td>
          {holes.map((h) => (
            <td key={h.holeId} className={cell}>
              {h.score ? <ScoreMark strokes={h.score.strokes} par={h.par} /> : <span className="text-ink-faint">·</span>}
            </td>
          ))}
          <td className={`${cell} text-base font-semibold text-ink`}>{scored.length ? sum((h) => h.score?.strokes) : '—'}</td>
        </tr>
        <tr className="border-t border-rule text-ink-soft">
          <td className="py-1.5 pr-2 text-xs text-ink-muted">Putts</td>
          {holes.map((h) => (
            <td key={h.holeId} className={`${cell} ${(h.score?.putts ?? 0) >= 3 ? 'text-brass' : ''}`}>
              {h.score?.putts ?? '—'}
            </td>
          ))}
          <td className={cell}>{scored.some((h) => h.score?.putts !== null) ? sum((h) => h.score?.putts) : '—'}</td>
        </tr>
        <tr className="border-t border-rule text-ink-soft">
          <td className="py-1.5 pr-2 text-xs text-ink-muted">Fairway</td>
          {holes.map((h) => {
            const f = h.score?.fairway;
            const Icon = f ? FAIRWAY_ICON[f] : null;
            return (
              <td key={h.holeId} className={cell} title={f ?? (h.par === 3 ? 'Par 3' : 'Not recorded')}>
                {Icon ? <Icon size={14} className={`mx-auto ${f === 'hit' ? 'text-green-speed' : 'text-ink-muted'}`} aria-label={f ?? ''} /> : <span className="text-ink-faint">{h.par === 3 ? '' : '—'}</span>}
              </td>
            );
          })}
          <td className={cell}>
            {scored.filter((h) => h.score?.fairway === 'hit').length}/{scored.filter((h) => h.par >= 4 && h.score?.fairway).length}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

/** Proportion of each score type in the round, as one segmented bar. */
export function ScoreMixBar({ holes }: { holes: RoundHole[] }) {
  const counts = Object.fromEntries(SCORE_NAMES.map((n) => [n, 0])) as Record<ScoreName, number>;
  for (const h of holes) if (h.score) counts[scoreName(h.score.strokes, h.par)]++;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (total === 0) return null;
  return (
    <div>
      <div className="flex h-3 gap-[2px] overflow-hidden rounded-[4px]">
        {SCORE_NAMES.filter((n) => counts[n] > 0).map((n) => (
          <span key={n} style={{ flex: counts[n], background: SCORE_COLORS[n] }} title={`${MIX_LABEL[n]}: ${counts[n]}`} />
        ))}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-soft">
        {SCORE_NAMES.filter((n) => counts[n] > 0).map((n) => (
          <li key={n} className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-[2px]" style={{ background: SCORE_COLORS[n] }} aria-hidden />
            {MIX_LABEL[n]} <span className="figures text-ink">{counts[n]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Scorecard({ round }: { round: RoundDetail }) {
  const front = round.holes.filter((h) => h.number <= 9);
  const back = round.holes.filter((h) => h.number > 9);
  return (
    <div className="flex flex-col gap-5">
      <Nine holes={front} label="Out" />
      <Nine holes={back} label="In" />
    </div>
  );
}

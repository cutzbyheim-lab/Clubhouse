import type { ClubSummary, Insight, Performance } from '@shared/dto';
import { localDate } from '@shared/domain/dates';
import { MIN_ROUNDS_FOR_AVERAGE, MIN_SAMPLE_FOR_AVERAGE } from '@shared/constants';
import { computeGaps } from '@shared/domain/gapping';
import { mean } from '@shared/domain/stats';
import { distanceSuffix, toDistance } from '@shared/domain/units';
import type { PlayerProfile } from '@shared/schemas';
import type { DB } from '../db/connection';
import { getProfile } from '../db/repositories/profile';
import { scoredHoles } from '../db/repositories/rounds';
import { listClubSummaries } from './clubs';
import { performance } from './performance';

/*
 * The intelligence engine: deterministic rules over the player's own rows.
 * Every insight carries the numbers it rests on, their sample sizes, and the
 * rule in words. No external benchmarks, no estimates, no model.
 */

type Draft = Omit<Insight, 'dismissed'>;

interface Ctx {
  perf: Performance;
  clubs: ClubSummary[];
  holes: ReturnType<typeof scoredHoles>;
  profile: PlayerProfile;
  sampleRounds: boolean;
  sampleShots: boolean;
  practiceMinutesByCat: Map<string, number>;
  lastPracticeDaysAgo: number | null;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const one = (x: number) => x.toFixed(1);

function dist(ctx: Ctx, m: number, signed = false): string {
  const v = toDistance(Math.abs(m), ctx.profile.distanceUnit);
  const side = signed ? (m > 0 ? ' right' : m < 0 ? ' left' : '') : '';
  return `${Math.round(v)} ${distanceSuffix(ctx.profile.distanceUnit)}${side}`;
}

// ─── Rules ──────────────────────────────────────────────────────────────────

function threePutts(ctx: Ctx): Draft | null {
  const putted = ctx.holes.filter((h) => h.putts !== null);
  if (putted.length < 36) return null;
  const three = putted.filter((h) => (h.putts ?? 0) >= 3).length;
  const r = three / putted.length;
  const base = {
    area: 'putting' as const,
    evidence: [
      { label: 'Three-putts', value: `${three} of ${putted.length} holes`, n: putted.length },
      { label: 'Per 18 holes', value: one(r * 18), n: putted.length },
    ],
    rule: 'Flags three-putts on 8% or more of holes; calls it a strength under 4%. Needs 36 putted holes.',
    usesSample: ctx.sampleRounds,
  };
  if (r >= 0.08) {
    return {
      ...base,
      key: 'putting.three_putts',
      kind: 'opportunity',
      title: `Three-putts cost you about ${one(r * 18)} strokes a round`,
      detail: 'Most three-putts come from poor speed on the first putt. Lag practice from 10–15 m is the quickest fix.',
      suggestedDrill: 'Lag ladder',
    };
  }
  if (r < 0.04) {
    return {
      ...base,
      key: 'putting.three_putts_low',
      kind: 'strength',
      title: 'You rarely three-putt',
      detail: `Only ${pct(r)} of holes needed three putts or more.`,
      suggestedDrill: null,
    };
  }
  return null;
}

function missSide(ctx: Ctx): Draft | null {
  const left = ctx.holes.filter((h) => h.fairway === 'left').length;
  const right = ctx.holes.filter((h) => h.fairway === 'right').length;
  const misses = left + right;
  if (misses < 15) return null;
  const side = right >= left ? 'right' : 'left';
  const share = Math.max(left, right) / misses;
  if (share < 0.62) return null;
  return {
    key: `driving.miss_side.${side}`,
    kind: 'opportunity',
    area: 'driving',
    title: `Tee-shot misses lean ${side}`,
    detail: `${Math.max(left, right)} of your ${misses} missed fairways went ${side}. A one-sided miss is easier to fix than a two-way miss: aim and alignment are the first things to check.`,
    evidence: [
      { label: 'Missed right', value: String(right), n: misses },
      { label: 'Missed left', value: String(left), n: misses },
    ],
    rule: 'Flags when 62% or more of left/right fairway misses go to one side. Needs 15 misses.',
    suggestedDrill: 'Fairway finder',
    usesSample: ctx.sampleRounds,
  };
}

function scrambling(ctx: Ctx): Draft | null {
  const chances = ctx.perf.rounds.reduce((s, r) => s + r.scrambleChances, 0);
  const saves = ctx.perf.rounds.reduce((s, r) => s + r.scrambles, 0);
  if (chances < 20) return null;
  const r = saves / chances;
  const evidence = [{ label: 'Par or better after missing the green', value: `${saves} of ${chances}`, n: chances }];
  const rule = 'Scrambling = par or better after missing the green in regulation. Flags under 25%; strength over 50%. Needs 20 chances.';
  if (r < 0.25) {
    return {
      key: 'short_game.scrambling_low',
      kind: 'opportunity',
      area: 'short_game',
      title: `You save par ${pct(r)} of the time after missing a green`,
      detail: 'Getting up and down more often is usually the fastest route to lower scores for mid-handicap players.',
      evidence,
      rule,
      suggestedDrill: 'Up-and-down nine',
      usesSample: ctx.sampleRounds,
    };
  }
  if (r > 0.5) {
    return {
      key: 'short_game.scrambling_high',
      kind: 'strength',
      area: 'short_game',
      title: 'Your short game rescues a lot of holes',
      detail: `You make par or better ${pct(r)} of the time after missing the green.`,
      evidence,
      rule,
      suggestedDrill: null,
      usesSample: ctx.sampleRounds,
    };
  }
  return null;
}

function scoringTrend(ctx: Ctx): Draft | null {
  const full = ctx.perf.rounds.filter((r) => r.holesPlayed === 18).slice().reverse(); // newest first
  const recent = full.slice(0, 5).map((r) => r.strokes);
  const prior = full.slice(5, 10).map((r) => r.strokes);
  if (recent.length < MIN_ROUNDS_FOR_AVERAGE || prior.length < MIN_ROUNDS_FOR_AVERAGE) return null;
  const a = mean(recent) ?? 0;
  const b = mean(prior) ?? 0;
  const diff = a - b;
  if (Math.abs(diff) < 1.5) return null;
  const better = diff < 0;
  return {
    key: `scoring.trend.${better ? 'down' : 'up'}`,
    kind: better ? 'strength' : 'note',
    area: 'scoring',
    title: better ? `Scoring is ${one(-diff)} strokes better lately` : `Scoring is ${one(diff)} strokes higher lately`,
    detail: better
      ? 'Your last five 18-hole rounds average lower than the five before them.'
      : 'Your last five 18-hole rounds average higher than the five before them. Check the Performance lab to see which part of the game moved.',
    evidence: [
      { label: 'Last 5 rounds', value: one(a), n: recent.length },
      { label: 'Previous 5', value: one(b), n: prior.length },
    ],
    rule: 'Compares the average of your last five 18-hole rounds with the five before. Flags a change of 1.5 strokes or more.',
    suggestedDrill: null,
    usesSample: ctx.sampleRounds,
  };
}

function parTypes(ctx: Ctx): Draft | null {
  const eligible = ctx.perf.byPar.filter((p) => p.holes >= 18 && p.avgToPar !== null);
  if (eligible.length < 3) return null;
  const sorted = eligible.slice().sort((x, y) => (y.avgToPar ?? 0) - (x.avgToPar ?? 0));
  const worst = sorted[0];
  const best = sorted.at(-1);
  if (!worst || !best || (worst.avgToPar ?? 0) - (best.avgToPar ?? 0) < 0.3) return null;
  return {
    key: `scoring.par_type.${worst.par}`,
    kind: 'note',
    area: 'scoring',
    title: `Par ${worst.par}s cost you the most`,
    detail: `You average +${one(worst.avgToPar ?? 0)} on par ${worst.par}s against +${one(best.avgToPar ?? 0)} on par ${best.par}s.`,
    evidence: eligible.map((p) => ({ label: `Par ${p.par}`, value: `+${one(p.avgToPar ?? 0)}`, n: p.holes })),
    rule: 'Compares average score to par by hole type. Flags a spread of 0.3 strokes or more. Needs 18 holes of each type.',
    suggestedDrill: worst.par === 3 ? 'Wedge distance ladder' : null,
    usesSample: ctx.sampleRounds,
  };
}

function directionBias(ctx: Ctx): Draft | null {
  const candidates = ctx.clubs
    .filter((c) => c.stats.offlineMean !== null && c.stats.offlineSd !== null && (c.stats.counts['offline'] ?? 0) >= 20)
    .map((c) => ({ c, mean: c.stats.offlineMean ?? 0, ratio: Math.abs(c.stats.offlineMean ?? 0) / (c.stats.offlineSd || 1) }))
    .filter((x) => x.ratio >= 0.5 && Math.abs(x.mean) >= 5)
    .sort((a, b) => b.ratio - a.ratio);
  const top = candidates[0];
  if (!top) return null;
  const side = top.mean > 0 ? 'right' : 'left';
  return {
    key: `approach.direction.${top.c.id}.${side}`,
    kind: 'opportunity',
    area: top.c.kind === 'driver' || top.c.kind === 'wood' ? 'driving' : 'approach',
    title: `Your ${top.c.label} finishes ${dist(ctx, top.mean)} ${side} on average`,
    detail: 'A consistent offset is good news: aim for it on the course, or work on start line and face-to-path to centre it.',
    evidence: [
      { label: 'Average offline', value: dist(ctx, top.mean, true), n: top.c.stats.counts['offline'] ?? 0 },
      { label: 'Spread (1 sd)', value: dist(ctx, top.c.stats.offlineSd ?? 0), n: top.c.stats.counts['offline'] ?? 0 },
    ],
    rule: 'Flags a club whose average offline distance is at least half its spread and at least 5 m. Needs 20 shots with direction data.',
    suggestedDrill: top.c.kind === 'driver' ? 'Fairway finder' : 'Nine-shot iron drill',
    usesSample: ctx.sampleShots,
  };
}

function gapping(ctx: Ctx): Draft | null {
  const bag = ctx.clubs.filter((c) => c.inBag && c.kind !== 'putter');
  const gaps = computeGaps(bag.map((c) => ({ clubId: c.id, label: c.label, loftDeg: c.loftDeg, carryM: c.stats.carryMean })));
  const flagged = gaps.filter((g) => g.status !== 'ok');
  if (flagged.length === 0) return null;
  const first = flagged[0];
  if (!first) return null;
  return {
    key: `equipment.gaps.${flagged.map((g) => `${g.fromClubId}-${g.toClubId}`).join('_')}`,
    kind: 'opportunity',
    area: 'equipment',
    title:
      flagged.length === 1
        ? `${first.from} and ${first.to} are ${first.status === 'wide' ? 'far apart' : 'too close'} in distance`
        : `${flagged.length} distance gaps in your bag need a look`,
    detail: 'Even gaps mean you always have a club for the number. Tight gaps waste a slot; wide gaps leave yardages you can only hit with a partial swing.',
    evidence: flagged.slice(0, 4).map((g) => ({
      label: `${g.from} → ${g.to}`,
      value: `${g.gapM <= 0 ? 'overlap' : dist(ctx, g.gapM)} (${g.status})`,
      n: null,
    })),
    rule: 'Rule of thumb from club fitting: gaps under 7 yd are tight, over 20 yd are wide. Uses your average carries (5+ shots each).',
    suggestedDrill: null,
    usesSample: ctx.sampleShots,
  };
}

function missingDistances(ctx: Ctx): Draft | null {
  const missing = ctx.clubs.filter((c) => c.inBag && c.kind !== 'putter' && c.stats.carryMean === null);
  if (missing.length === 0) return null;
  return {
    key: `data.missing_distances.${missing.map((c) => c.id).join('-')}`,
    kind: 'note',
    area: 'data',
    title:
      missing.length === 1
        ? `No reliable distance for your ${missing[0]?.label ?? 'club'} yet`
        : `No reliable distance for ${missing.length} clubs in your bag`,
    detail: `Log at least ${MIN_SAMPLE_FOR_AVERAGE} shots with each so Clubhouse can show their carry, gapping and dispersion.`,
    evidence: missing.slice(0, 6).map((c) => ({ label: c.label, value: `${c.stats.n} shot${c.stats.n === 1 ? '' : 's'}`, n: c.stats.n })),
    rule: `Averages are hidden until a club has ${MIN_SAMPLE_FOR_AVERAGE} usable shots.`,
    suggestedDrill: null,
    usesSample: false,
  };
}

function mishits(ctx: Ctx): Draft | null {
  const worst = ctx.clubs
    .map((c) => ({ c, total: c.stats.n + c.stats.excluded, r: c.stats.excluded / Math.max(1, c.stats.n + c.stats.excluded) }))
    .filter((x) => x.total >= 25 && x.r >= 0.12)
    .sort((a, b) => b.r - a.r)[0];
  if (!worst) return null;
  return {
    key: `approach.mishits.${worst.c.id}`,
    kind: 'note',
    area: 'approach',
    title: `You've flagged ${pct(worst.r)} of ${worst.c.label} shots as mishits`,
    detail: 'Strike quality is the hidden driver of distance. Your averages exclude these shots, so your on-course reality may be shorter.',
    evidence: [{ label: 'Flagged mishits', value: `${worst.c.stats.excluded} of ${worst.total}`, n: worst.total }],
    rule: 'Flags a club with 12% or more of its shots marked as mishits. Needs 25 shots.',
    suggestedDrill: null,
    usesSample: ctx.sampleShots,
  };
}

const PRACTICE_CATEGORY: Partial<Record<Insight['area'], { cat: string; name: string }>> = {
  putting: { cat: 'putting', name: 'putting' },
  short_game: { cat: 'short_game', name: 'short game' },
  driving: { cat: 'driving', name: 'driving' },
};

function practiceFocus(ctx: Ctx, found: Draft[]): Draft | null {
  const target = found.find((d) => d.kind === 'opportunity' && PRACTICE_CATEGORY[d.area]);
  if (!target) return null;
  const meta = PRACTICE_CATEGORY[target.area];
  if (!meta) return null;
  const minutes = ctx.practiceMinutesByCat.get(meta.cat) ?? 0;
  if (minutes > 0) return null;
  return {
    key: `practice.focus.${meta.cat}`,
    kind: 'note',
    area: 'practice',
    title: `No ${meta.name} practice logged in 30 days`,
    detail: `${target.title}. A short, regular ${meta.name} session would target it directly.`,
    evidence: [{ label: `${meta.name[0]?.toUpperCase()}${meta.name.slice(1)} practice, last 30 days`, value: '0 min', n: null }],
    rule: 'Raised when your top opportunity is in an area with no practice logged in the last 30 days.',
    suggestedDrill: target.suggestedDrill,
    usesSample: target.usesSample,
  };
}

// ─── Engine ─────────────────────────────────────────────────────────────────

export function listInsights(db: DB, today = localDate()): Insight[] {
  const holes = scoredHoles(db);
  const byCat = db
    .prepare<[string], { category: string; minutes: number }>(
      `SELECT d.category, sum(l.minutes) AS minutes FROM practice_log l JOIN drill d ON d.id = l.drill_id
       WHERE l.performed_on >= date(?, '-30 days') GROUP BY d.category`,
    )
    .all(today);
  const flag = (sql: string) => db.prepare(sql).get() !== undefined;
  const ctx: Ctx = {
    perf: performance(db),
    clubs: listClubSummaries(db),
    holes,
    profile: getProfile(db),
    sampleRounds: flag("SELECT 1 FROM round WHERE source = 'sample' LIMIT 1"),
    sampleShots: flag("SELECT 1 FROM shot WHERE source = 'sample' AND carry_m IS NOT NULL LIMIT 1"),
    practiceMinutesByCat: new Map(byCat.map((r) => [r.category, r.minutes])),
    lastPracticeDaysAgo: null,
  };

  const rules = [threePutts, missSide, scrambling, scoringTrend, parTypes, directionBias, gapping, missingDistances, mishits];
  const found: Draft[] = [];
  for (const rule of rules) {
    const d = rule(ctx);
    if (d) found.push(d);
  }
  const focus = practiceFocus(ctx, found);
  if (focus) found.push(focus);

  const dismissed = new Set(
    db.prepare<[], { insight_key: string }>('SELECT insight_key FROM insight_dismissal').all().map((r) => r.insight_key),
  );
  const order = { opportunity: 0, strength: 1, note: 2 } as const;
  return found
    .map((d) => ({ ...d, dismissed: dismissed.has(d.key) }))
    .sort((a, b) => Number(a.dismissed) - Number(b.dismissed) || order[a.kind] - order[b.kind]);
}

export function setDismissed(db: DB, key: string, dismissed: boolean): void {
  if (dismissed) db.prepare('INSERT INTO insight_dismissal (insight_key) VALUES (?) ON CONFLICT DO NOTHING').run(key);
  else db.prepare('DELETE FROM insight_dismissal WHERE insight_key = ?').run(key);
}

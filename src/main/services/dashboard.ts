import type { DashboardOverview, Kpi, RoundSummary } from '@shared/dto';
import { localDate } from '@shared/domain/dates';
import { MIN_ROUNDS_FOR_AVERAGE } from '@shared/constants';
import { mean } from '@shared/domain/stats';
import type { DB } from '../db/connection';
import { practiceOverview } from '../db/repositories/practice';
import { listRounds } from '../db/repositories/rounds';
import { listClubSummaries } from './clubs';
import { listInsights } from './insights';

/** Last five vs previous five, gated on MIN_ROUNDS_FOR_AVERAGE each side. */
function kpi(rounds: RoundSummary[], value: (rs: RoundSummary[]) => number | null): Kpi {
  const recent = rounds.slice(0, 5);
  const prior = rounds.slice(5, 10);
  return {
    value: recent.length >= MIN_ROUNDS_FOR_AVERAGE ? value(recent) : null,
    n: recent.length,
    priorValue: prior.length >= MIN_ROUNDS_FOR_AVERAGE ? value(prior) : null,
    priorN: prior.length,
  };
}

const ratio = (rs: RoundSummary[], hit: (r: RoundSummary) => number, of: (r: RoundSummary) => number) => {
  const d = rs.reduce((s, r) => s + of(r), 0);
  return d > 0 ? rs.reduce((s, r) => s + hit(r), 0) / d : null;
};

export function dashboardOverview(db: DB): DashboardOverview {
  const today = localDate();
  const rounds = listRounds(db);
  const full = rounds.filter((r) => r.holesPlayed === 18);
  const clubs = listClubSummaries(db);
  const practice = practiceOverview(db, today);

  return {
    scoring: kpi(full, (rs) => mean(rs.map((r) => r.strokes))),
    girPct: kpi(rounds, (rs) => ratio(rs, (r) => r.gir, (r) => r.girHoles)),
    fairwayPct: kpi(rounds, (rs) => ratio(rs, (r) => r.fairways, (r) => r.fairwayHoles)),
    puttsPerRound: kpi(
      full.filter((r) => r.puttsHoles === 18),
      (rs) => mean(rs.map((r) => r.putts ?? 0)),
    ),
    recentRounds: rounds.slice(0, 12),
    ladder: clubs
      .filter((c) => c.inBag && c.kind !== 'putter')
      .map((c) => ({ clubId: c.id, label: c.label, kind: c.kind, carryMean: c.stats.carryMean, carrySd: c.stats.carrySd, n: c.stats.n })),
    practice: {
      minutesLast30: practice.minutesLast30,
      logsLast30: practice.logsLast30,
      nextPlan:
        practice.plans
          .filter((p) => p.status === 'planned')
          .sort((a, b) => (a.scheduledFor ?? '9999').localeCompare(b.scheduledFor ?? '9999'))[0] ?? null,
    },
    insights: listInsights(db, today).filter((i) => !i.dismissed).slice(0, 3),
  };
}

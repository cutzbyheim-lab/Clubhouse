import type { ClubStats, ClubSummary } from '@shared/dto';
import { MIN_SAMPLE_FOR_AVERAGE } from '@shared/constants';
import { mean, present, quantile, sd } from '@shared/domain/stats';
import type { DB } from '../db/connection';
import { listClubRows, toClub } from '../db/repositories/clubs';
import { launchShots, type LaunchRow } from '../db/repositories/shots';

/** Mean of a metric, or null below the minimum sample. */
const gated = (xs: number[]): number | null => (xs.length >= MIN_SAMPLE_FOR_AVERAGE ? mean(xs) : null);
const gatedSd = (xs: number[]): number | null => (xs.length >= MIN_SAMPLE_FOR_AVERAGE ? sd(xs) : null);

export function statsFor(rows: readonly LaunchRow[]): ClubStats {
  const used = rows.filter((r) => r.excluded === 0);
  const carry = used.map((r) => r.carry_m);
  const pick = (f: (r: LaunchRow) => number | null) => present(used.map(f));
  const total = pick((r) => r.total_m);
  const offline = pick((r) => r.offline_m);
  const ball = pick((r) => r.ball_speed_mps);
  const clubSp = pick((r) => r.club_speed_mps);
  const smash = present(used.map((r) => (r.ball_speed_mps && r.club_speed_mps ? r.ball_speed_mps / r.club_speed_mps : null)));
  const launch = pick((r) => r.launch_deg);
  const spin = pick((r) => r.spin_rpm);
  const apex = pick((r) => r.apex_m);
  const descent = pick((r) => r.descent_deg);
  const enough = carry.length >= MIN_SAMPLE_FOR_AVERAGE;
  return {
    n: carry.length,
    excluded: rows.length - used.length,
    carryMean: gated(carry),
    carrySd: gatedSd(carry),
    carryP10: enough ? quantile(carry, 0.1) : null,
    carryP90: enough ? quantile(carry, 0.9) : null,
    totalMean: gated(total),
    offlineMean: gated(offline),
    offlineSd: gatedSd(offline),
    ballSpeedMean: gated(ball),
    clubSpeedMean: gated(clubSp),
    smashMean: gated(smash),
    launchMean: gated(launch),
    spinMean: gated(spin),
    apexMean: gated(apex),
    descentMean: gated(descent),
    counts: {
      carry: carry.length,
      total: total.length,
      offline: offline.length,
      ballSpeed: ball.length,
      clubSpeed: clubSp.length,
      smash: smash.length,
      launch: launch.length,
      spin: spin.length,
      apex: apex.length,
      descent: descent.length,
    },
  };
}

export function listClubSummaries(db: DB): ClubSummary[] {
  const byClub = new Map<number, LaunchRow[]>();
  for (const r of launchShots(db)) {
    const list = byClub.get(r.club_id);
    if (list) list.push(r);
    else byClub.set(r.club_id, [r]);
  }
  return listClubRows(db).map((row) => ({
    ...toClub(row),
    inBag: row.slot !== null,
    slot: row.slot,
    stats: statsFor(byClub.get(row.id) ?? []),
  }));
}

import type { SessionSummary, ShotPoint } from '@shared/dto';
import type { DB } from '../connection';
import { DomainError } from '../../errors';

/** Launch-style shots (anything with a measured carry): the input to club statistics. */
export interface LaunchRow {
  club_id: number;
  carry_m: number;
  total_m: number | null;
  offline_m: number | null;
  ball_speed_mps: number | null;
  club_speed_mps: number | null;
  launch_deg: number | null;
  spin_rpm: number | null;
  apex_m: number | null;
  descent_deg: number | null;
  excluded: number;
  source: string;
}

export const launchShots = (db: DB): LaunchRow[] =>
  db
    .prepare<[], LaunchRow>(
      `SELECT club_id, carry_m, total_m, offline_m, ball_speed_mps, club_speed_mps, launch_deg, spin_rpm,
              apex_m, descent_deg, excluded, source
       FROM shot WHERE carry_m IS NOT NULL`,
    )
    .all();

export function shotsForClub(db: DB, clubId: number): ShotPoint[] {
  return db
    .prepare<
      [number],
      {
        id: number;
        session_id: number;
        started_at: string;
        carry_m: number | null;
        total_m: number | null;
        offline_m: number | null;
        ball_speed_mps: number | null;
        launch_deg: number | null;
        spin_rpm: number | null;
        excluded: number;
        source: ShotPoint['source'];
      }
    >(
      `SELECT s.id, s.session_id, x.started_at, s.carry_m, s.total_m, s.offline_m, s.ball_speed_mps, s.launch_deg,
              s.spin_rpm, s.excluded, s.source
       FROM shot s JOIN session x ON x.id = s.session_id
       WHERE s.club_id = ? AND s.carry_m IS NOT NULL
       ORDER BY x.started_at DESC, s.seq`,
    )
    .all(clubId)
    .map((r) => ({
      id: r.id,
      sessionId: r.session_id,
      startedAt: r.started_at,
      carryM: r.carry_m,
      totalM: r.total_m,
      offlineM: r.offline_m,
      ballSpeedMps: r.ball_speed_mps,
      launchDeg: r.launch_deg,
      spinRpm: r.spin_rpm,
      excluded: r.excluded === 1,
      source: r.source,
    }));
}

export function setExcluded(db: DB, id: number, excluded: boolean): void {
  const res = db.prepare('UPDATE shot SET excluded = ? WHERE id = ?').run(excluded ? 1 : 0, id);
  if (res.changes === 0) throw new DomainError('NOT_FOUND', 'That shot no longer exists');
}

export function listSessions(db: DB): SessionSummary[] {
  return db
    .prepare<
      [],
      {
        id: number;
        kind: SessionSummary['kind'];
        started_at: string;
        location: string | null;
        device: string | null;
        source: SessionSummary['source'];
        shot_count: number;
        clubs: string | null;
      }
    >(
      `SELECT x.id, x.kind, x.started_at, x.location, x.device, x.source, count(s.id) AS shot_count,
              (SELECT group_concat(label, '|') FROM (SELECT DISTINCT c.label, c.loft_deg FROM shot s2
                 JOIN club c ON c.id = s2.club_id WHERE s2.session_id = x.id ORDER BY c.loft_deg)) AS clubs
       FROM session x LEFT JOIN shot s ON s.session_id = x.id
       WHERE x.kind <> 'course'
       GROUP BY x.id ORDER BY x.started_at DESC`,
    )
    .all()
    .map((r) => ({
      id: r.id,
      kind: r.kind,
      startedAt: r.started_at,
      location: r.location,
      device: r.device,
      source: r.source,
      shotCount: r.shot_count,
      clubs: r.clubs ? r.clubs.split('|') : [],
    }));
}

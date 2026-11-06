import { PlayerProfile, type PlayerProfileUpdate } from '@shared/schemas';
import type { DB } from '../connection';

interface Row {
  display_name: string | null;
  handedness: 'right' | 'left';
  handicap_index: number | null;
  distance_unit: 'yards' | 'metres';
  speed_unit: 'mph' | 'kmh' | 'mps';
  updated_at: string;
}

export function getProfile(db: DB): PlayerProfile {
  const r = db.prepare<[], Row>('SELECT * FROM player_profile WHERE id = 1').get();
  if (!r) throw new Error('Player profile row missing');
  return PlayerProfile.parse({
    displayName: r.display_name,
    handedness: r.handedness,
    handicapIndex: r.handicap_index,
    distanceUnit: r.distance_unit,
    speedUnit: r.speed_unit,
    updatedAt: r.updated_at,
  });
}

const COLS: Record<keyof PlayerProfileUpdate, string> = {
  displayName: 'display_name',
  handedness: 'handedness',
  handicapIndex: 'handicap_index',
  distanceUnit: 'distance_unit',
  speedUnit: 'speed_unit',
};

export function updateProfile(db: DB, patch: PlayerProfileUpdate): PlayerProfile {
  const entries = (Object.keys(COLS) as (keyof PlayerProfileUpdate)[]).filter((k) => patch[k] !== undefined);
  if (entries.length > 0) {
    const sets = entries.map((k) => `${COLS[k]} = @${k}`).join(', ');
    db.prepare(`UPDATE player_profile SET ${sets}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 1`).run(
      Object.fromEntries(entries.map((k) => [k, patch[k] ?? null])),
    );
  }
  return getProfile(db);
}

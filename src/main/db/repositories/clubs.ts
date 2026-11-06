import { ClubModelInfo, type Club, type ClubInput } from '@shared/schemas';
import type { DB } from '../connection';
import { DomainError } from '../../errors';

export interface ClubRow {
  id: number;
  kind: Club['kind'];
  label: string;
  make: string | null;
  model: string | null;
  loft_deg: number | null;
  lie_deg: number | null;
  length_m: number | null;
  shaft_make: string | null;
  shaft_model: string | null;
  shaft_flex: Club['shaftFlex'];
  shaft_weight_g: number | null;
  swing_weight: string | null;
  grip: string | null;
  acquired_on: string | null;
  retired_on: string | null;
  notes: string | null;
  model_info: string | null;
  source: Club['source'];
  created_at: string;
  updated_at: string;
  slot: number | null;
}

/** Stored JSON that no longer fits the schema is dropped rather than breaking the bag. */
function parseModelInfo(raw: string | null): ClubModelInfo | null {
  if (raw === null) return null;
  try {
    const parsed = ClubModelInfo.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export const toClub = (r: ClubRow): Club => ({
  id: r.id,
  kind: r.kind,
  label: r.label,
  make: r.make,
  model: r.model,
  loftDeg: r.loft_deg,
  lieDeg: r.lie_deg,
  lengthM: r.length_m,
  shaftMake: r.shaft_make,
  shaftModel: r.shaft_model,
  shaftFlex: r.shaft_flex,
  shaftWeightG: r.shaft_weight_g,
  swingWeight: r.swing_weight,
  grip: r.grip,
  acquiredOn: r.acquired_on,
  retiredOn: r.retired_on,
  notes: r.notes,
  modelInfo: parseModelInfo(r.model_info),
  source: r.source,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

/** All clubs with their slot in the active bag (if any), bag order first. */
export function listClubRows(db: DB): ClubRow[] {
  return db
    .prepare<[], ClubRow>(
      `SELECT c.*, bc.slot FROM club c
       LEFT JOIN bag b ON b.is_active = 1
       LEFT JOIN bag_club bc ON bc.bag_id = b.id AND bc.club_id = c.id
       ORDER BY bc.slot IS NULL, bc.slot, c.retired_on IS NOT NULL, c.loft_deg, c.label`,
    )
    .all();
}

const params = (c: ClubInput) => ({
  kind: c.kind,
  label: c.label,
  make: c.make,
  model: c.model,
  loftDeg: c.loftDeg,
  lieDeg: c.lieDeg,
  lengthM: c.lengthM,
  shaftMake: c.shaftMake,
  shaftModel: c.shaftModel,
  shaftFlex: c.shaftFlex,
  shaftWeightG: c.shaftWeightG,
  swingWeight: c.swingWeight,
  grip: c.grip,
  acquiredOn: c.acquiredOn,
  retiredOn: c.retiredOn,
  notes: c.notes,
});

export function saveClub(db: DB, id: number | null, c: ClubInput): number {
  if (id === null) {
    return Number(
      db
        .prepare(
          `INSERT INTO club (kind, label, make, model, loft_deg, lie_deg, length_m, shaft_make, shaft_model, shaft_flex,
             shaft_weight_g, swing_weight, grip, acquired_on, retired_on, notes, source)
           VALUES (@kind, @label, @make, @model, @loftDeg, @lieDeg, @lengthM, @shaftMake, @shaftModel, @shaftFlex,
             @shaftWeightG, @swingWeight, @grip, @acquiredOn, @retiredOn, @notes, 'manual')`,
        )
        .run(params(c)).lastInsertRowid,
    );
  }
  const res = db
    .prepare(
      `UPDATE club SET kind=@kind, label=@label, make=@make, model=@model, loft_deg=@loftDeg, lie_deg=@lieDeg,
         length_m=@lengthM, shaft_make=@shaftMake, shaft_model=@shaftModel, shaft_flex=@shaftFlex,
         shaft_weight_g=@shaftWeightG, swing_weight=@swingWeight, grip=@grip, acquired_on=@acquiredOn,
         retired_on=@retiredOn, notes=@notes, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id=@id`,
    )
    .run({ ...params(c), id });
  if (res.changes === 0) throw new DomainError('NOT_FOUND', 'That club no longer exists');
  // A retired club leaves the bag.
  if (c.retiredOn !== null) db.prepare('DELETE FROM bag_club WHERE club_id = ?').run(id);
  return id;
}

/** undefined leaves it alone; null clears it. */
export function setModelInfo(db: DB, id: number, info: ClubModelInfo | null | undefined): void {
  if (info === undefined) return;
  db.prepare('UPDATE club SET model_info = ? WHERE id = ?').run(info === null ? null : JSON.stringify(info), id);
}

export function deleteClub(db: DB, id: number): void {
  const used = db.prepare<[number], { n: number }>('SELECT count(*) AS n FROM shot WHERE club_id = ?').get(id)?.n ?? 0;
  if (used > 0) {
    throw new DomainError(
      'CONFLICT',
      `This club has ${used} recorded shot${used === 1 ? '' : 's'}. Set a retired date instead so its history stays intact.`,
    );
  }
  const res = db.prepare('DELETE FROM club WHERE id = ?').run(id);
  if (res.changes === 0) throw new DomainError('NOT_FOUND', 'That club no longer exists');
}

/** Replaces the active bag's contents (creating "My bag" if there's no active bag). */
export function setBagClubs(db: DB, clubIds: readonly number[]): void {
  db.transaction(() => {
    let bag = db.prepare<[], { id: number }>('SELECT id FROM bag WHERE is_active = 1').get();
    if (!bag) {
      const name = db.prepare("SELECT 1 FROM bag WHERE name = 'My bag'").get() ? `My bag ${Date.now()}` : 'My bag';
      bag = { id: Number(db.prepare("INSERT INTO bag (name, is_active) VALUES (?, 1)").run(name).lastInsertRowid) };
    }
    const retired = db
      .prepare<number[], { id: number }>(
        `SELECT id FROM club WHERE retired_on IS NOT NULL AND id IN (${clubIds.map(() => '?').join(',') || 'NULL'})`,
      )
      .all(...clubIds);
    if (retired.length > 0) throw new DomainError('VALIDATION', 'Retired clubs cannot go in the bag');
    db.prepare('DELETE FROM bag_club WHERE bag_id = ?').run(bag.id);
    const ins = db.prepare('INSERT INTO bag_club (bag_id, club_id, slot) VALUES (?, ?, ?)');
    clubIds.forEach((cid, i) => ins.run(bag.id, cid, i + 1));
  })();
}

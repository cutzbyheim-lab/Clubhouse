/**
 * Distance gapping between consecutive clubs. Thresholds are fitting rules of
 * thumb (stated in the UI as such), applied to the player's own averages.
 */

export const GAP_TIGHT_M = 6.4; // ≈ 7 yd
export const GAP_WIDE_M = 18.3; // ≈ 20 yd

export interface GapInput {
  clubId: number;
  label: string;
  loftDeg: number | null;
  carryM: number | null;
}

export interface Gap {
  fromClubId: number;
  toClubId: number;
  from: string;
  to: string;
  gapM: number;
  status: 'tight' | 'ok' | 'wide' | 'overlap';
}

/** Gaps between clubs ordered by loft; clubs without a reliable carry are skipped. */
export function computeGaps(clubs: readonly GapInput[]): Gap[] {
  const ordered = clubs
    .filter((c): c is GapInput & { carryM: number } => c.carryM !== null)
    .sort((a, b) => (a.loftDeg ?? 99) - (b.loftDeg ?? 99) || b.carryM - a.carryM);
  const gaps: Gap[] = [];
  for (let i = 1; i < ordered.length; i++) {
    const a = ordered[i - 1];
    const b = ordered[i];
    if (!a || !b) continue;
    const gapM = a.carryM - b.carryM;
    gaps.push({
      fromClubId: a.clubId,
      toClubId: b.clubId,
      from: a.label,
      to: b.label,
      gapM,
      status: gapM <= 0 ? 'overlap' : gapM < GAP_TIGHT_M ? 'tight' : gapM > GAP_WIDE_M ? 'wide' : 'ok',
    });
  }
  return gaps;
}

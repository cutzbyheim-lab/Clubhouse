/** Golf scoring rules, derived at read time (never stored). */

/** Green in regulation: on the green with two strokes to spare for par. */
export const isGir = (strokes: number, putts: number | null, par: number): boolean | null =>
  putts === null ? null : strokes - putts <= par - 2;

/** Scrambled: missed the green in regulation but still made par or better. */
export const isScramble = (strokes: number, putts: number | null, par: number): boolean | null => {
  const gir = isGir(strokes, putts, par);
  return gir === null || gir ? null : strokes <= par;
};

export const SCORE_NAMES = ['eagle', 'birdie', 'par', 'bogey', 'double', 'triple'] as const;
export type ScoreName = (typeof SCORE_NAMES)[number];

/** Score relative to par as a name; anything ≤ −2 is 'eagle', ≥ +3 is 'triple' (triple or worse). */
export function scoreName(strokes: number, par: number): ScoreName {
  const rel = strokes - par;
  if (rel <= -2) return 'eagle';
  if (rel === -1) return 'birdie';
  if (rel === 0) return 'par';
  if (rel === 1) return 'bogey';
  if (rel === 2) return 'double';
  return 'triple';
}

export const formatToPar = (rel: number): string => (rel === 0 ? 'E' : rel > 0 ? `+${rel}` : `${rel}`);

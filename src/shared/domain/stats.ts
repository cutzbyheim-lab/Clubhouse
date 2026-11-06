/** Small, dependency-free statistics. All functions return null on empty input. */

export const mean = (xs: readonly number[]): number | null =>
  xs.length === 0 ? null : xs.reduce((s, x) => s + x, 0) / xs.length;

/** Sample standard deviation (n − 1). Needs at least two values. */
export function sd(xs: readonly number[]): number | null {
  if (xs.length < 2) return null;
  const m = mean(xs) ?? 0;
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}

/** Linear-interpolated quantile, q in [0, 1]. */
export function quantile(xs: readonly number[], q: number): number | null {
  if (xs.length === 0) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * Math.min(1, Math.max(0, q));
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const a = sorted[lo] ?? 0;
  const b = sorted[hi] ?? a;
  return a + (b - a) * (pos - lo);
}

export const median = (xs: readonly number[]): number | null => quantile(xs, 0.5);

/** Values that are present (drops null/undefined). */
export const present = (xs: readonly (number | null | undefined)[]): number[] =>
  xs.filter((x): x is number => typeof x === 'number' && Number.isFinite(x));

/** Share of `hits` in `total`, or null if nothing to divide by. */
export const rate = (hits: number, total: number): number | null => (total > 0 ? hits / total : null);

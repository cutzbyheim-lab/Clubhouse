/**
 * Calendar date in the computer's own time zone, as YYYY-MM-DD.
 * (toISOString() is UTC, which is tomorrow for an evening round in the Americas.)
 */
export function localDate(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

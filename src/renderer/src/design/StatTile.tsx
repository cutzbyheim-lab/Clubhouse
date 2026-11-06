import type { ReactNode } from 'react';
import { CountUp } from './motion';

export interface Delta {
  /** Signed change, already in display units. */
  value: number;
  /** Is a lower number better for this metric (e.g. strokes)? */
  lowerIsBetter?: boolean;
  format?: (v: number) => string;
  against: string;
}

/**
 * A single headline figure. Always shows what it's based on (`basis`), and
 * shows an em dash with the reason when there isn't enough data.
 */
export function StatTile({
  label,
  value,
  unit,
  basis,
  delta,
  emptyReason,
  accent,
  animate,
}: {
  label: string;
  value: string | null;
  unit?: string;
  basis?: ReactNode;
  delta?: Delta | null;
  emptyReason?: string;
  accent?: boolean;
  /** Roll the figure up on first show, after this many ms. Used once, on the dashboard. */
  animate?: number;
}) {
  const improved = delta ? (delta.lowerIsBetter ? delta.value < 0 : delta.value > 0) : false;
  const flat = delta ? Math.abs(delta.value) < 1e-9 : true;
  return (
    <div className={`rounded-panel border border-rule bg-raised px-5 py-4 ${accent ? 'shadow-[inset_0_2px_0_var(--color-green-speed)]' : ''}`}>
      <div className="text-sm text-ink-muted">{label}</div>
      {value === null ? (
        <>
          <div className="figures mt-1 text-3xl font-semibold text-ink-faint">—</div>
          <div className="mt-1 text-xs text-ink-faint">{emptyReason ?? 'Not enough data yet'}</div>
        </>
      ) : (
        <>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="figures text-3xl font-semibold text-ink">{animate === undefined ? value : <CountUp text={value} delayMs={animate} />}</span>
            {unit && <span className="figures text-base text-ink-muted">{unit}</span>}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs">
            {delta && !flat && (
              <span className={improved ? 'text-green-speed' : 'text-hazard'}>
                {delta.value > 0 ? '▲' : '▼'} {(delta.format ?? ((v: number) => Math.abs(v).toFixed(1)))(Math.abs(delta.value))}{' '}
                <span className="text-ink-faint">vs {delta.against}</span>
              </span>
            )}
            {basis && <span className="text-ink-faint">{basis}</span>}
          </div>
        </>
      )}
    </div>
  );
}

import { useState, type ReactNode } from 'react';
import { Panel } from './Page';

/**
 * Chart colour roles, validated with the dataviz palette checker against the
 * raised surface (#242825): categorical order is fixed (never cycled).
 */
export const CAT = ['#3987e5', '#d95926', '#2f9e62', '#c98500'] as const;
export const SINGLE = '#5fae7c';
export const GRID = '#343a35';
export const AXIS = '#8c958d';
/** Score relative to par: diverging blue (under) · grey (par) · orange ramp (over). */
export const SCORE_COLORS = {
  eagle: '#2a6fc4',
  birdie: '#3987e5',
  par: '#5b645d',
  bogey: '#e0875f',
  double: '#d95926',
  triple: '#a8401b',
} as const;

export const axisProps = {
  stroke: AXIS,
  tick: { fill: AXIS, fontSize: 11, fontFamily: 'IBM Plex Sans Condensed' },
  tickLine: false,
  axisLine: { stroke: GRID },
} as const;

interface TooltipRow {
  name?: string | number;
  value?: number | string | readonly (number | string)[];
  color?: string;
  dataKey?: string | number;
}

/** Recharts tooltip body in the app's style. */
export function ChartTooltip({
  active,
  payload,
  label,
  format,
  labelFormat,
}: {
  active?: boolean;
  payload?: readonly TooltipRow[];
  label?: string | number;
  format?: (v: number, name: string) => string;
  labelFormat?: (l: string | number) => string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-control border border-rule-strong bg-overlay px-3 py-2 text-xs shadow-lg">
      {label !== undefined && <div className="mb-1 text-ink-muted">{labelFormat ? labelFormat(label) : label}</div>}
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: p.color }} aria-hidden />
          <span className="text-ink-soft">{String(p.name ?? p.dataKey ?? '')}</span>
          <span className="figures ml-auto pl-3 text-ink">
            {typeof p.value === 'number' && format ? format(p.value, String(p.name ?? '')) : String(p.value ?? '—')}
          </span>
        </div>
      ))}
    </div>
  );
}

export interface TableView {
  columns: string[];
  rows: (string | number)[][];
}

/** A titled chart panel with an always-available table view. */
export function ChartCard({
  title,
  subtitle,
  table,
  legend,
  children,
  className = '',
  height = 240,
}: {
  title: string;
  subtitle?: ReactNode;
  table?: TableView;
  legend?: { label: string; color: string; dashed?: boolean; square?: boolean }[];
  children: ReactNode;
  className?: string;
  height?: number;
}) {
  const [asTable, setAsTable] = useState(false);
  return (
    <Panel className={`flex flex-col p-5 ${className}`}>
      <div className="mb-3 flex items-start justify-between gap-4">
        <div>
          <h2 className="figures text-lg font-semibold">{title}</h2>
          {subtitle && <p className="text-xs text-ink-muted">{subtitle}</p>}
        </div>
        {table && (
          <button
            type="button"
            onClick={() => setAsTable((v) => !v)}
            className="shrink-0 rounded-control px-2 py-1 text-xs text-ink-muted hover:bg-overlay hover:text-ink"
          >
            {asTable ? 'Show chart' : 'Show table'}
          </button>
        )}
      </div>
      {legend && legend.length > 1 && !asTable && (
        <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-soft">
          {legend.map((l) => (
            <li key={l.label} className="flex items-center gap-1.5">
              <span
                className={l.square ? 'inline-block h-2.5 w-2.5 rounded-[2px]' : 'inline-block h-0.5 w-4'}
                style={{ background: l.dashed ? `repeating-linear-gradient(90deg, ${l.color} 0 4px, transparent 4px 7px)` : l.color }}
                aria-hidden
              />
              {l.label}
            </li>
          ))}
        </ul>
      )}
      {asTable && table ? (
        <div className="max-h-[320px] overflow-auto" data-selectable>
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-raised text-left text-xs text-ink-muted">
              <tr>
                {table.columns.map((c) => (
                  <th key={c} className="py-1.5 pr-4 font-medium">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="figures">
              {table.rows.map((r, i) => (
                <tr key={i} className="border-t border-rule">
                  {r.map((v, j) => (
                    <td key={j} className="py-1.5 pr-4 text-ink-soft">
                      {v}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ height }} className="min-w-0">
          {children}
        </div>
      )}
    </Panel>
  );
}

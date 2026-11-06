import { useMemo, useState } from 'react';
import type { ShotPoint } from '@shared/dto';
import { dispersionEllipse } from '@shared/domain/dispersion';
import { useUnits } from '@/stores/profile';

/**
 * Top-down view of where shots finished (carry vs offline), drawn like a
 * range: target line up the middle, distance rings, a 2σ ellipse around the
 * shots used in averages. Flagged mishits are hollow.
 */
export function RangeView({ shots, height = 440 }: { shots: readonly ShotPoint[]; height?: number }) {
  const u = useUnits();
  const [hover, setHover] = useState<ShotPoint | null>(null);
  const pts = shots.filter((s): s is ShotPoint & { carryM: number; offlineM: number } => s.carryM !== null && s.offlineM !== null);
  const used = pts.filter((s) => !s.excluded);

  const geo = useMemo(() => {
    const maxCarry = Math.max(50, ...pts.map((p) => p.carryM));
    const maxOff = Math.max(15, ...pts.map((p) => Math.abs(p.offlineM)));
    const ringStep = u.du === 'yards' ? 25 * 0.9144 : 25;
    const top = Math.ceil((maxCarry * 1.08) / ringStep) * ringStep;
    const minCarry = Math.min(...pts.map((p) => p.carryM), top);
    const bottom = Math.max(0, Math.floor((minCarry * 0.85) / ringStep) * ringStep - ringStep);
    const halfWidth = Math.max(maxOff * 1.25, (top - bottom) * 0.42);
    return { top, bottom, halfWidth, ringStep };
  }, [pts, u.du]);

  const W = 560;
  const H = height;
  const pad = { t: 18, b: 28, l: 16, r: 16 };
  const sx = (off: number) => pad.l + ((off + geo.halfWidth) / (2 * geo.halfWidth)) * (W - pad.l - pad.r);
  const sy = (carry: number) => pad.t + (1 - (carry - geo.bottom) / (geo.top - geo.bottom)) * (H - pad.t - pad.b);
  // Axes have different scales, so the ellipse is fitted in screen space, not data space.
  const ell = dispersionEllipse(used.map((p) => ({ x: sx(p.offlineM), y: sy(p.carryM) })));
  const meanX = used.length ? used.reduce((s, p) => s + p.offlineM, 0) / used.length : null;
  const meanY = used.length ? used.reduce((s, p) => s + p.carryM, 0) / used.length : null;

  const rings: number[] = [];
  for (let r = geo.bottom + geo.ringStep; r < geo.top; r += geo.ringStep) rings.push(r);

  if (pts.length === 0) {
    return <p className="py-16 text-center text-sm text-ink-faint">No shots with direction data for this club. Basic range trackers often don't capture it.</p>;
  }

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Shot dispersion: ${used.length} shots`}>
        <defs>
          <linearGradient id="turf" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#223a2b" />
            <stop offset="1" stopColor="#1b2620" />
          </linearGradient>
          <pattern id="mow" width="56" height="56" patternUnits="userSpaceOnUse">
            <rect width="28" height="56" fill="#ffffff" opacity="0.018" />
          </pattern>
        </defs>
        <rect x={pad.l} y={pad.t} width={W - pad.l - pad.r} height={H - pad.t - pad.b} rx={8} fill="url(#turf)" />
        <rect x={pad.l} y={pad.t} width={W - pad.l - pad.r} height={H - pad.t - pad.b} rx={8} fill="url(#mow)" />

        {rings.map((r) => (
          <g key={r}>
            <line x1={pad.l} x2={W - pad.r} y1={sy(r)} y2={sy(r)} stroke="#ffffff" strokeOpacity={0.07} />
            <text x={W - pad.r - 6} y={sy(r) - 4} textAnchor="end" className="figures" fontSize={10} fill="#8c958d">
              {Math.round(u.d(r))}
            </text>
          </g>
        ))}
        <line x1={sx(0)} x2={sx(0)} y1={pad.t} y2={H - pad.b} stroke="#e8eae3" strokeOpacity={0.35} strokeDasharray="2 5" />
        <text x={sx(0)} y={H - pad.b + 16} textAnchor="middle" fontSize={10} fill="#8c958d">
          target line
        </text>

        {ell && (
          <ellipse
            cx={ell.cx}
            cy={ell.cy}
            rx={ell.rx}
            ry={ell.ry}
            transform={`rotate(${ell.angleDeg} ${ell.cx} ${ell.cy})`}
            fill="#5fae7c"
            fillOpacity={0.08}
            stroke="#5fae7c"
            strokeOpacity={0.6}
            strokeDasharray="5 4"
          />
        )}

        {pts.map((p) => (
          <circle
            key={p.id}
            cx={sx(p.offlineM)}
            cy={sy(p.carryM)}
            r={hover?.id === p.id ? 6.5 : 4.5}
            fill={p.excluded ? 'none' : '#5fae7c'}
            fillOpacity={p.excluded ? 0 : 0.85}
            stroke={p.excluded ? '#8c958d' : '#1c1f1d'}
            strokeWidth={p.excluded ? 1.2 : 1.5}
            onMouseEnter={() => setHover(p)}
            onMouseLeave={() => setHover(null)}
          />
        ))}

        {meanX !== null && meanY !== null && (
          <g transform={`translate(${sx(meanX)} ${sy(meanY)})`} aria-hidden>
            <circle r={9} fill="none" stroke="#c4a35e" strokeWidth={1.5} />
            <line x1={-13} x2={13} stroke="#c4a35e" strokeWidth={1.5} />
            <line y1={-13} y2={13} stroke="#c4a35e" strokeWidth={1.5} />
          </g>
        )}
      </svg>

      <div className="pointer-events-none absolute top-6 left-7 rounded-control bg-ground/85 px-3 py-2 text-xs backdrop-blur">
        {hover ? (
          <div className="figures grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5">
            <span className="text-ink-muted">Carry</span>
            <span className="text-ink">{u.dist(hover.carryM, 1)}</span>
            <span className="text-ink-muted">Offline</span>
            <span className="text-ink">
              {u.dist(Math.abs(hover.offlineM ?? 0), 1)} {(hover.offlineM ?? 0) > 0 ? 'right' : (hover.offlineM ?? 0) < 0 ? 'left' : ''}
            </span>
            {hover.ballSpeedMps !== null && (
              <>
                <span className="text-ink-muted">Ball speed</span>
                <span className="text-ink">{u.speed(hover.ballSpeedMps)}</span>
              </>
            )}
            <span className="text-ink-muted">Date</span>
            <span className="text-ink">{hover.startedAt.slice(0, 10)}</span>
            {hover.excluded && <span className="col-span-2 text-ink-faint">Flagged as mishit</span>}
          </div>
        ) : (
          <ul className="flex flex-col gap-1 text-ink-soft">
            <li className="flex items-center gap-2">
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-green-speed" /> Shot ({used.length})
            </li>
            <li className="flex items-center gap-2">
              <span className="inline-block h-2.5 w-2.5 rounded-full border border-ink-muted" /> Mishit ({pts.length - used.length})
            </li>
            <li className="flex items-center gap-2">
              <span className="inline-block h-0 w-3 border-t border-dashed border-green-speed" /> 86% of shots (2σ)
            </li>
            <li className="flex items-center gap-2">
              <span className="text-brass">⊕</span> Average landing spot
            </li>
          </ul>
        )}
      </div>
    </div>
  );
}

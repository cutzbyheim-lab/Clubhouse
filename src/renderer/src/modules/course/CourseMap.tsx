import type { CoursePreview } from '@shared/dto';

type Pt = readonly [number, number];

/**
 * Top-down drawing of a whole course from its mapped outlines: fairways,
 * water, bunkers, greens and each hole's line of play with its number.
 */
export function CourseMap({
  overview,
  labels,
  highlight,
  height = 320,
  photo,
}: {
  overview: CoursePreview['overview'];
  labels: Record<string, string>;
  highlight?: string | null;
  height?: number;
  /** When given, the photo is drawn underneath and outlines are traced over it instead of filled. */
  photo?: CoursePreview['photo'];
}) {
  const pts: Pt[] = [...overview.holes.flatMap((h) => h.line), ...overview.greens.flat(), ...overview.fairways.flat()];
  if (pts.length === 0) {
    return <div className="flex items-center justify-center rounded-panel bg-sunken text-sm text-ink-faint" style={{ height }}>No holes mapped</div>;
  }
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const pad = 30;
  const minX = Math.min(...xs) - pad;
  const maxX = Math.max(...xs) + pad;
  const minY = Math.min(...ys) - pad;
  const maxY = Math.max(...ys) + pad;
  const w = maxX - minX;
  const h = maxY - minY;
  // North up: flip y.
  const path = (poly: readonly Pt[], close = true) =>
    poly.map((p, i) => `${i === 0 ? 'M' : 'L'}${(p[0] - minX).toFixed(1)},${(maxY - p[1]).toFixed(1)}`).join('') + (close ? 'Z' : '');
  const k = Math.max(w, h) / 600; // stroke scale

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full rounded-panel bg-[#1a2b20]" style={{ height }} role="img" aria-label="Map of the course's holes">
      {photo && (
        <image
          href={photo.dataUrl}
          x={photo.bounds[0] - minX}
          y={maxY - photo.bounds[3]}
          width={photo.bounds[2] - photo.bounds[0]}
          height={photo.bounds[3] - photo.bounds[1]}
          preserveAspectRatio="none"
        />
      )}
      {(
        [
          ['f', overview.fairways, '#3a7a4b', '#a8f0b8'],
          ['w', overview.water, '#2a5f80', '#7cc8ff'],
          ['b', overview.bunkers, '#d9c99b', '#ffd66b'],
          ['g', overview.greens, '#62b87b', '#ffffff'],
        ] as const
      ).map(([kind, list, fill, line]) =>
        list.map((f, i) => <path key={`${kind}${i}`} d={path(f)} fill={photo ? 'none' : fill} stroke={photo ? line : 'none'} strokeWidth={1.4 * k} />),
      )}
      {overview.holes.map((hole) => {
        const on = highlight === hole.key;
        const start = hole.line[0];
        return (
          <g key={hole.key} opacity={highlight && !on ? 0.45 : 1}>
            <path d={path(hole.line, false)} fill="none" stroke={on ? '#c4a35e' : '#e8eae3'} strokeOpacity={on ? 1 : 0.7} strokeWidth={(on ? 3 : 1.6) * k} strokeDasharray={on ? undefined : `${6 * k} ${4 * k}`} />
            {start && labels[hole.key] && (
              <g transform={`translate(${start[0] - minX} ${maxY - start[1]})`}>
                <circle r={9 * k} fill={on ? '#c4a35e' : '#1c1f1d'} stroke="#e8eae3" strokeWidth={1 * k} />
                <text textAnchor="middle" dy={3.6 * k} fontSize={10 * k} fill={on ? '#1c1f1d' : '#e8eae3'} fontFamily="IBM Plex Sans Condensed" fontWeight={600}>
                  {labels[hole.key]}
                </text>
              </g>
            )}
          </g>
        );
      })}
    </svg>
  );
}

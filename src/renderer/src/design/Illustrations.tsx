import type { CSSProperties, ReactNode } from 'react';

/*
 * Small line drawings for empty screens, in the same fine-line style as the
 * contours in the sidebar. Each draws itself in once when it appears.
 */

export type Art = 'flag' | 'flight' | 'bag' | 'contours' | 'target' | 'chart';

const draw = (i: number): CSSProperties => ({ ['--len' as string]: 1, strokeDasharray: 1, animationDelay: `${i * 120}ms` });

function Line({ d, i = 0, dashed = false, faint = false }: { d: string; i?: number; dashed?: boolean; faint?: boolean }) {
  if (dashed) return <path d={d} pathLength={1} className={faint ? 'opacity-50' : ''} strokeDasharray="0.02 0.025" />;
  return <path d={d} pathLength={1} style={draw(i)} className={`animate-draw ${faint ? 'opacity-50' : ''}`} />;
}

const ART: Record<Art, ReactNode> = {
  flag: (
    <>
      <Line i={0} d="M18 78 C 40 64, 120 62, 146 76 C 150 86, 60 94, 26 88 C 14 86, 12 81, 18 78 Z" />
      <Line i={1} faint d="M40 80 C 60 72, 108 71, 126 79" />
      <Line i={2} d="M98 77 L98 18" />
      <Line i={3} d="M98 18 L124 26 L98 34" />
      <ellipse cx="98" cy="78" rx="4" ry="1.6" className="fill-current opacity-60" stroke="none" />
      <Line dashed d="M30 60 Q 60 10, 92 70" />
      <circle cx="92" cy="70" r="2.2" className="fill-current" stroke="none" />
    </>
  ),
  flight: (
    <>
      <Line i={0} d="M8 84 L152 84" />
      <Line dashed d="M18 82 Q 74 -6, 132 80" />
      <circle cx="132" cy="80" r="2.6" className="fill-current" stroke="none" />
      {[40, 64, 88, 112].map((x, i) => (
        <Line key={x} i={i + 1} faint d={`M${x} 84 L${x} 89`} />
      ))}
      <Line i={2} d="M16 84 L16 76" />
    </>
  ),
  bag: (
    <>
      <Line i={0} d="M56 30 L60 88 Q 80 94, 100 88 L104 30 Q 80 24, 56 30 Z" />
      <Line i={1} faint d="M58 46 Q 80 41, 102 46" />
      <Line i={2} d="M64 30 L58 10 M58 10 Q 52 6, 50 11" />
      <Line i={3} d="M80 27 L80 8 M80 8 Q 74 4, 72 9" />
      <Line i={4} d="M96 30 L104 12 M104 12 L112 14 L110 18" />
      <Line i={5} d="M104 52 Q 118 60, 104 72" />
    </>
  ),
  contours: (
    <>
      {[0, 1, 2, 3].map((i) => (
        <ellipse
          key={i}
          cx="84"
          cy="56"
          rx={18 + i * 17}
          ry={10 + i * 9}
          transform={`rotate(${-10 + i * 3} 84 56)`}
          pathLength={1}
          style={draw(i)}
          className={`animate-draw ${i > 1 ? 'opacity-50' : ''}`}
        />
      ))}
      <Line i={4} d="M84 56 L84 26 L100 32 L84 38" />
    </>
  ),
  target: (
    <>
      {[34, 24, 14].map((r, i) => (
        <circle key={r} cx="80" cy="54" r={r} pathLength={1} style={draw(i)} className={`animate-draw ${i === 0 ? 'opacity-50' : ''}`} />
      ))}
      {[
        [70, 46],
        [92, 60],
        [84, 40],
        [64, 66],
        [100, 48],
      ].map(([x, y]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r="2.2" className="fill-current opacity-80" stroke="none" />
      ))}
    </>
  ),
  chart: (
    <>
      <Line i={0} d="M20 86 L148 86" faint />
      <Line i={1} d="M24 74 L50 62 L74 68 L98 42 L122 50 L144 24" />
      <circle cx="98" cy="42" r="10" pathLength={1} style={draw(2)} className="animate-draw opacity-60" />
      <Line i={3} d="M105 49 L114 58" />
    </>
  ),
};

export function Illustration({ art, className = '' }: { art: Art; className?: string }) {
  return (
    <svg viewBox="0 0 160 100" aria-hidden className={`h-[84px] w-[134px] text-green-speed ${className}`} fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
      {ART[art]}
    </svg>
  );
}

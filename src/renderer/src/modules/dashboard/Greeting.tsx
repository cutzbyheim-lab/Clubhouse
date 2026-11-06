import { useMemo } from 'react';
import { useProfile } from '@/stores/profile';

/** Organic closed contour around (cx, cy): a ring of a topographic map. */
function contour(cx: number, cy: number, rx: number, ry: number, k: number): string {
  const pts: string[] = [];
  const n = 72;
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.PI * 2;
    const wobble = 1 + 0.07 * Math.sin(3 * t + k * 0.9) + 0.045 * Math.cos(5 * t - k * 1.3) + 0.02 * Math.sin(9 * t + k);
    const x = cx + Math.cos(t) * rx * wobble;
    const y = cy + Math.sin(t) * ry * wobble;
    pts.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`);
  }
  return `${pts.join(' ')} Z`;
}

/** The green's contours, drawn in once when the dashboard opens; a pin marks the top. */
function GreenContours() {
  const rings = useMemo(
    () => Array.from({ length: 9 }, (_, k) => ({ d: contour(600 + k * 9, 128 - k * 2, 46 + k * 44, 22 + k * 20, k), k })),
    [],
  );
  return (
    <svg aria-hidden viewBox="0 0 900 220" preserveAspectRatio="xMaxYMid slice" className="pointer-events-none absolute inset-0 h-full w-full" fill="none">
      <defs>
        <linearGradient id="contour-fade" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="var(--color-fairway)" stopOpacity="0" />
          <stop offset="0.45" stopColor="var(--color-fairway)" stopOpacity="0.55" />
          <stop offset="1" stopColor="var(--color-green-speed)" stopOpacity="0.5" />
        </linearGradient>
      </defs>
      {rings.map(({ d, k }) => (
        <path
          key={k}
          d={d}
          pathLength={1}
          stroke="url(#contour-fade)"
          strokeWidth={k === 0 ? 1.4 : 1}
          strokeDasharray={1}
          className="animate-draw"
          style={{ ['--len' as string]: 1, animationDelay: `${k * 90}ms`, opacity: 1 - k * 0.07 }}
        />
      ))}
      <g className="animate-rise" style={{ animationDelay: '900ms' }}>
        <line x1="600" y1="128" x2="600" y2="86" stroke="var(--color-ink-soft)" strokeWidth="1.4" />
        <path d="M600 86 L620 92.5 L600 99 Z" fill="var(--color-brass)" />
        <ellipse cx="600" cy="128" rx="4" ry="1.8" fill="var(--color-ink-soft)" opacity="0.7" />
      </g>
    </svg>
  );
}

const partOfDay = (h: number) => (h < 5 ? 'Good evening' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening');

export function Greeting({ firstRun }: { firstRun: boolean }) {
  const name = useProfile((s) => s.profile?.displayName ?? null);
  const now = new Date();
  const date = now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  const hello = firstRun ? 'Welcome to Clubhouse' : `${partOfDay(now.getHours())}${name ? `, ${name}` : ''}`;
  return (
    <header className="relative overflow-hidden border-b border-rule bg-[radial-gradient(120%_140%_at_85%_10%,rgba(46,107,71,0.16)_0%,transparent_55%)] px-10 pt-11 pb-8">
      <GreenContours />
      <div className="relative">
        <p className="text-sm text-ink-muted">{date}</p>
        <h1 className="figures mt-1 text-4xl leading-tight font-semibold text-ink">{hello}</h1>
        <p className="mt-2 max-w-[60ch] text-ink-muted">
          {firstRun ? 'Your golf, measured and kept on this computer. Start wherever suits you.' : 'Where your game stands, from the rounds and shots you’ve recorded.'}
        </p>
      </div>
    </header>
  );
}

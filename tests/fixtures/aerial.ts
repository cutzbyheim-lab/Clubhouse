/**
 * Synthetic aerial photos of a hole, coloured like real summer leaf-on
 * imagery: mown rough, striped fairway, green, a bunker, a pond, lone trees
 * (broadleaf and conifer, with sunlit tops and cast shadows) and a block of
 * woods. Truth is known exactly, so detection can be scored.
 */
type P = [number, number];

export interface TrueTree {
  x: number;
  y: number;
  r: number;
  kind: 0 | 1;
}

export interface AerialScene {
  rgba: Uint8Array;
  width: number;
  height: number;
  bounds: [number, number, number, number];
  fairway: P[];
  green: P[];
  bunker: P[];
  water: P[];
  woods: { x0: number; y0: number; x1: number; y1: number };
  trees: TrueTree[];
  line: P[];
}

const inside = (x: number, y: number, poly: P[]) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
};

const ring = (cx: number, cy: number, rx: number, ry: number, n = 24): P[] =>
  Array.from({ length: n }, (_, i) => [cx + rx * Math.cos((i / n) * Math.PI * 2), cy + ry * Math.sin((i / n) * Math.PI * 2)] as P);

/** Seeded PRNG so fixtures are identical every run. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

export function aerialHole(opts: { mpp?: number; seed?: number; noTurf?: boolean; darkRough?: boolean } = {}): AerialScene {
  const mpp = opts.mpp ?? 0.6;
  const rand = rng(opts.seed ?? 7);
  const bounds: [number, number, number, number] = [-90, -40, 90, 400];
  const [x0, y0, x1, y1] = bounds;
  const width = Math.round((x1 - x0) / mpp);
  const height = Math.round((y1 - y0) / mpp);

  const fairway: P[] = [[-16, 40], [16, 40], [20, 200], [14, 330], [-14, 330], [-20, 200]];
  const green = ring(0, 352, 14, 12);
  const bunker = ring(22, 340, 6, 4);
  const water = ring(-45, 180, 14, 22);
  const woods = { x0: 45, y0: 210, x1: 88, y1: 300 };

  const trees: TrueTree[] = [];
  const clear = (x: number, y: number, r: number) =>
    ![fairway, green, bunker, water].some((p) => inside(x, y, p) || p.some(([px, py]) => Math.hypot(px - x, py - y) < r + 4)) &&
    !(x > woods.x0 - r - 4 && x < woods.x1 + r + 4 && y > woods.y0 - r - 4 && y < woods.y1 + r + 4) &&
    trees.every((t) => Math.hypot(t.x - x, t.y - y) > t.r + r + 3) &&
    Math.abs(x) < 85 && y > -35 && y < 395;
  // Lone trees along both sides of the hole.
  for (let tries = 0; trees.length < 34 && tries < 4000; tries++) {
    const side = rand() < 0.5 ? -1 : 1;
    const x = side * (28 + rand() * 55);
    const y = -20 + rand() * 400;
    const r = 2.2 + rand() * 3.8;
    if (clear(x, y, r)) trees.push({ x, y, r, kind: rand() < 0.35 ? 1 : 0 });
  }
  const woodsTrees: TrueTree[] = [];
  for (let y = woods.y0 + 3; y < woods.y1; y += 6.5)
    for (let x = woods.x0 + 3; x < woods.x1; x += 6.5) woodsTrees.push({ x: x + (rand() - 0.5) * 2, y: y + (rand() - 0.5) * 2, r: 3.6 + rand() * 1.6, kind: 0 });

  const all = [...trees, ...woodsTrees];
  const rgba = new Uint8Array(width * height * 4);
  const sun: P = [-0.6, 0.45]; // light from the upper left; shadows fall down-right
  for (let row = 0; row < height; row++) {
    const y = y1 - (row + 0.5) * mpp;
    for (let col = 0; col < width; col++) {
      const x = x0 + (col + 0.5) * mpp;
      const n = rand() - 0.5;
      // Rough: light and fine, or (darkRough) darker and much grainier, as in heavy or patchy rough.
      let c: [number, number, number] = opts.noTurf
        ? [128 + n * 20, 128 + n * 20, 128 + n * 20]
        : opts.darkRough
          ? [62 + n * 22, 98 + n * 22, 58 + n * 22]
          : [96 + n * 16, 122 + n * 16, 72 + n * 12];
      if (!opts.noTurf) {
        if (inside(x, y, fairway)) c = Math.floor(y / 9) % 2 ? [112 + n * 8, 150 + n * 8, 84 + n * 6] : [104 + n * 8, 140 + n * 8, 78 + n * 6];
        if (inside(x, y, green)) c = [102 + n * 6, 156 + n * 6, 88 + n * 6];
        if (inside(x, y, bunker)) c = [226 + n * 10, 214 + n * 10, 176 + n * 10];
        if (inside(x, y, water)) c = [40 + n * 6, 66 + n * 6, 88 + n * 8];
        // Shadows cast by trees onto the ground.
        for (const t of all) {
          const sx = t.x - sun[0] * t.r * 0.9, sy = t.y - sun[1] * t.r * 0.9;
          if (Math.hypot(x - sx, y - sy) < t.r * 0.95) c = [c[0] * 0.55, c[1] * 0.58, c[2] * 0.6];
        }
        // Crowns: textured, sunlit on the side facing the light.
        for (const t of all) {
          const dx = x - t.x, dy = y - t.y;
          const d = Math.hypot(dx, dy);
          if (d > t.r) continue;
          const lit = 0.5 + 0.5 * ((dx * sun[0] + dy * sun[1]) / (t.r || 1));
          const clump = Math.sin(dx * 1.7 + t.x) * Math.cos(dy * 1.9 + t.y) * 14;
          const base: [number, number, number] = opts.darkRough ? (t.kind === 1 ? [26, 44, 40] : [40, 62, 34]) : t.kind === 1 ? [34, 56, 50] : [56, 82, 44];
          const k = 0.75 + lit * 0.55;
          c = [base[0] * k + clump + n * 18, base[1] * k + clump + n * 20, base[2] * k + clump * 0.6 + n * 14];
        }
      }
      const i = (row * width + col) * 4;
      rgba[i] = Math.max(0, Math.min(255, c[0]));
      rgba[i + 1] = Math.max(0, Math.min(255, c[1]));
      rgba[i + 2] = Math.max(0, Math.min(255, c[2]));
      rgba[i + 3] = 255;
    }
  }
  return { rgba, width, height, bounds, fairway, green, bunker, water, woods, trees, line: [[0, 0], [0, 200], [0, 352]] };
}

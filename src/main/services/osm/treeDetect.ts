/**
 * Finds trees in a hole's aerial photo.
 *
 * Seen from above, tree crowns are darker and more textured than mown turf,
 * and still green. Rather than fixed colour thresholds (which break between
 * photos, seasons and regions), every threshold is measured against this
 * hole's own fairways and greens, whose outlines we already know.
 *
 * 1. Resample the photo to a ~1 m grid in the hole frame.
 * 2. Canopy = green pixels clearly darker or rougher than the hole's turf,
 *    outside mapped greens, tees, fairways, bunkers and water.
 * 3. Clean the mask (open, drop specks), then a distance transform gives how
 *    far each canopy pixel is from open ground.
 * 4. Place crowns greedily from the most interior pixel outwards, so lone
 *    trees get one crown sized to their outline and woods fill with crowns.
 * 5. Each crown's colour separates darker, bluer conifers from broadleaf.
 *
 * Crown positions and sizes come from the photo. Heights can't be seen from
 * straight above, so they're estimated from crown size (typical crown-to-
 * height proportions) and are labelled as estimates wherever shown.
 */

export type P = readonly [number, number];
/** [x, y, crown radius m, estimated height m, kind: 0 broadleaf, 1 conifer], hole frame. */
export type DetectedTree = [number, number, number, number, 0 | 1];

export interface TreeInput {
  rgba: Uint8Array;
  width: number;
  height: number;
  /** Frame rectangle the image covers: [x0, y0, x1, y1]; row 0 is y1 (the far end). */
  bounds: readonly [number, number, number, number];
  /** Where trees can't be: mapped greens, tees, fairways, bunkers, water (frame coordinates). */
  avoid: readonly (readonly P[])[];
  /** Mapped turf (fairways, greens) used as this hole's reference for "not a tree". */
  turf: readonly (readonly P[])[];
  /** Line of play; when there are more trees than kept, the nearest are kept. */
  line: readonly P[];
}

export interface TreeResult {
  trees: DetectedTree[];
  /** Share of the photo (outside mapped features) that is tree canopy. */
  canopyShare: number;
  /** False when there was no usable turf reference or photo; trees is then empty. */
  reliable: boolean;
}

export const MAX_TREES_PER_HOLE = 1500;
const CELL_M = 1;
const MIN_CROWN_M = 1.6;
const MAX_CROWN_M = 6.5;
const MIN_CLUMP_M2 = 9;

/** Deterministic 0..1 noise from a position, so the same photo always gives the same trees. */
const hash = (x: number, y: number) => {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return s - Math.floor(s);
};

function median(values: Float32Array | number[], count = values.length): number {
  if (count === 0) return 0;
  const a = Array.from(values.slice(0, count)).sort((p, q) => p - q);
  return a[Math.floor(a.length / 2)] ?? 0;
}

/** Scanline fill of a polygon (grid coordinates) into a mask. */
function fill(mask: Uint8Array, gw: number, gh: number, poly: readonly P[]): void {
  if (poly.length < 3) return;
  const ys = poly.map((p) => p[1]);
  const r0 = Math.max(0, Math.floor(Math.min(...ys)));
  const r1 = Math.min(gh - 1, Math.ceil(Math.max(...ys)));
  const xs: number[] = [];
  for (let r = r0; r <= r1; r++) {
    const y = r + 0.5;
    xs.length = 0;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i]!;
      const b = poly[j]!;
      if (a[1] > y !== b[1] > y) xs.push(a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const c0 = Math.max(0, Math.ceil(xs[k]! - 0.5));
      const c1 = Math.min(gw - 1, Math.floor(xs[k + 1]! - 0.5));
      for (let c = c0; c <= c1; c++) mask[r * gw + c] = 1;
    }
  }
}

function distToLine(p: P, line: readonly P[]): number {
  if (line.length === 1) return Math.hypot(p[0] - line[0]![0], p[1] - line[0]![1]);
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!;
    const b = line[i]!;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy));
  }
  return best;
}

export function detectTrees(input: TreeInput): TreeResult {
  const none: TreeResult = { trees: [], canopyShare: 0, reliable: false };
  const [x0, y0, x1, y1] = input.bounds;
  const wM = x1 - x0;
  const hM = y1 - y0;
  if (wM <= 0 || hM <= 0 || input.width < 16 || input.height < 16) return none;
  const gw = Math.min(1600, Math.max(8, Math.round(wM / CELL_M)));
  const gh = Math.min(1600, Math.max(8, Math.round(hM / CELL_M)));
  const cx = wM / gw; // metres per cell
  const cy = hM / gh;
  const n = gw * gh;

  // Grid row 0 is y0 (near the tee) so grid y grows with frame y.
  const toGrid = (p: P): P => [(p[0] - x0) / cx, (p[1] - y0) / cy];
  const toFrame = (c: number, r: number): P => [x0 + (c + 0.5) * cx, y0 + (r + 0.5) * cy];

  // ── 1. Resample: box-average the photo pixels that fall in each cell.
  const L = new Float32Array(n);
  const G = new Float32Array(n); // normalised greenness (2G − R − B) / (R + G + B)
  const Bl = new Float32Array(n); // blue share B / (R + G + B)
  const sx = input.width / gw;
  const sy = input.height / gh;
  for (let r = 0; r < gh; r++) {
    // Image row 0 is the far end (y1).
    const iy0 = Math.floor((gh - 1 - r) * sy);
    const iy1 = Math.max(iy0 + 1, Math.floor((gh - r) * sy));
    for (let c = 0; c < gw; c++) {
      const ix0 = Math.floor(c * sx);
      const ix1 = Math.max(ix0 + 1, Math.floor((c + 1) * sx));
      let R = 0, Gs = 0, B = 0, k = 0;
      for (let iy = iy0; iy < iy1 && iy < input.height; iy++) {
        for (let ix = ix0; ix < ix1 && ix < input.width; ix++) {
          const i = (iy * input.width + ix) * 4;
          R += input.rgba[i]!;
          Gs += input.rgba[i + 1]!;
          B += input.rgba[i + 2]!;
          k++;
        }
      }
      if (k === 0) continue;
      R /= k; Gs /= k; B /= k;
      const sum = R + Gs + B + 1;
      const j = r * gw + c;
      L[j] = 0.299 * R + 0.587 * Gs + 0.114 * B;
      G[j] = (2 * Gs - R - B) / sum;
      Bl[j] = B / sum;
    }
  }

  // ── Masks for mapped features.
  const avoid = new Uint8Array(n);
  for (const poly of input.avoid) fill(avoid, gw, gh, poly.map(toGrid));
  const turf = new Uint8Array(n);
  for (const poly of input.turf) fill(turf, gw, gh, poly.map(toGrid));

  // ── Local roughness: standard deviation of brightness over ~3 m.
  const I = new Float64Array((gw + 1) * (gh + 1));
  const I2 = new Float64Array((gw + 1) * (gh + 1));
  for (let r = 0; r < gh; r++) {
    let row = 0, row2 = 0;
    for (let c = 0; c < gw; c++) {
      const v = L[r * gw + c]!;
      row += v;
      row2 += v * v;
      I[(r + 1) * (gw + 1) + c + 1] = I[r * (gw + 1) + c + 1]! + row;
      I2[(r + 1) * (gw + 1) + c + 1] = I2[r * (gw + 1) + c + 1]! + row2;
    }
  }
  const rad = Math.max(1, Math.round(1 / cx)); // 3×3 m window: wider ones bleed crowns onto the grass around them
  const tex = new Float32Array(n);
  for (let r = 0; r < gh; r++) {
    const ra = Math.max(0, r - rad), rb = Math.min(gh, r + rad + 1);
    for (let c = 0; c < gw; c++) {
      const ca = Math.max(0, c - rad), cb = Math.min(gw, c + rad + 1);
      const area = (rb - ra) * (cb - ca);
      const at = (A: Float64Array) => A[rb * (gw + 1) + cb]! - A[ra * (gw + 1) + cb]! - A[rb * (gw + 1) + ca]! + A[ra * (gw + 1) + ca]!;
      const m = at(I) / area;
      tex[r * gw + c] = Math.sqrt(Math.max(0, at(I2) / area - m * m));
    }
  }

  // ── 2. The hole's own turf as the reference.
  const turfL: number[] = [], turfG: number[] = [], turfT: number[] = [];
  for (let j = 0; j < n; j++) {
    if (turf[j] && L[j]! > 0) {
      turfL.push(L[j]!);
      turfG.push(G[j]!);
      turfT.push(tex[j]!);
    }
  }
  let refL: number, refG: number, refT: number;
  if (turfL.length >= 150) {
    refL = median(turfL);
    refG = median(turfG);
    refT = median(turfT);
  } else {
    // No mapped turf to compare with: use the brighter half of green ground instead.
    const greenL: number[] = [], greenG: number[] = [], greenT: number[] = [];
    for (let j = 0; j < n; j++) if (G[j]! > 0.05 && !avoid[j]) (greenL.push(L[j]!), greenG.push(G[j]!), greenT.push(tex[j]!));
    if (greenL.length < 300) return none;
    const sorted = [...greenL].sort((a, b) => a - b);
    refL = sorted[Math.floor(sorted.length * 0.7)] ?? 0;
    refG = median(greenG);
    refT = median(greenT);
  }
  if (refL < 25 || refG < 0.03) return none; // not a usable photo of turf (night, snow, black tiles)
  // Open ground (the rough) is usually darker and rougher than fairways, so trees are judged
  // against it too. It's the brightest common level of green ground outside mapped features;
  // woods, if there are any, form a darker level below it.
  const bins = new Float64Array(64);
  let greenCount = 0;
  for (let j = 0; j < n; j++) {
    if (avoid[j] || G[j]! <= refG * 0.3 || L[j]! <= 0) continue;
    bins[Math.min(63, Math.floor(L[j]! / 4))]! += 1;
    greenCount++;
  }
  let roughL = refL;
  if (greenCount >= 300) {
    // Heavily smoothed histogram, so pixel noise can't make false peaks; the brightest level
    // holding a real share of the ground is the rough.
    const smooth = Array.from(bins, (_, i) => {
      let v = 0, w = 0;
      for (let k = -6; k <= 6; k++) {
        const g = Math.exp(-(k * k) / 18);
        v += (bins[i + k] ?? 0) * g;
        w += g;
      }
      return v / w;
    });
    for (let i = 62; i >= 1; i--) {
      const v = smooth[i]!;
      if (v < smooth[i - 1]! || v < smooth[i + 1]!) continue;
      let mass = 0;
      for (let k = Math.max(0, i - 4); k <= Math.min(63, i + 4); k++) mass += bins[k]!;
      if (mass >= greenCount * 0.15) {
        roughL = Math.min(refL, (i + 0.5) * 4);
        break;
      }
    }
  }
  const roughT: number[] = [];
  for (let j = 0; j < n; j++) if (!avoid[j] && G[j]! > refG * 0.3 && Math.abs(L[j]! - roughL) < roughL * 0.12) roughT.push(tex[j]!);
  if (roughT.length >= 300) refT = Math.max(refT, median(roughT));
  const darkBelow = Math.min(refL * 0.76, roughL * 0.82);
  const roughBelow = Math.min(refL * 0.84, roughL * 0.95);

  const canopy = new Uint8Array(n);
  let open = 0, canopied = 0;
  for (let j = 0; j < n; j++) {
    if (avoid[j] || L[j]! <= 0) continue;
    open++;
    const green = G[j]! > Math.max(0.025, refG * 0.3);
    // Shade on grass is dark too, but smoother than the lit turf; foliage is dark and rough.
    const dark = L[j]! < darkBelow && tex[j]! >= refT * 0.95;
    const rough = tex[j]! > refT * 1.8 + 2 && L[j]! < roughBelow;
    if (green && (dark || rough)) canopy[j] = 1;
  }

  // ── 3. Clean up. Close first (dilate then erode) so sunlit patches inside a crown don't
  // split it into several small trees, then open (erode then dilate) to drop specks, then
  // drop clumps too small to be a tree. Mapped features stay excluded throughout.
  const grow = (src: Uint8Array): Uint8Array => {
    const out = new Uint8Array(n);
    for (let r = 1; r < gh - 1; r++)
      for (let c = 1; c < gw - 1; c++) {
        const j = r * gw + c;
        out[j] = src[j]! | src[j - 1]! | src[j + 1]! | src[j - gw]! | src[j + gw]!;
      }
    return out;
  };
  const shrink = (src: Uint8Array): Uint8Array => {
    const out = new Uint8Array(n);
    for (let r = 1; r < gh - 1; r++)
      for (let c = 1; c < gw - 1; c++) {
        const j = r * gw + c;
        out[j] = src[j]! & src[j - 1]! & src[j + 1]! & src[j - gw]! & src[j + gw]!;
      }
    return out;
  };
  const closed = shrink(grow(canopy));
  for (let j = 0; j < n; j++) if (avoid[j]) closed[j] = 0;
  const mask = grow(shrink(closed));
  for (let j = 0; j < n; j++) if (avoid[j] || !closed[j]) mask[j] = 0;
  const minCells = MIN_CLUMP_M2 / (cx * cy);
  const seen = new Uint8Array(n);
  const stack: number[] = [];
  const clump: number[] = [];
  for (let j = 0; j < n; j++) {
    if (!mask[j] || seen[j]) continue;
    clump.length = 0;
    stack.push(j);
    seen[j] = 1;
    while (stack.length) {
      const k = stack.pop()!;
      clump.push(k);
      const r = Math.floor(k / gw), c = k % gw;
      for (const nb of [c > 0 ? k - 1 : -1, c < gw - 1 ? k + 1 : -1, r > 0 ? k - gw : -1, r < gh - 1 ? k + gw : -1]) {
        if (nb >= 0 && mask[nb] && !seen[nb]) (seen[nb] = 1), stack.push(nb);
      }
    }
    if (clump.length < minCells) for (const k of clump) mask[k] = 0;
  }
  for (let j = 0; j < n; j++) if (mask[j]) canopied++;

  // ── Distance from open ground, in metres (two-pass chamfer).
  const BIG = 1e6;
  const dist = new Float32Array(n);
  for (let j = 0; j < n; j++) dist[j] = mask[j] ? BIG : 0;
  const diag = Math.hypot(cx, cy);
  for (let r = 0; r < gh; r++)
    for (let c = 0; c < gw; c++) {
      const j = r * gw + c;
      if (!dist[j]) continue;
      let d = dist[j]!;
      if (c > 0) d = Math.min(d, dist[j - 1]! + cx);
      if (r > 0) d = Math.min(d, dist[j - gw]! + cy);
      if (r > 0 && c > 0) d = Math.min(d, dist[j - gw - 1]! + diag);
      if (r > 0 && c < gw - 1) d = Math.min(d, dist[j - gw + 1]! + diag);
      dist[j] = c === 0 || r === 0 ? Math.min(d, Math.min(cx, cy)) : d;
    }
  for (let r = gh - 1; r >= 0; r--)
    for (let c = gw - 1; c >= 0; c--) {
      const j = r * gw + c;
      if (!dist[j]) continue;
      let d = dist[j]!;
      if (c < gw - 1) d = Math.min(d, dist[j + 1]! + cx);
      if (r < gh - 1) d = Math.min(d, dist[j + gw]! + cy);
      if (r < gh - 1 && c < gw - 1) d = Math.min(d, dist[j + gw + 1]! + diag);
      if (r < gh - 1 && c > 0) d = Math.min(d, dist[j + gw - 1]! + diag);
      dist[j] = c === gw - 1 || r === gh - 1 ? Math.min(d, Math.min(cx, cy)) : d;
    }

  // ── 4. Crowns, from the most interior canopy outwards.
  const order: number[] = [];
  for (let j = 0; j < n; j++) if (mask[j] && dist[j]! >= MIN_CROWN_M * 0.8) order.push(j);
  order.sort((a, b) => dist[b]! - dist[a]! || a - b);
  const covered = new Uint8Array(n);
  const canopyL: number[] = [];
  const canopyB: number[] = [];
  for (let j = 0; j < n; j++) if (mask[j]) (canopyL.push(L[j]!), canopyB.push(Bl[j]!));
  const medL = median(canopyL);
  const medB = median(canopyB);

  const found: Array<{ p: P; r: number; h: number; kind: 0 | 1 }> = [];
  // Placed crowns bucketed on a coarse grid for neighbour checks.
  const BUCKET = 8;
  const buckets = new Map<number, number[]>();
  const bucketKey = (bx: number, by: number) => bx * 100_003 + by;
  const tooClose = (p: P, crown: number) => {
    const bx = Math.floor(p[0] / BUCKET), by = Math.floor(p[1] / BUCKET);
    for (let ix = bx - 2; ix <= bx + 2; ix++)
      for (let iy = by - 2; iy <= by + 2; iy++)
        for (const k of buckets.get(bucketKey(ix, iy)) ?? []) {
          const t = found[k]!;
          const gap = Math.hypot(t.p[0] - p[0], t.p[1] - p[1]);
          // Neighbouring crowns may touch and overlap a little, not sit inside each other;
          // slivers left at the edge of a crown are part of it, not another tree.
          if (gap < 0.8 * (t.r + crown) || (crown < 2.2 && gap < t.r + 2.5)) return true;
        }
    return false;
  };
  for (const j of order) {
    if (covered[j]) continue;
    const r = Math.floor(j / gw), c = j % gw;
    const d = dist[j]!;
    const noise = hash(c, r);
    // Inside woods the distance keeps growing; real crowns there are a few metres across.
    const crown = d <= MAX_CROWN_M ? Math.max(MIN_CROWN_M, d) : 3.6 + noise * 2.9;
    const centre = toFrame(c, r);
    if (tooClose(centre, crown)) continue;
    const rc = Math.ceil(crown / cx), rr = Math.ceil(crown / cy);
    let sumL = 0, sumB = 0, k = 0;
    for (let dr = -rr; dr <= rr; dr++) {
      const rr2 = r + dr;
      if (rr2 < 0 || rr2 >= gh) continue;
      for (let dc = -rc; dc <= rc; dc++) {
        const cc = c + dc;
        if (cc < 0 || cc >= gw) continue;
        const e = Math.hypot(dc * cx, dr * cy);
        if (e > crown) continue;
        const q = rr2 * gw + cc;
        if (e <= crown * 0.9) covered[q] = 1;
        if (mask[q]) (sumL += L[q]!, sumB += Bl[q]!, k++);
      }
    }
    if (k === 0) continue;
    // Conifers read darker and bluer than the broadleaf canopy around them.
    const conifer = sumB / k > medB + 0.012 && sumL / k < medL * 0.97;
    const estimate = crown * (conifer ? 3.1 : 2.3) + 2 + (noise - 0.5) * 3;
    const bk = bucketKey(Math.floor(centre[0] / BUCKET), Math.floor(centre[1] / BUCKET));
    buckets.set(bk, [...(buckets.get(bk) ?? []), found.length]);
    found.push({ p: centre, r: crown, h: Math.max(4, Math.min(32, estimate)), kind: conifer ? 1 : 0 });
  }

  // ── Keep the trees nearest the line of play if there are too many to draw.
  const ranked = found.length > MAX_TREES_PER_HOLE ? found.map((t) => ({ t, d: distToLine(t.p, input.line) })).sort((a, b) => a.d - b.d).slice(0, MAX_TREES_PER_HOLE).map((x) => x.t) : found;
  const r1 = (v: number) => Math.round(v * 10) / 10;
  return {
    trees: ranked.map((t) => [r1(t.p[0]), r1(t.p[1]), r1(t.r), r1(t.h), t.kind]),
    canopyShare: open ? canopied / open : 0,
    reliable: true,
  };
}

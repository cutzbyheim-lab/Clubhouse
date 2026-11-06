import * as THREE from 'three';
import { addTrees, photoSampler, type TreeSpot } from './trees3d';
import type { HoleTrack } from '@shared/dto';
import type { HoleGeometry } from '@shared/schemas';

/*
 * Builds a Three.js scene for one hole from its stored layout.
 *
 * Frame: the layout uses metres with the tee at the origin, +y toward the
 * green, +x to the player's right. In world space that becomes x → x,
 * y → −z (down the screen), elevation → y.
 */

export type Vec2 = readonly [number, number];

/** Where the light comes from; tree shadows on the map surface fall away from it. */
const SUN = new THREE.Vector3(-120, 200, 80);

const COLORS = {
  sky: 0x1c1f1d,
  rough: 0x1f3a28,
  roughDark: 0x18301f,
  fairwayA: 0x3f8452,
  fairwayB: 0x397a4b,
  green: 0x56aa6f,
  fringe: 0x47915d,
  tee: 0x4b9a62,
  sand: 0xd9c99b,
  water: 0x2a5f80,
  flag: 0xc4a35e,
  pin: 0xe8eae3,
};

/** Deterministic noise so a hole always looks the same. */
function hash(n: number): number {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return s - Math.floor(s);
}

function smoothCurve(points: readonly Vec2[]): THREE.CatmullRomCurve3 {
  return new THREE.CatmullRomCurve3(
    points.map(([x, y]) => new THREE.Vector3(x, 0, -y)),
    false,
    'centripetal',
  );
}

export interface SceneHandles {
  scene: THREE.Scene;
  /** Camera presets, as position + look-at target. */
  views: Record<'tee' | 'overhead' | 'green', { pos: THREE.Vector3; target: THREE.Vector3 }>;
  dispose: () => void;
}

export type Surface = 'map' | 'photo' | 'both';

type Bounds = [number, number, number, number];

/**
 * Paints the ground texture for a mapped hole: either the mapped features
 * ('map') or the aerial photo with the map's outlines traced over it ('both'),
 * so the player can see for themselves whether the map matches the course.
 * Row 0 of the canvas is the far end (y1), matching the photo's orientation.
 */
function paintSurface(g: HoleGeometry, bounds: Bounds, mode: 'map' | 'both', photo: HTMLImageElement | null): HTMLCanvasElement {
  const [x0, y0, x1, y1] = bounds;
  const ppm = Math.min(3, 4096 / Math.max(x1 - x0, y1 - y0));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(2, Math.round((x1 - x0) * ppm));
  canvas.height = Math.max(2, Math.round((y1 - y0) * ppm));
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const o = g.outlines ?? { greens: [], tees: [], fairways: [], bunkers: [], water: [] };
  const trace = (poly: readonly (readonly [number, number])[]) => {
    ctx.beginPath();
    poly.forEach(([x, y], i) => (i === 0 ? ctx.moveTo((x - x0) * ppm, (y1 - y) * ppm) : ctx.lineTo((x - x0) * ppm, (y1 - y) * ppm)));
    ctx.closePath();
  };

  if (mode === 'both' && photo) {
    ctx.drawImage(photo, 0, 0, canvas.width, canvas.height);
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(2, 0.45 * ppm);
    const stroke = (list: readonly (readonly (readonly [number, number])[])[], color: string) => {
      ctx.strokeStyle = color;
      list.forEach((poly) => (trace(poly), ctx.stroke()));
    };
    stroke(o.fairways, '#a8f0b8');
    stroke(o.water, '#7cc8ff');
    stroke(o.tees, '#ffffff');
    stroke(o.bunkers, '#ffd66b');
    stroke(o.greens, '#ffffff');
    return canvas;
  }

  // Rough, with a little texture so the ground doesn't read as plastic.
  ctx.fillStyle = '#1f3a28';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < 2600; i++) {
    ctx.fillStyle = hash(i * 1.7) < 0.5 ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.035)';
    const s = (2 + hash(i * 3.3) * 6) * ppm;
    ctx.fillRect(hash(i * 5.1) * canvas.width, hash(i * 7.9) * canvas.height, s, s);
  }
  ctx.fillStyle = '#2a5f80';
  o.water.forEach((poly) => (trace(poly), ctx.fill()));
  // Fairways: mowing bands every 7 m across the line of play.
  for (const poly of o.fairways) {
    ctx.save();
    trace(poly);
    ctx.clip();
    for (let y = Math.floor(y0 / 7) * 7; y < y1; y += 7) {
      ctx.fillStyle = Math.round(y / 7) % 2 === 0 ? '#3f8452' : '#397a4b';
      ctx.fillRect(0, (y1 - y - 7) * ppm, canvas.width, 7 * ppm + 1);
    }
    ctx.restore();
  }
  ctx.fillStyle = '#4b9a62';
  o.tees.forEach((poly) => (trace(poly), ctx.fill()));
  ctx.fillStyle = '#d9c99b';
  o.bunkers.forEach((poly) => (trace(poly), ctx.fill()));
  ctx.lineWidth = 2.2 * ppm;
  ctx.strokeStyle = '#47915d';
  ctx.fillStyle = '#56aa6f';
  if (o.greens.length > 0) o.greens.forEach((poly) => (trace(poly), ctx.stroke(), ctx.fill()));
  else {
    ctx.beginPath();
    ctx.arc((g.green.center[0] - x0) * ppm, (y1 - g.green.center[1]) * ppm, g.green.radiusM * ppm, 0, Math.PI * 2);
    ctx.fill();
  }
  return canvas;
}

export function buildHoleScene(opts: {
  geometry: HoleGeometry;
  holeNumber: number;
  tracks: { track: HoleTrack; color: string }[];
  /** Distance markers from the green centre, in metres, with their display labels. */
  markers: { m: number; label: string }[];
  /** Ground surface for mapped holes. 'photo' and 'both' need `photo`. */
  surface?: Surface;
  photo?: HTMLImageElement | null;
  /** Draw 3D trees (default true). */
  showTrees?: boolean;
}): SceneHandles {
  const { geometry: g, holeNumber, tracks, markers } = opts;
  const photo = opts.photo ?? null;
  const surface: Surface = photo ? (opts.surface ?? 'photo') : 'map';
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(COLORS.sky);
  const disposables: { dispose: () => void }[] = [];
  const track = <T extends { dispose: () => void }>(d: T): T => (disposables.push(d), d);

  const centre = smoothCurve(g.centerline);
  const length = centre.getLength();
  const greenC = new THREE.Vector3(g.green.center[0], 0, -g.green.center[1]);
  const seed = holeNumber * 31.7;
  /** Real mapped layout: drawn as mapped, on measured terrain (or flat if none), with only mapped trees. */
  const isMap = g.source === 'map' && !!g.outlines;
  const elev = g.elevation;

  /** Measured ground height at a frame point, bilinear over the elevation grid. */
  const measured = (fx: number, fy: number): number => {
    if (!elev) return 0;
    const cx = (fx - elev.x0) / elev.stepM;
    const cy = (fy - elev.y0) / elev.stepM;
    const c0 = Math.max(0, Math.min(elev.cols - 2, Math.floor(cx)));
    const r0 = Math.max(0, Math.min(elev.rows - 2, Math.floor(cy)));
    const ax = Math.max(0, Math.min(1, cx - c0));
    const ay = Math.max(0, Math.min(1, cy - r0));
    const at = (c: number, r: number) => elev.heights[r * elev.cols + c] ?? 0;
    return (at(c0, r0) * (1 - ax) + at(c0 + 1, r0) * ax) * (1 - ay) + (at(c0, r0 + 1) * (1 - ax) + at(c0 + 1, r0 + 1) * ax) * ay;
  };

  // Terrain height. Mapped holes use measured elevation only (flat when there is none);
  // the generated sample course uses a decorative ramp and swells.
  const height = (x: number, z: number): number => {
    if (isMap) return measured(x, -z);
    const along = Math.min(1, Math.max(0, -z / Math.max(1, -greenC.z)));
    const ramp = g.greenElevationM * (along * along * (3 - 2 * along));
    const swell = Math.sin(x * 0.021 + seed) * 1.6 + Math.cos(z * 0.017 + seed * 0.7) * 1.3 + Math.sin((x + z) * 0.045 + seed * 1.3) * 0.5;
    // Flatten the playing corridor so the fairway reads as maintained turf.
    const dToGreen = Math.hypot(x - greenC.x, z - greenC.z);
    const flatten = dToGreen < g.green.radiusM * 1.6 ? 0.15 : 0.55;
    return ramp + swell * flatten;
  };

  const outlinePts = g.outlines ? Object.values(g.outlines).flat(2) as unknown as [number, number][] : [];
  const extentX = Math.max(160, ...g.centerline.map(([x]) => Math.abs(x) + 140), ...outlinePts.map(([x]) => Math.abs(x) + 60));
  const extentZ = length + 220;

  // ── Ground for mapped holes: measured terrain mesh with the chosen surface draped on it.
  if (isMap) {
    const pts = g.outlines ? (Object.values(g.outlines).flat(2) as unknown as [number, number][]) : [];
    const all = [...pts, ...g.centerline, g.green.center];
    const bounds: Bounds =
      g.imageryBounds ??
      (elev
        ? [elev.x0, elev.y0, elev.x0 + (elev.cols - 1) * elev.stepM, elev.y0 + (elev.rows - 1) * elev.stepM]
        : [Math.min(...all.map((p) => p[0])) - 45, Math.min(...all.map((p) => p[1])) - 45, Math.max(...all.map((p) => p[0])) + 45, Math.max(...all.map((p) => p[1])) + 45]);
    const [bx0, by0, bx1, by1] = bounds;
    const w = bx1 - bx0;
    const h = by1 - by0;
    const step = elev ? Math.max(2, elev.stepM / 2) : Math.max(w, h);
    const geo = track(new THREE.PlaneGeometry(w, h, Math.min(400, Math.ceil(w / step)), Math.min(400, Math.ceil(h / step))));
    geo.rotateX(-Math.PI / 2); // local (x, y) → world (x, 0, −y); UV v=1 is the far end
    geo.translate(bx0 + w / 2, 0, -(by0 + h / 2));
    const pos = geo.attributes['position'] as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) pos.setY(i, height(pos.getX(i), pos.getZ(i)));
    geo.computeVertexNormals();
    const tex =
      surface === 'photo' && photo
        ? track(new THREE.Texture(photo))
        : track(new THREE.CanvasTexture(paintSurface(g, bounds, surface === 'both' ? 'both' : 'map', photo)));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    tex.needsUpdate = true;
    const mat = track(new THREE.MeshLambertMaterial({ map: tex }));
    scene.add(new THREE.Mesh(geo, mat));
  }

  // ── Ground for the generated sample course
  if (!isMap) {
    const geo = track(new THREE.PlaneGeometry(extentX * 2, extentZ, 140, 160));
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, 0, -length / 2);
    const pos = geo.attributes['position'] as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const a = new THREE.Color(COLORS.rough);
    const b = new THREE.Color(COLORS.roughDark);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      pos.setY(i, height(x, z) - 0.15);
      c.copy(a).lerp(b, hash(Math.floor(x / 9) * 13.1 + Math.floor(z / 9) * 7.7 + seed) * 0.8);
      colors.set([c.r, c.g, c.b], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mat = track(new THREE.MeshLambertMaterial({ vertexColors: true }));
    scene.add(new THREE.Mesh(geo, mat));
  }

  // ── Fairway ribbon with mowing stripes (generated layouts only; par 3s get an approach apron)
  if (!isMap) {
    const start = g.centerline.length > 2 || length > 250 ? 0.18 : 0.55;
    const end = 1 - (g.green.radiusM + 2) / length;
    const steps = 120;
    const half = g.fairwayWidthM / 2;
    const verts: number[] = [];
    const cols: number[] = [];
    const idx: number[] = [];
    const ca = new THREE.Color(COLORS.fairwayA);
    const cb = new THREE.Color(COLORS.fairwayB);
    for (let i = 0; i <= steps; i++) {
      const t = start + ((end - start) * i) / steps;
      const p = centre.getPointAt(t);
      const tan = centre.getTangentAt(t);
      const nx = -tan.z;
      const nz = tan.x;
      // Fairways pinch in at the ends and breathe in the middle.
      const w = half * (0.7 + 0.3 * Math.sin(Math.PI * ((t - start) / (end - start)))) * (1 + 0.08 * Math.sin(t * 40 + seed));
      for (const side of [-1, 1]) {
        const x = p.x + nx * w * side;
        const z = p.z + nz * w * side;
        verts.push(x, height(x, z) + 0.06, z);
        const col = Math.floor((i / steps) * 22) % 2 === 0 ? ca : cb;
        cols.push(col.r, col.g, col.b);
      }
      if (i < steps) {
        const k = i * 2;
        idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
      }
    }
    const geo = track(new THREE.BufferGeometry());
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mat = track(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    scene.add(new THREE.Mesh(geo, mat));
  }

  // Disc that follows the terrain, for greens, bunkers, water and tee.
  const disc = (cx: number, cz: number, r: number, color: number, lift: number, wobble = 0, opts?: { opacity?: number; shiny?: boolean }) => {
    const seg = 48;
    const verts: number[] = [cx, height(cx, cz) + lift, cz];
    const idx: number[] = [];
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const rr = r * (1 + wobble * (Math.sin(a * 3 + cx) * 0.6 + Math.sin(a * 5 + cz) * 0.4));
      const x = cx + Math.cos(a) * rr;
      const z = cz + Math.sin(a) * rr;
      verts.push(x, height(x, z) + lift, z);
      if (i > 0) idx.push(0, i, i + 1);
    }
    const geo = track(new THREE.BufferGeometry());
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mat = track(
      opts?.shiny
        ? new THREE.MeshPhongMaterial({ color, shininess: 90, specular: 0x6688aa, transparent: true, opacity: opts.opacity ?? 0.92, side: THREE.DoubleSide })
        : new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide }),
    );
    const mesh = new THREE.Mesh(geo, mat);
    scene.add(mesh);
    return mesh;
  };

  if (!isMap) {
    disc(greenC.x, greenC.z, g.green.radiusM + 2.2, COLORS.fringe, 0.09, 0.06);
    disc(greenC.x, greenC.z, g.green.radiusM, COLORS.green, 0.12, 0.05);
    disc(0, -2, 5, COLORS.tee, 0.1);
    for (const h of g.hazards) {
      const [hx, hy] = h.center;
      if (h.kind === 'bunker') disc(hx, -hy, h.radiusM, COLORS.sand, 0.1, 0.18);
      else disc(hx, -hy, h.radiusM, COLORS.water, 0.05, 0.12, { shiny: true, opacity: 0.9 });
    }
  }

  // ── Trees. Mapped holes: the trees found in the aerial photo (or, for holes not yet
  // searched, the ones mapped on OpenStreetMap). The sample course gets decorative trees
  // kept out of the corridor, hazards and green.
  if (opts.showTrees !== false) {
    const spots: TreeSpot[] = [];
    if (isMap) {
      const sample = photo && g.imageryBounds && surface !== 'map' ? photoSampler(photo, g.imageryBounds) : null;
      if (g.photoTrees) {
        for (const [x, y, r, h, kind] of g.photoTrees) spots.push({ x, z: -y, y: height(x, -y), r, h, kind, tint: sample?.(x, y, r) ?? null });
      } else {
        for (const [x, y] of g.trees ?? []) spots.push({ x, z: -y, y: height(x, -y), r: 3.5, h: 10, kind: 0, tint: null });
      }
    } else {
      const clearance = g.fairwayWidthM / 2 + 14;
      for (let i = 0; i < 300 && spots.length < 140; i++) {
        const t = hash(seed + i * 3.1);
        const p = centre.getPointAt(Math.min(1, t * 1.05));
        const tan = centre.getTangentAt(Math.min(1, t * 1.05));
        const side = hash(seed + i * 5.3) < 0.5 ? -1 : 1;
        const off = clearance + hash(seed + i * 7.9) * 55;
        const x = p.x - tan.z * off * side;
        const z = p.z + tan.x * off * side;
        if (Math.hypot(x - greenC.x, z - greenC.z) < g.green.radiusM + 16) continue;
        if (Math.hypot(x, z) < 22) continue;
        if (g.hazards.some((h) => Math.hypot(x - h.center[0], z + h.center[1]) < h.radiusM + 6)) continue;
        const r = 2.8 + hash(seed + i * 1.7) * 2.6;
        spots.push({ x, z, y: height(x, z), r, h: r * 2.5 + 2 + hash(seed + i) * 3, kind: hash(seed + i * 9.1) < 0.3 ? 1 : 0, tint: null });
      }
    }
    // Keep the view from behind the tee open: trees between that camera and the tee aren't in play.
    const back = centre.getTangentAt(0.02);
    const cam: [number, number] = [-back.x * 70, -back.z * 70]; // scene x, z
    const clearOfCamera = (t: TreeSpot) => {
      const len2 = cam[0] * cam[0] + cam[1] * cam[1] || 1;
      const k = Math.max(0, Math.min(1, (t.x * cam[0] + t.z * cam[1]) / len2));
      return Math.hypot(t.x - cam[0] * k, t.z - cam[1] * k) > t.r + 9 || k < 0.05;
    };
    addTrees(scene, spots.filter(clearOfCamera), track, { sun: SUN, shadows: !isMap || surface === 'map' });
  }

  // ── Flag at the pin (end of the most recent track) or green centre.
  const lastEnd = tracks[0]?.track.shots.at(-1)?.end;
  const pin = new THREE.Vector3(lastEnd ? lastEnd[0] : greenC.x, 0, lastEnd ? -lastEnd[1] : greenC.z);
  pin.y = height(pin.x, pin.z) + 0.12;
  {
    const poleGeo = track(new THREE.CylinderGeometry(0.06, 0.06, 2.4, 6));
    const pole = new THREE.Mesh(poleGeo, track(new THREE.MeshLambertMaterial({ color: COLORS.pin })));
    pole.position.set(pin.x, pin.y + 1.2, pin.z);
    const flagGeo = track(new THREE.BufferGeometry());
    flagGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, -0.55, 0, 0.9, -0.28, 0], 3));
    flagGeo.computeVertexNormals();
    const flag = new THREE.Mesh(flagGeo, track(new THREE.MeshBasicMaterial({ color: COLORS.flag, side: THREE.DoubleSide })));
    flag.position.set(pin.x + 0.05, pin.y + 2.4, pin.z);
    scene.add(pole, flag);
  }

  // ── Distance markers from the green centre along the line of play.
  for (const mk of markers) {
    const t = 1 - mk.m / length;
    if (t <= 0.05 || t >= 0.95) continue;
    const p = centre.getPointAt(t);
    const tan = centre.getTangentAt(t);
    const x = p.x - tan.z * (g.fairwayWidthM / 2 + 3);
    const z = p.z + tan.x * (g.fairwayWidthM / 2 + 3);
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = 'rgba(28,31,29,0.82)';
      ctx.beginPath();
      ctx.roundRect(4, 8, 120, 48, 10);
      ctx.fill();
      ctx.fillStyle = '#e8eae3';
      ctx.font = '600 30px "IBM Plex Sans Condensed", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(mk.label, 64, 33);
    }
    const tex = track(new THREE.CanvasTexture(canvas));
    tex.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(track(new THREE.SpriteMaterial({ map: tex, depthTest: false })));
    sprite.scale.set(9, 4.5, 1);
    sprite.position.set(x, height(x, z) + 4, z);
    scene.add(sprite);
    const post = new THREE.Mesh(track(new THREE.CylinderGeometry(0.15, 0.15, 1.4, 5)), track(new THREE.MeshLambertMaterial({ color: 0xe8eae3 })));
    post.position.set(x, height(x, z) + 0.7, z);
    scene.add(post);
  }

  // ── Shot arcs
  for (const { track: tr, color } of tracks) {
    const col = new THREE.Color(color);
    const tubeMat = track(new THREE.MeshBasicMaterial({ color: col }));
    const dotMat = track(new THREE.MeshBasicMaterial({ color: col }));
    const dotGeo = track(new THREE.SphereGeometry(0.9, 12, 8));
    for (const s of tr.shots) {
      const a = new THREE.Vector3(s.start[0], 0, -s.start[1]);
      const b = new THREE.Vector3(s.end[0], 0, -s.end[1]);
      a.y = height(a.x, a.z) + 0.3;
      b.y = height(b.x, b.z) + 0.3;
      const putt = s.lie === 'green';
      const apex = putt ? 0.05 : Math.min(38, 6 + s.distanceM * 0.14);
      const mid = a.clone().lerp(b, putt ? 0.5 : 0.58);
      mid.y = Math.max(a.y, b.y) + apex * 2; // control point: apex ≈ half the control height
      const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
      const tube = new THREE.Mesh(track(new THREE.TubeGeometry(curve, putt ? 8 : 40, putt ? 0.25 : 0.45, 6, false)), tubeMat);
      scene.add(tube);
      const dot = new THREE.Mesh(dotGeo, dotMat);
      dot.position.copy(b);
      dot.scale.setScalar(putt ? 0.4 : 1);
      scene.add(dot);
    }
  }

  // ── Light
  scene.add(new THREE.HemisphereLight(0xe6efe2, 0x2a3a2f, 1.5));
  const sun = new THREE.DirectionalLight(0xfff3dd, 1.4);
  sun.position.copy(SUN);
  scene.add(sun);
  scene.fog = new THREE.Fog(COLORS.sky, length * 0.9, length * 2.6);

  const teeY = height(0, 0);
  const greenY = height(greenC.x, greenC.z);
  const mid = centre.getPointAt(0.5);
  const aimTan = centre.getTangentAt(0.02);
  const views = {
    tee: {
      pos: new THREE.Vector3(-aimTan.x * 70, teeY + 42, -aimTan.z * 70),
      target: centre.getPointAt(0.62).setY(height(mid.x, mid.z)),
    },
    overhead: {
      pos: new THREE.Vector3(mid.x + length * 0.38, length * 0.95, mid.z + length * 0.12),
      target: new THREE.Vector3(mid.x, height(mid.x, mid.z), mid.z),
    },
    green: {
      pos: centre.getPointAt(Math.max(0, 1 - 70 / length)).setY(greenY + 18),
      target: new THREE.Vector3(greenC.x, greenY, greenC.z),
    },
  };

  return {
    scene,
    views,
    dispose: () => {
      for (const d of disposables) d.dispose();
      scene.clear();
    },
  };
}

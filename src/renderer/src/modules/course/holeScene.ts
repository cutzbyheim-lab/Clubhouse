import * as THREE from 'three';
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
  trunk: 0x6b5440,
  canopyA: 0x2f6a43,
  canopyB: 0x3b7a4f,
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

export function buildHoleScene(opts: {
  geometry: HoleGeometry;
  holeNumber: number;
  tracks: { track: HoleTrack; color: string }[];
  /** Distance markers from the green centre, in metres, with their display labels. */
  markers: { m: number; label: string }[];
}): SceneHandles {
  const { geometry: g, holeNumber, tracks, markers } = opts;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(COLORS.sky);
  const disposables: { dispose: () => void }[] = [];
  const track = <T extends { dispose: () => void }>(d: T): T => (disposables.push(d), d);

  const centre = smoothCurve(g.centerline);
  const length = centre.getLength();
  const greenC = new THREE.Vector3(g.green.center[0], 0, -g.green.center[1]);
  const seed = holeNumber * 31.7;

  // Terrain height: a ramp from tee (0) to the green's elevation, plus gentle swells.
  const height = (x: number, z: number): number => {
    const along = Math.min(1, Math.max(0, -z / Math.max(1, -greenC.z)));
    const ramp = g.greenElevationM * (along * along * (3 - 2 * along));
    const swell = Math.sin(x * 0.021 + seed) * 1.6 + Math.cos(z * 0.017 + seed * 0.7) * 1.3 + Math.sin((x + z) * 0.045 + seed * 1.3) * 0.5;
    // Flatten the playing corridor so the fairway reads as maintained turf.
    const dToGreen = Math.hypot(x - greenC.x, z - greenC.z);
    const flatten = dToGreen < g.green.radiusM * 1.6 ? 0.15 : 0.55;
    return ramp + swell * flatten;
  };

  const extentX = Math.max(160, ...g.centerline.map(([x]) => Math.abs(x) + 140));
  const extentZ = length + 220;

  // ── Ground
  {
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

  // ── Fairway ribbon with mowing stripes (par 4s and 5s; par 3s get an approach apron)
  {
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

  disc(greenC.x, greenC.z, g.green.radiusM + 2.2, COLORS.fringe, 0.09, 0.06);
  disc(greenC.x, greenC.z, g.green.radiusM, COLORS.green, 0.12, 0.05);
  disc(0, -2, 5, COLORS.tee, 0.1);
  for (const h of g.hazards) {
    const [hx, hy] = h.center;
    if (h.kind === 'bunker') disc(hx, -hy, h.radiusM, COLORS.sand, 0.1, 0.18);
    else disc(hx, -hy, h.radiusM, COLORS.water, 0.05, 0.12, { shiny: true, opacity: 0.9 });
  }

  // ── Trees: instanced, kept out of the corridor, hazards and green.
  {
    const trunkGeo = track(new THREE.CylinderGeometry(0.35, 0.5, 4, 6));
    const canopyGeo = track(new THREE.ConeGeometry(3.6, 9, 7));
    const trunkMat = track(new THREE.MeshLambertMaterial({ color: COLORS.trunk }));
    const canopyMat = track(new THREE.MeshLambertMaterial({ color: COLORS.canopyA }));
    const spots: THREE.Vector3[] = [];
    const clearance = g.fairwayWidthM / 2 + 14;
    for (let i = 0; i < 260 && spots.length < 120; i++) {
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
      spots.push(new THREE.Vector3(x, height(x, z), z));
    }
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, spots.length);
    const canopies = new THREE.InstancedMesh(canopyGeo, canopyMat, spots.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const tint = new THREE.Color();
    spots.forEach((s, i) => {
      const k = 0.8 + hash(seed + i) * 0.7;
      m.compose(new THREE.Vector3(s.x, s.y + 2 * k, s.z), q, new THREE.Vector3(k, k, k));
      trunks.setMatrixAt(i, m);
      m.compose(new THREE.Vector3(s.x, s.y + (4 + 4.5) * k, s.z), q, new THREE.Vector3(k, k, k));
      canopies.setMatrixAt(i, m);
      canopies.setColorAt(i, tint.set(hash(seed + i * 2) < 0.5 ? COLORS.canopyA : COLORS.canopyB));
    });
    scene.add(trunks, canopies);
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
  sun.position.set(-120, 200, 80);
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

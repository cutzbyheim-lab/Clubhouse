import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/*
 * 3D trees for the course view. Each tree is placed and sized from what the
 * aerial photo shows (position and crown width); height is an estimate from
 * crown width. Broadleaf crowns are lumpy, faceted blobs in three shapes so
 * woods don't look cloned; conifers are stacked tiers. Everything is
 * instanced, so a hole with a thousand trees is still one draw per part.
 */

export interface TreeSpot {
  x: number;
  /** Ground height at the tree. */
  y: number;
  z: number;
  /** Crown radius, metres. */
  r: number;
  /** Total height, metres. */
  h: number;
  kind: 0 | 1;
  /** Crown colour from the photo, if known. */
  tint: THREE.Color | null;
}

const hash = (n: number) => {
  const s = Math.sin(n * 12.9898) * 43758.5453;
  return s - Math.floor(s);
};

/** A lumpy unit crown: an icosphere pushed in and out by smooth noise. */
function broadleafCrown(seed: number): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, 2);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).normalize();
    const lump =
      0.16 * Math.sin(v.x * 3.1 + seed) * Math.cos(v.z * 2.7 + seed * 1.7) +
      0.1 * Math.sin(v.y * 4.3 + seed * 2.3) +
      0.06 * Math.cos((v.x + v.z) * 6.1 + seed);
    const flatBase = v.y < -0.3 ? 0.75 + (v.y + 1) * 0.35 : 1; // crowns are flatter underneath
    v.multiplyScalar((1 + lump) * flatBase);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

/** A unit conifer: three cone tiers from the ground up, height 1, radius 1 at the base. */
function coniferCrown(): THREE.BufferGeometry {
  const tiers = [
    { r: 1, h: 0.5, y: 0.25 },
    { r: 0.78, h: 0.44, y: 0.52 },
    { r: 0.52, h: 0.4, y: 0.78 },
  ].map(({ r, h, y }) => {
    const c = new THREE.ConeGeometry(r, h, 9, 1, true);
    c.translate(0, y, 0);
    return c;
  });
  const merged = mergeGeometries(tiers);
  tiers.forEach((t) => t.dispose());
  if (!merged) throw new Error('Could not build the conifer shape');
  merged.computeVertexNormals();
  return merged;
}

const BROADLEAF = new THREE.Color('#4d7a3c');
const CONIFER = new THREE.Color('#2e5a3e');

export function addTrees(
  scene: THREE.Scene,
  spots: readonly TreeSpot[],
  track: <T extends { dispose: () => void }>(d: T) => T,
  opts: { sun: THREE.Vector3; shadows: boolean },
): void {
  if (spots.length === 0) return;
  const crownMat = track(new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0, flatShading: true }));
  const trunkMat = track(new THREE.MeshStandardMaterial({ color: 0x5b4636, roughness: 1 }));
  const shapes = [0, 1, 2].map((k) => track(broadleafCrown(k * 7.3 + 1.1)));
  const conifer = track(coniferCrown());
  const trunkGeo = track(new THREE.CylinderGeometry(0.6, 1, 1, 6));
  trunkGeo.translate(0, 0.5, 0);

  const groups: TreeSpot[][] = [[], [], [], []]; // three broadleaf shapes, then conifers
  spots.forEach((s, i) => groups[s.kind === 1 ? 3 : Math.floor(hash(i + s.x * 0.37) * 3)]!.push(s));

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const col = new THREE.Color();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();

  groups.forEach((list, gi) => {
    if (list.length === 0) return;
    const isConifer = gi === 3;
    const crowns = new THREE.InstancedMesh(isConifer ? conifer : shapes[gi]!, crownMat, list.length);
    list.forEach((s, i) => {
      const spin = hash(s.x * 1.3 + s.z * 0.7) * Math.PI * 2;
      q.setFromAxisAngle(up, spin);
      if (isConifer) {
        const lift = s.h * 0.12; // bare trunk below the lowest branches
        pos.set(s.x, s.y + lift, s.z);
        scl.set(s.r, s.h - lift, s.r);
      } else {
        const crownH = Math.min(s.h * 0.8, s.r * 2.4);
        pos.set(s.x, s.y + s.h - crownH / 2, s.z);
        scl.set(s.r, crownH / 2, s.r * (0.9 + hash(s.z) * 0.2));
      }
      crowns.setMatrixAt(i, m.compose(pos, q, scl));
      const base = isConifer ? CONIFER : BROADLEAF;
      col.copy(s.tint ? base.clone().lerp(s.tint, 0.65) : base);
      col.offsetHSL((hash(s.x + s.z * 3.1) - 0.5) * 0.03, (hash(s.z) - 0.5) * 0.12, (hash(s.x * 2.1) - 0.5) * 0.08);
      crowns.setColorAt(i, col);
    });
    crowns.instanceMatrix.needsUpdate = true;
    if (crowns.instanceColor) crowns.instanceColor.needsUpdate = true;
    scene.add(crowns);
    track({ dispose: () => crowns.dispose() });
  });

  // Trunks, only as tall as the bare part below each crown.
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, spots.length);
  spots.forEach((s, i) => {
    const bare = s.kind === 1 ? s.h * 0.16 : Math.max(1.2, s.h - Math.min(s.h * 0.8, s.r * 2.4) + 0.6);
    const w = Math.max(0.12, s.r * 0.07);
    trunks.setMatrixAt(i, m.compose(pos.set(s.x, s.y - 0.2, s.z), q.identity(), scl.set(w, bare, w)));
  });
  trunks.instanceMatrix.needsUpdate = true;
  scene.add(trunks);
  track({ dispose: () => trunks.dispose() });

  // Soft shadows on the ground, cast away from the sun (the photo already has real ones).
  if (opts.shadows) {
    const shadowGeo = track(new THREE.CircleGeometry(1, 20));
    shadowGeo.rotateX(-Math.PI / 2);
    const shadowMat = track(
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
    );
    const away = new THREE.Vector3(-opts.sun.x, 0, -opts.sun.z).normalize();
    const shadows = new THREE.InstancedMesh(shadowGeo, shadowMat, spots.length);
    spots.forEach((s, i) => {
      const reach = s.h * 0.35;
      shadows.setMatrixAt(i, m.compose(pos.set(s.x + away.x * reach, s.y + 0.15, s.z + away.z * reach), q.identity(), scl.set(s.r * 1.05, 1, s.r * 1.05)));
    });
    shadows.instanceMatrix.needsUpdate = true;
    shadows.renderOrder = 1;
    scene.add(shadows);
    track({ dispose: () => shadows.dispose() });
  }
}

/** Reads average crown colours from the hole's aerial photo, so each tree wears its own colour. */
export function photoSampler(photo: HTMLImageElement, bounds: readonly [number, number, number, number]): ((x: number, y: number, r: number) => THREE.Color | null) | null {
  const scale = Math.min(1, 1200 / Math.max(photo.naturalWidth, photo.naturalHeight));
  const w = Math.max(1, Math.round(photo.naturalWidth * scale));
  const h = Math.max(1, Math.round(photo.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(photo, 0, 0, w, h);
  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, w, h).data;
  } catch {
    return null;
  }
  const [x0, y0, x1, y1] = bounds;
  return (x, y, r) => {
    let R = 0, G = 0, B = 0, n = 0;
    for (const [dx, dy] of [[0, 0], [0.4, 0], [-0.4, 0], [0, 0.4], [0, -0.4]] as const) {
      const u = Math.floor(((x + dx * r - x0) / (x1 - x0)) * w);
      const v = Math.floor(((y1 - (y + dy * r)) / (y1 - y0)) * h);
      if (u < 0 || v < 0 || u >= w || v >= h) continue;
      const i = (v * w + u) * 4;
      R += data[i]!;
      G += data[i + 1]!;
      B += data[i + 2]!;
      n++;
    }
    if (n === 0) return null;
    // Photos are shot in shade and haze; lift it a little so lit 3D crowns match the ground.
    return new THREE.Color().setRGB(Math.min(255, (R / n) * 1.25) / 255, Math.min(255, (G / n) * 1.25) / 255, Math.min(255, (B / n) * 1.2) / 255, THREE.SRGBColorSpace);
  };
}

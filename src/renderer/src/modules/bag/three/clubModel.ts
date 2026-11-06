import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import type { ClubKind, HeadDesign, HeadFinish, HeadStyle } from '@shared/schemas';

/*
 * Procedural club heads. Each is a generic form for its type and construction
 * (a blade, a cavity back, a 460 cc driver...), built at the club's real loft
 * and lie so the picture matches the specs. They are deliberately not
 * replicas of any manufacturer's product: no logos, badges or signature
 * shapes, only the colour and finish of the head.
 *
 * Units are centimetres. The face looks down +Z, the sole sits on y = 0, the
 * heel is at x ≈ 0 and the toe at +x (right-handed; left-handed is mirrored).
 */

export interface ClubSpec {
  kind: ClubKind;
  style: HeadStyle;
  loftDeg: number;
  lieDeg: number;
  finish: HeadFinish;
  crownColor: string | null;
  offset: HeadDesign['offset'];
  volumeCc: number | null;
  adjustableHosel: boolean;
  leftHanded: boolean;
}

const DEFAULT_LOFT: Record<ClubKind, number> = { driver: 10.5, wood: 15, hybrid: 21, iron: 30, wedge: 54, putter: 3 };
const DEFAULT_LIE: Record<ClubKind, number> = { driver: 58, wood: 57, hybrid: 58.5, iron: 62.5, wedge: 64, putter: 70 };
export const DEFAULT_STYLE: Record<ClubKind, HeadStyle> = {
  driver: 'wood-standard',
  wood: 'wood-standard',
  hybrid: 'wood-compact',
  iron: 'iron-cavity',
  wedge: 'wedge-blade',
  putter: 'putter-blade',
};
const FAMILY: Record<ClubKind, string> = { driver: 'wood-', wood: 'wood-', hybrid: 'wood-', iron: 'iron-', wedge: 'wedge-', putter: 'putter-' };

/** The spec to draw for a club, from its own numbers and, if identified, its model's head design. */
export function clubSpec(
  c: { kind: ClubKind; loftDeg: number | null; lieDeg: number | null; head?: HeadDesign | null | undefined },
  leftHanded = false,
): ClubSpec {
  const head = c.head ?? null;
  const style = head && head.style.startsWith(FAMILY[c.kind]) ? head.style : DEFAULT_STYLE[c.kind];
  const isWood = c.kind === 'driver' || c.kind === 'wood' || c.kind === 'hybrid';
  return {
    kind: c.kind,
    style,
    loftDeg: c.loftDeg ?? DEFAULT_LOFT[c.kind],
    lieDeg: c.lieDeg ?? DEFAULT_LIE[c.kind],
    finish: head?.finish ?? (isWood ? 'black' : c.kind === 'putter' ? 'satin' : 'chrome'),
    crownColor: head?.crownColor ?? null,
    offset: head?.offset ?? (c.kind === 'iron' ? 'minimal' : 'none'),
    volumeCc: head?.volumeCc ?? null,
    adjustableHosel: head?.adjustableHosel ?? false,
    leftHanded,
  };
}

export const specKey = (s: ClubSpec) =>
  [s.kind, s.style, s.loftDeg.toFixed(1), s.lieDeg.toFixed(1), s.finish, s.crownColor ?? '-', s.offset, s.volumeCc ?? '-', s.adjustableHosel ? 1 : 0, s.leftHanded ? 'L' : 'R'].join('|');

// ─── Materials ──────────────────────────────────────────────────────────────

function metal(finish: HeadFinish): THREE.MeshPhysicalMaterial {
  const m = {
    chrome: { color: 0xe4e8eb, metalness: 1, roughness: 0.13 },
    satin: { color: 0xcdd2d6, metalness: 1, roughness: 0.36 },
    black: { color: 0x2b2e32, metalness: 0.85, roughness: 0.3 },
    gunmetal: { color: 0x6c7279, metalness: 1, roughness: 0.28 },
    raw: { color: 0x806b58, metalness: 0.9, roughness: 0.48 },
    'two-tone': { color: 0xd8dce0, metalness: 1, roughness: 0.22 },
  }[finish];
  return new THREE.MeshPhysicalMaterial(m);
}

const darkAccent = () => new THREE.MeshPhysicalMaterial({ color: 0x1b1d20, metalness: 0.6, roughness: 0.35, clearcoat: 0.6 });
const grooveMat = () => new THREE.MeshStandardMaterial({ color: 0x2a2c2e, metalness: 0.6, roughness: 0.6 });

// ─── Geometry helpers ───────────────────────────────────────────────────────

/** Leans the face back by the loft: everything above the sole moves away from the target. */
function shearLoft(g: THREE.BufferGeometry, loftDeg: number): void {
  const t = Math.tan((loftDeg * Math.PI) / 180);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) p.setZ(i, p.getZ(i) - p.getY(i) * t);
  p.needsUpdate = true;
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
}

/** Extrudes a top-down outline (u = heel→toe, v = face→back) up to height h, sole on y = 0. */
function extrudeUp(shape: THREE.Shape, h: number, bevel: number, bevelSize: number): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.01, h - 2 * bevel),
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize,
    bevelSegments: 10,
    curveSegments: 48,
  });
  g.rotateX(-Math.PI / 2); // (u, v, w) → (u, w, -v)
  g.translate(0, bevel, 0);
  return g;
}

/** Extrudes a face-on outline (x, y) backwards from the face plane z = 0. */
function extrudeBack(shape: THREE.Shape, depth: number, bevel = 0.08): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.01, depth - bevel * 2),
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 4,
    curveSegments: 24,
  });
  g.translate(0, 0, -depth + bevel);
  return g;
}

// ─── Woods, hybrids ─────────────────────────────────────────────────────────

const WOOD_DIMS: Record<'driver' | 'wood' | 'hybrid', { w: number; d: number; h: number; ref: number }> = {
  driver: { w: 11.8, d: 11.2, h: 6.0, ref: 460 },
  wood: { w: 10.0, d: 8.2, h: 3.7, ref: 175 },
  hybrid: { w: 9.0, d: 6.0, h: 3.6, ref: 110 },
};

function woodHead(spec: ClubSpec): { head: THREE.Group; hoselBase: THREE.Vector3 } {
  const kind = spec.kind as 'driver' | 'wood' | 'hybrid';
  const base = WOOD_DIMS[kind];
  const scale = spec.volumeCc ? Math.min(1.12, Math.max(0.78, Math.cbrt(spec.volumeCc / base.ref))) : 1;
  let { w, d, h } = { w: base.w * scale, d: base.d * scale, h: base.h * scale };
  if (spec.style === 'wood-deep') (h *= 1.1), (d *= 0.95);
  if (spec.style === 'wood-shallow') (h *= 0.86), (d *= 1.05);
  if (spec.style === 'wood-compact') (w *= 0.92), (d *= 0.9);

  const bs = Math.min(1.2, w * 0.08); // outline inset absorbed by the bevel
  const bt = h * 0.42;
  const s = new THREE.Shape();
  s.moveTo(bs + 0.4, bs + 0.15);
  s.quadraticCurveTo(w / 2, bs - 0.45, w - bs - 0.5, bs + 0.2); // slightly convex face
  s.bezierCurveTo(w - bs + 0.15, bs + d * 0.12, w - bs + 0.05, d * 0.62, w * 0.62, d - bs);
  s.bezierCurveTo(w * 0.32, d - bs + 0.15, bs - 0.1, d * 0.5, bs + 0.4, bs + 0.15);
  let g = extrudeUp(s, h, bt, bs);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g, 1e-4); // shared vertices give a smooth, not faceted, body

  // Dome the crown a little.
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    if (y <= h * 0.55) continue;
    const nu = (p.getX(i) - w / 2) / (w / 2);
    const nv = (-p.getZ(i) - d * 0.45) / (d * 0.55);
    p.setY(i, h * 0.55 + (y - h * 0.55) * (1 + 0.16 * Math.max(0, 1 - nu * nu - nv * nv)));
  }
  g.computeVertexNormals();

  shearLoft(g, spec.loftDeg);

  // Painted crown above a crisp split line, metal skirt, face and sole below it. The line
  // runs along the top of the face at the front and drops toward the back, like a real head.
  // Clipping planes are in world space; the club is never moved after it's built.
  const lean = Math.tan((spec.loftDeg * Math.PI) / 180);
  const zFront = -h * 0.9 * lean - 0.2;
  const zBack = -d - h * 0.5 * lean;
  const yFront = h * 0.9;
  const yBack = h * 0.52;
  const slope = (yFront - yBack) / (zFront - zBack);
  const normal = new THREE.Vector3(0, 1, -slope).normalize();
  const crownSide = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, new THREE.Vector3(0, yFront, zFront));
  const bodySide = crownSide.clone().negate();
  const crownColor = spec.crownColor ?? (spec.finish === 'chrome' ? '#b9bfc4' : spec.finish === 'satin' || spec.finish === 'gunmetal' ? '#3a3f45' : '#141619');
  const crownMat = new THREE.MeshPhysicalMaterial({ color: crownColor, metalness: 0.15, roughness: 0.4, clearcoat: 1, clearcoatRoughness: 0.08, clippingPlanes: [crownSide] });
  const bodyMat = new THREE.MeshPhysicalMaterial({ color: 0x555b62, metalness: 1, roughness: 0.3, clippingPlanes: [bodySide] });
  const head = new THREE.Group();
  head.add(new THREE.Mesh(g, crownMat), new THREE.Mesh(g, bodyMat));
  return { head, hoselBase: new THREE.Vector3(bs + 0.5, h * 0.62, -1.0) };
}

// ─── Irons and wedges ───────────────────────────────────────────────────────

interface BladeDims {
  l: number; // heel–toe
  ht: number; // toe height
  hh: number; // heel height
  top: number; // topline thickness
  sole: number; // sole width
  kind: 'blade' | 'muscle' | 'cavity' | 'hollow';
}

const BLADE_DIMS: Partial<Record<HeadStyle, BladeDims>> = {
  'iron-blade': { l: 7.3, ht: 4.6, hh: 2.9, top: 0.6, sole: 1.7, kind: 'blade' },
  'iron-muscle-cavity': { l: 7.5, ht: 4.7, hh: 3.0, top: 0.7, sole: 1.9, kind: 'muscle' },
  'iron-cavity': { l: 7.8, ht: 4.9, hh: 3.1, top: 0.8, sole: 2.2, kind: 'cavity' },
  'iron-hollow': { l: 7.8, ht: 4.9, hh: 3.1, top: 0.85, sole: 2.3, kind: 'hollow' },
  'iron-oversize': { l: 8.4, ht: 5.3, hh: 3.3, top: 1.0, sole: 2.7, kind: 'cavity' },
  'wedge-blade': { l: 7.6, ht: 5.7, hh: 3.3, top: 0.65, sole: 2.3, kind: 'blade' },
  'wedge-cavity': { l: 7.8, ht: 5.8, hh: 3.4, top: 0.75, sole: 2.5, kind: 'cavity' },
  'wedge-wide-sole': { l: 7.9, ht: 5.8, hh: 3.4, top: 0.8, sole: 3.1, kind: 'muscle' },
};

function faceOutline(dm: BladeDims, inset = 0): THREE.Shape {
  const { l, ht, hh } = dm;
  const i = inset;
  const s = new THREE.Shape();
  s.moveTo(0.9 + i, 0.15 + i);
  s.lineTo(l - 1.2 - i * 0.5, 0 + i);
  s.quadraticCurveTo(l + 0.1 - i, 0.1 + i, l - i, 1.5);
  s.quadraticCurveTo(l - 0.1 - i, ht - i, l - 1.7 - i * 0.3, ht - i);
  s.lineTo(1.6 + i, hh - i);
  s.quadraticCurveTo(0.6 + i, hh - 0.2 - i, 0.42 + i, hh - 0.9 - i * 0.5);
  s.lineTo(0.32 + i, 0.9 + i * 0.5);
  s.quadraticCurveTo(0.22 + i, 0.2 + i, 0.9 + i, 0.15 + i);
  return s;
}

/** A strip along the sole, heel to toe, up to height top. */
function soleStrip(dm: BladeDims, top: number): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(0.9, 0.15);
  s.lineTo(dm.l - 1.2, 0);
  s.quadraticCurveTo(dm.l + 0.1, 0.1, dm.l - 0.02, Math.min(1.5, top));
  s.lineTo(dm.l - 0.1, top);
  s.lineTo(0.34, top);
  s.quadraticCurveTo(0.22, 0.2, 0.9, 0.15);
  return s;
}

/** Thins the back of a piece toward the top, so the sole is the thickest part. */
function taperBack(g: THREE.BufferGeometry, bottom: number, top: number, yTop: number): void {
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const z = p.getZ(i);
    if (z >= -0.02) continue;
    const f = Math.min(1, Math.max(0, p.getY(i) / yTop));
    const depth = bottom + (top - bottom) * Math.pow(f, 0.7);
    p.setZ(i, (z / bottom) * depth);
  }
  p.needsUpdate = true;
}

function ironHead(spec: ClubSpec): { head: THREE.Group; hoselBase: THREE.Vector3 } {
  const dm = BLADE_DIMS[spec.style] ?? BLADE_DIMS['iron-cavity']!;
  const body = metal(spec.finish);
  const accent = spec.finish === 'two-tone' ? darkAccent() : body;
  const parts: Array<[THREE.BufferGeometry, THREE.Material]> = [];

  if (dm.kind === 'hollow') {
    const g = extrudeBack(faceOutline(dm), dm.sole, 0.12);
    taperBack(g, dm.sole, dm.top, dm.ht);
    parts.push([g, body]);
  } else {
    // Face plate.
    const plate = dm.kind === 'blade' ? dm.top : 0.38;
    parts.push([extrudeBack(faceOutline(dm), plate, 0.06), body]);
    // Sole bar, thick at the bottom.
    const soleH = dm.kind === 'blade' ? 1.1 : 1.35;
    const sole = extrudeBack(soleStrip(dm, soleH), dm.sole, 0.12);
    taperBack(sole, dm.sole, dm.sole * 0.55, soleH);
    parts.push([sole, body]);
    if (dm.kind === 'blade' || dm.kind === 'muscle') {
      // A muscle band behind the hitting area.
      const m = new THREE.Shape();
      const x0 = 1.4, x1 = dm.l - 1.0, y0 = soleH - 0.2, y1 = soleH + (dm.kind === 'blade' ? 1.3 : 0.9);
      m.moveTo(x0, y0);
      m.lineTo(x1, y0);
      m.quadraticCurveTo(x1 + 0.35, (y0 + y1) / 2, x1 - 0.2, y1);
      m.lineTo(x0 + 0.3, y1 - 0.35);
      m.quadraticCurveTo(x0 - 0.2, (y0 + y1) / 2, x0, y0);
      const g = extrudeBack(m, dm.top + 0.55, 0.15);
      parts.push([g, dm.kind === 'muscle' ? accent : body]);
    }
    if (dm.kind === 'cavity' || dm.kind === 'muscle') {
      // Perimeter ring around a recessed cavity.
      const ring = faceOutline(dm);
      ring.holes.push(faceOutline(dm, 0.55));
      parts.push([extrudeBack(ring, dm.kind === 'cavity' ? dm.top + 0.5 : dm.top + 0.25, 0.06), body]);
    }
    if (dm.kind === 'cavity') {
      // Plain insert in the cavity (no badge artwork).
      const ins = new THREE.Shape();
      const cx = dm.l * 0.55, cy = dm.hh * 0.75;
      ins.absellipse(cx, cy, dm.l * 0.24, dm.hh * 0.26, 0, Math.PI * 2, false, -0.08);
      const g = extrudeBack(ins, 0.5, 0.05);
      g.translate(0, 0, -0.42); // sits in the cavity, behind the face plate
      parts.push([g, spec.finish === 'two-tone' || spec.finish === 'chrome' ? darkAccent() : accent]);
    }
  }

  // Score lines on the face.
  const gm = grooveMat();
  const topline = (x: number) => dm.hh + ((dm.ht - dm.hh) * (x - 1.6)) / (dm.l - 3.3);
  for (let y = 0.55; y < dm.ht - 0.9; y += 0.36) {
    const x1 = dm.l - 1.7;
    let x0 = 1.7;
    while (x0 < x1 && topline(x0) < y + 0.45) x0 += 0.05;
    if (x1 - x0 < 1.2) continue;
    const box = new THREE.BoxGeometry(x1 - x0, 0.05, 0.02);
    box.translate((x0 + x1) / 2, y, 0.005);
    parts.push([box, gm]);
  }

  const head = new THREE.Group();
  for (const [g, m] of parts) {
    shearLoft(g, spec.loftDeg);
    head.add(new THREE.Mesh(g, m));
  }
  const offset = { none: 0, minimal: 0.15, moderate: 0.35, strong: 0.6 }[spec.offset];
  head.position.z = -offset;
  return { head, hoselBase: new THREE.Vector3(0.45, dm.hh - 0.7, -0.45) };
}

// ─── Putters ────────────────────────────────────────────────────────────────

function putterHead(spec: ClubSpec): { head: THREE.Group; hoselBase: THREE.Vector3 } {
  const body = metal(spec.finish === 'chrome' ? 'satin' : spec.finish);
  const s = new THREE.Shape();
  let w: number, d: number, h: number;
  if (spec.style === 'putter-mallet') {
    (w = 10.6), (d = 9.0), (h = 2.5);
    s.moveTo(0.6, 0.3);
    s.lineTo(w - 0.6, 0.3);
    s.bezierCurveTo(w + 0.2, 2.5, w, d - 1, w - 2.2, d - 0.3);
    s.lineTo(w * 0.62, d * 0.55);
    s.lineTo(w * 0.38, d * 0.55);
    s.lineTo(2.2, d - 0.3);
    s.bezierCurveTo(0, d - 1, -0.2, 2.5, 0.6, 0.3);
  } else if (spec.style === 'putter-midmallet') {
    (w = 10.2), (d = 5.2), (h = 2.4);
    s.moveTo(0.5, 0.3);
    s.lineTo(w - 0.5, 0.3);
    s.bezierCurveTo(w + 0.3, 2, w * 0.75, d, w / 2, d);
    s.bezierCurveTo(w * 0.25, d, -0.3, 2, 0.5, 0.3);
  } else {
    (w = 10.5), (d = 2.6), (h = 2.3);
    s.moveTo(0.5, 0.3);
    s.lineTo(w - 0.5, 0.3);
    s.quadraticCurveTo(w, 0.3, w, 1.2);
    s.quadraticCurveTo(w, d, w - 0.8, d);
    s.lineTo(0.8, d);
    s.quadraticCurveTo(0, d, 0, 1.2);
    s.quadraticCurveTo(0, 0.3, 0.5, 0.3);
  }
  const g = extrudeUp(s, h, 0.35, 0.3);
  // Lower the back (flange / wings) so the top line reads from address.
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const back = -p.getZ(i);
    if (back > 1.3 && p.getY(i) > h * 0.5) p.setY(i, p.getY(i) - Math.min(h * 0.38, (back - 1.3) * 0.5));
  }
  shearLoft(g, spec.loftDeg);
  const head = new THREE.Group();
  head.add(new THREE.Mesh(g, body));
  // Sight line on top.
  const lineLen = spec.style === 'putter-blade' ? 0.9 : d * 0.5;
  const line = new THREE.BoxGeometry(0.16, 0.03, lineLen);
  line.translate(w / 2, h + 0.01, -0.45 - lineLen / 2);
  shearLoft(line, spec.loftDeg);
  head.add(new THREE.Mesh(line, new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.5 })));
  return { head, hoselBase: new THREE.Vector3(spec.style === 'putter-blade' ? 1.6 : 2.4, h - 0.1, -0.9) };
}

// ─── Assembly ───────────────────────────────────────────────────────────────

export interface BuiltClub {
  root: THREE.Group;
  /** Head and hosel only, for framing the camera. */
  head: THREE.Group;
  dispose(): void;
}

export function buildClub(spec: ClubSpec, shaftLength = 40): BuiltClub {
  const isWood = spec.kind === 'driver' || spec.kind === 'wood' || spec.kind === 'hybrid';
  const { head, hoselBase } = isWood ? woodHead(spec) : spec.kind === 'putter' ? putterHead(spec) : ironHead(spec);

  const lie = (spec.lieDeg * Math.PI) / 180;
  const dir = new THREE.Vector3(-Math.cos(lie), Math.sin(lie), 0).normalize();
  const up = new THREE.Vector3(0, 1, 0);
  const along = (len: number, r0: number, r1: number, from: number, mat: THREE.Material) => {
    const g = new THREE.CylinderGeometry(r1, r0, len, 28, 1);
    const m = new THREE.Mesh(g, mat);
    m.quaternion.setFromUnitVectors(up, dir);
    m.position.copy(hoselBase).addScaledVector(dir, from + len / 2);
    return m;
  };

  const hoselMat = isWood ? new THREE.MeshPhysicalMaterial({ color: 0x1c1e21, metalness: 0.7, roughness: 0.3, clearcoat: 0.8 }) : metal(spec.finish === 'two-tone' ? 'satin' : spec.finish === 'raw' ? 'raw' : spec.finish);
  const hoselLen = isWood ? (spec.adjustableHosel ? 4.2 : 3.4) : spec.kind === 'putter' ? 6.5 : 5.2;
  const hosel = new THREE.Group();
  hosel.add(along(hoselLen, isWood ? 0.72 : spec.kind === 'putter' ? 0.42 : 0.66, isWood ? 0.55 : 0.5, -0.4, hoselMat));
  if (isWood && spec.adjustableHosel) hosel.add(along(0.5, 0.6, 0.6, hoselLen - 1.6, metal('satin')));
  const ferrule = new THREE.MeshPhysicalMaterial({ color: 0x0f1012, roughness: 0.25, clearcoat: 1 });
  hosel.add(along(1.1, 0.5, 0.46, hoselLen - 0.4, ferrule));

  const shaftMat = isWood
    ? new THREE.MeshPhysicalMaterial({ color: 0x22262b, metalness: 0.3, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.1 })
    : new THREE.MeshPhysicalMaterial({ color: 0xe8ebee, metalness: 1, roughness: 0.15 });
  const shaft = along(shaftLength, 0.45, 0.58, hoselLen + 0.7, shaftMat);

  const headAndHosel = new THREE.Group();
  headAndHosel.add(head, hosel);
  const root = new THREE.Group();
  root.add(headAndHosel, shaft);
  if (spec.leftHanded) root.scale.x = -1;

  return {
    root,
    head: headAndHosel,
    dispose() {
      root.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          (Array.isArray(o.material) ? o.material : [o.material]).forEach((m: THREE.Material) => m.dispose());
        }
      });
    },
  };
}

/** A soft round shadow under the head, so it sits on something. */
export function contactShadow(size: number): THREE.Mesh {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  if (ctx) {
    const grad = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
    grad.addColorStop(0, 'rgba(0,0,0,0.55)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
  }
  const tex = new THREE.CanvasTexture(c);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size * 0.7), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  m.position.y = -0.01;
  return m;
}

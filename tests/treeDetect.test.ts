import { describe, expect, it } from 'vitest';
import { detectTrees, type DetectedTree } from '../src/main/services/osm/treeDetect';
import { aerialHole, type AerialScene } from './fixtures/aerial';

const run = (s: AerialScene) =>
  detectTrees({
    rgba: s.rgba,
    width: s.width,
    height: s.height,
    bounds: s.bounds,
    avoid: [s.fairway, s.green, s.bunker, s.water],
    turf: [s.fairway, s.green],
    line: s.line,
  });

const inside = (x: number, y: number, poly: [number, number][]) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
};

describe('finding trees in an aerial photo', () => {
  const scene = aerialHole();
  const result = run(scene);
  const inWoods = (t: DetectedTree) => t[0] > scene.woods.x0 - 6 && t[0] < scene.woods.x1 + 6 && t[1] > scene.woods.y0 - 6 && t[1] < scene.woods.y1 + 6;
  const lone = result.trees.filter((t) => !inWoods(t));

  it('finds nearly every lone tree, in the right place', () => {
    const hit = scene.trees.filter((t) => lone.some((d) => Math.hypot(d[0] - t.x, d[1] - t.y) <= Math.max(2.5, t.r * 0.6)));
    expect(hit.length / scene.trees.length).toBeGreaterThanOrEqual(0.88);
  });

  it('rarely invents trees on open ground', () => {
    const real = lone.filter((d) => scene.trees.some((t) => Math.hypot(d[0] - t.x, d[1] - t.y) <= t.r + 2.5));
    expect(real.length / lone.length).toBeGreaterThanOrEqual(0.88);
  });

  it('sizes lone crowns close to their real size', () => {
    const errors = scene.trees
      .map((t) => {
        const d = lone.find((x) => Math.hypot(x[0] - t.x, x[1] - t.y) <= Math.max(2.5, t.r * 0.6));
        return d ? Math.abs(d[2] - t.r) : null;
      })
      .filter((e): e is number => e !== null)
      .sort((a, b) => a - b);
    expect(errors[Math.floor(errors.length / 2)]!).toBeLessThan(1.5);
  });

  it('fills woods with crowns of a realistic size', () => {
    const woods = result.trees.filter(inWoods);
    expect(woods.length).toBeGreaterThanOrEqual(40);
    for (const t of woods) {
      expect(t[2]).toBeGreaterThanOrEqual(1.6);
      expect(t[2]).toBeLessThanOrEqual(6.5);
    }
  });

  it('never puts a tree on a fairway, green, bunker or water', () => {
    for (const t of result.trees) {
      for (const poly of [scene.fairway, scene.green, scene.bunker, scene.water]) expect(inside(t[0], t[1], poly)).toBe(false);
    }
  });

  it('tells conifers from broadleaf trees most of the time', () => {
    const matched = scene.trees
      .map((t) => ({ t, d: lone.find((x) => Math.hypot(x[0] - t.x, x[1] - t.y) <= Math.max(2.5, t.r * 0.6)) }))
      .filter((m) => m.d);
    const right = matched.filter((m) => m.d![4] === m.t.kind).length;
    expect(right / matched.length).toBeGreaterThanOrEqual(0.75);
  });

  it('gives heights only as plausible estimates', () => {
    for (const t of result.trees) {
      expect(t[3]).toBeGreaterThanOrEqual(4);
      expect(t[3]).toBeLessThanOrEqual(32);
    }
  });

  it('is repeatable and works on coarser photos too', () => {
    expect(run(scene).trees).toEqual(result.trees);
    const coarse = aerialHole({ mpp: 1.2 });
    const c = run(coarse);
    const hit = coarse.trees.filter((t) => c.trees.some((d) => Math.hypot(d[0] - t.x, d[1] - t.y) <= Math.max(3, t.r * 0.7)));
    expect(hit.length / coarse.trees.length).toBeGreaterThanOrEqual(0.8);
  });

  it('isn’t fooled by dark, grainy rough', () => {
    const dark = aerialHole({ darkRough: true, seed: 11 });
    const r = run(dark);
    const inW = (t: DetectedTree) => t[0] > dark.woods.x0 - 6 && t[0] < dark.woods.x1 + 6 && t[1] > dark.woods.y0 - 6 && t[1] < dark.woods.y1 + 6;
    const lone2 = r.trees.filter((t) => !inW(t));
    const real = lone2.filter((d) => dark.trees.some((t) => Math.hypot(d[0] - t.x, d[1] - t.y) <= t.r + 2.5));
    expect(real.length / Math.max(1, lone2.length)).toBeGreaterThanOrEqual(0.85);
    const hit = dark.trees.filter((t) => lone2.some((d) => Math.hypot(d[0] - t.x, d[1] - t.y) <= Math.max(2.5, t.r * 0.6)));
    expect(hit.length / dark.trees.length).toBeGreaterThanOrEqual(0.75);
  });

  it('declines a photo with no turf in it instead of guessing', () => {
    const grey = aerialHole({ noTurf: true });
    const r = run(grey);
    expect(r.reliable).toBe(false);
    expect(r.trees).toEqual([]);
  });
});

import { beforeAll, describe, expect, it } from 'vitest';
import { contract, type Channel } from '@shared/ipc/contract';
import type { Result } from '@shared/ipc/result';
import { initDatabase } from '../src/main/db/connection';
import { migrations } from '../src/main/db/migrations';
import { migrate } from '../src/main/db/migrator';
import { ensureBuiltinDrills } from '../src/main/db/seed/drills';
import { loadSampleData } from '../src/main/db/seed/sample';
import { registerDataHandlers } from '../src/main/ipc/handlers/data';
import { registerDomainHandlers } from '../src/main/ipc/handlers/domain';
import { dispatch } from '../src/main/ipc/registry';

async function call<T = unknown>(channel: Channel | string, input: unknown = {}): Promise<Result<T>> {
  return (await dispatch(channel, input)) as Result<T>;
}

async function ok<T = unknown>(channel: Channel, input: unknown = {}): Promise<T> {
  const res = await call<T>(channel, input);
  if (!res.ok) throw new Error(`${channel}: ${res.error.code} ${res.error.message}`);
  // Every response must satisfy the contract's declared output schema.
  contract[channel].output.parse(res.data);
  return res.data;
}

beforeAll(() => {
  const db = initDatabase(':memory:');
  migrate(db, migrations);
  ensureBuiltinDrills(db);
  loadSampleData(db);
  registerDataHandlers();
  registerDomainHandlers();
});

describe('read channels on sample data', () => {
  it('dashboard has KPIs with sample sizes, ladder and insights', async () => {
    const d = await ok<{ scoring: { value: number; n: number }; ladder: unknown[]; insights: unknown[] }>('dashboard.overview');
    expect(d.scoring.n).toBe(5);
    expect(d.scoring.value).toBeGreaterThan(72);
    expect(d.ladder).toHaveLength(13);
    expect(d.insights.length).toBeGreaterThan(0);
  });

  it('every list and detail channel returns contract-valid data', async () => {
    const clubs = await ok<{ id: number; stats: { n: number } }[]>('clubs.list');
    expect(clubs).toHaveLength(15);
    const sevenIron = clubs.find((c) => c.stats.n > 50);
    expect(sevenIron).toBeDefined();
    await ok('shots.forClub', { clubId: sevenIron!.id });
    await ok('sessions.list');
    const rounds = await ok<{ id: number }[]>('rounds.list');
    await ok('rounds.get', { id: rounds[0]!.id });
    const courses = await ok<{ id: number }[]>('courses.list');
    const course = await ok<{ holes: { id: number }[] }>('courses.get', { id: courses[0]!.id });
    const record = await ok<{ tracks: unknown[] }>('courses.holeRecord', { holeId: course.holes[0]!.id });
    expect(record.tracks.length).toBe(4);
    await ok('performance.get');
    await ok('practice.overview');
    await ok('profile.get');
  });

  it('insights each carry evidence and a stated rule', async () => {
    const insights = await ok<{ evidence: unknown[]; rule: string; usesSample: boolean }[]>('insights.list');
    expect(insights.length).toBeGreaterThan(2);
    for (const i of insights) {
      expect(i.evidence.length).toBeGreaterThan(0);
      expect(i.rule.length).toBeGreaterThan(10);
    }
  });
});

describe('write channels', () => {
  it('creates a round and derives its stats', async () => {
    const courses = await ok<{ id: number; tees: { id: number }[] }[]>('courses.list');
    const course = await ok<{ holes: { id: number; par: number }[] }>('courses.get', { id: courses[0]!.id });
    const scores = course.holes.slice(0, 9).map((h) => ({
      holeId: h.id,
      strokes: h.par + 1,
      putts: 2,
      fairway: h.par >= 4 ? 'hit' : null,
      penalties: 0,
      sandShots: 0,
      firstPuttM: null,
    }));
    const r = await ok<{ strokes: number; gir: number; source: string; holes: unknown[] }>('rounds.create', {
      courseId: courses[0]!.id,
      teeId: courses[0]!.tees[0]!.id,
      playedOn: '2026-11-04',
      holesPlanned: 9,
      startHole: 1,
      conditions: null,
      notes: null,
      scores,
    });
    expect(r.source).toBe('manual');
    expect(r.strokes).toBe(course.holes.slice(0, 9).reduce((s, h) => s + h.par + 1, 0));
    expect(r.gir).toBe(0); // bogey with two putts = missed green
  });

  it('rejects a fairway on a par 3 and a score with more putts than strokes', async () => {
    const courses = await ok<{ id: number }[]>('courses.list');
    const course = await ok<{ holes: { id: number; par: number }[] }>('courses.get', { id: courses[0]!.id });
    const par3 = course.holes.find((h) => h.par === 3)!;
    const base = { courseId: courses[0]!.id, teeId: null, playedOn: '2026-11-04', holesPlanned: 18, startHole: 1, conditions: null, notes: null };
    const fw = await call('rounds.create', { ...base, scores: [{ holeId: par3.id, strokes: 3, putts: 2, fairway: 'hit', penalties: 0, sandShots: 0, firstPuttM: null }] });
    expect(fw.ok).toBe(false);
    const putts = await call('rounds.create', { ...base, scores: [{ holeId: par3.id, strokes: 3, putts: 4, fairway: null, penalties: 0, sandShots: 0, firstPuttM: null }] });
    expect(putts.ok ? null : putts.error.code).toBe('VALIDATION');
  });

  it('adds a club, puts it in the bag only if there is room, and refuses to delete clubs with shots', async () => {
    const saved = await ok<{ id: number; source: string }>('clubs.save', {
      id: null,
      club: {
        kind: 'wedge', label: '60° Wedge', make: null, model: null, loftDeg: 60, lieDeg: null, lengthM: null,
        shaftMake: null, shaftModel: null, shaftFlex: null, shaftWeightG: null, swingWeight: null, grip: null,
        acquiredOn: null, retiredOn: null, notes: null,
      },
    });
    expect(saved.source).toBe('manual');
    const clubs = await ok<{ id: number; inBag: boolean; stats: { n: number } }[]>('clubs.list');
    const bagIds = clubs.filter((c) => c.inBag).map((c) => c.id);
    const full = await call('bag.setClubs', { clubIds: [...bagIds, saved.id] });
    expect(full.ok).toBe(false); // 15 clubs
    const withShots = clubs.find((c) => c.stats.n > 0)!;
    const del = await call('clubs.delete', { id: withShots.id });
    expect(del.ok ? null : del.error.code).toBe('CONFLICT');
    await ok('clubs.delete', { id: saved.id });
  });

  it('flags a mishit and the club average moves', async () => {
    const clubs = await ok<{ id: number; stats: { n: number; excluded: number } }[]>('clubs.list');
    const c = clubs.find((x) => x.stats.n > 20)!;
    const shots = await ok<{ id: number; excluded: boolean }[]>('shots.forClub', { clubId: c.id });
    const target = shots.find((s) => !s.excluded)!;
    await ok('shots.setExcluded', { id: target.id, excluded: true });
    const after = (await ok<{ id: number; stats: { n: number; excluded: number } }[]>('clubs.list')).find((x) => x.id === c.id)!;
    expect(after.stats.n).toBe(c.stats.n - 1);
    expect(after.stats.excluded).toBe(c.stats.excluded + 1);
  });

  it('logs practice, creates a plan and dismisses an insight', async () => {
    const p = await ok<{ drills: { id: number; history: unknown[] }[]; plans: unknown[] }>('practice.overview');
    const drill = p.drills[0]!;
    await ok('practice.log', { drillId: drill.id, planId: null, performedOn: '2026-11-04', minutes: 20, result: 7, notes: null });
    await ok('practice.createPlan', { name: 'Test plan', focus: null, scheduledFor: '2026-11-10', items: [{ drillId: drill.id, minutes: 15 }] });
    const after = await ok<{ drills: { id: number; history: unknown[] }[]; plans: unknown[] }>('practice.overview');
    expect(after.drills.find((d) => d.id === drill.id)!.history.length).toBe(drill.history.length + 1);
    expect(after.plans.length).toBe(p.plans.length + 1);

    const insights = await ok<{ key: string; dismissed: boolean }[]>('insights.list');
    await ok('insights.setDismissed', { key: insights[0]!.key, dismissed: true });
    const again = await ok<{ key: string; dismissed: boolean }[]>('insights.list');
    expect(again.find((i) => i.key === insights[0]!.key)!.dismissed).toBe(true);
  });

  it('creates a course without inventing a layout, and rejects duplicate stroke indexes', async () => {
    const holes = Array.from({ length: 9 }, (_, i) => ({ number: i + 1, par: i % 3 === 2 ? 3 : 4, strokeIndex: i + 1, lengthM: 300 }));
    const c = await ok<{ id: number; holes: number; par: number; source: string }>('courses.create', {
      name: 'My Local Nine', location: null, tee: { name: 'White', courseRating: null, slopeRating: null }, holes,
    });
    expect(c).toMatchObject({ holes: 9, par: 33, source: 'manual' });
    const detail = await ok<{ holes: { geometry: unknown }[] }>('courses.get', { id: c.id });
    expect(detail.holes.every((h) => h.geometry === null)).toBe(true);
    const dup = await call('courses.create', {
      name: 'Bad', location: null, tee: { name: 'W', courseRating: null, slopeRating: null },
      holes: holes.map((h) => ({ ...h, strokeIndex: 1 })),
    });
    expect(dup.ok).toBe(false);
  });

  it('updates units', async () => {
    const p = await ok<{ distanceUnit: string }>('profile.update', { distanceUnit: 'metres' });
    expect(p.distanceUnit).toBe('metres');
    const bad = await call('profile.update', { distanceUnit: 'furlongs' });
    expect(bad.ok).toBe(false);
  });
});

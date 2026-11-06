import type { Performance, ScoreMix } from '@shared/dto';
import { isScramble, scoreName } from '@shared/domain/golf';
import { mean } from '@shared/domain/stats';
import type { DB } from '../db/connection';
import { listRounds, scoredHoles, type ScoredHole } from '../db/repositories/rounds';

const PUTT_BUCKETS = [
  { minM: 0, maxM: 1.5 },
  { minM: 1.5, maxM: 3 },
  { minM: 3, maxM: 6 },
  { minM: 6, maxM: 10 },
  { minM: 10, maxM: 60 },
] as const;

const emptyMix = (): ScoreMix => ({ eagle: 0, birdie: 0, par: 0, bogey: 0, double: 0, triple: 0 });

export function performance(db: DB): Performance {
  const holes = scoredHoles(db);
  const byRound = new Map<number, ScoredHole[]>();
  for (const h of holes) {
    const list = byRound.get(h.round_id);
    if (list) list.push(h);
    else byRound.set(h.round_id, [h]);
  }

  const rounds = listRounds(db)
    .slice()
    .reverse() // oldest first for trends
    .map((r) => {
      const hs = byRound.get(r.id) ?? [];
      const mix = emptyMix();
      let scrambles = 0;
      let scrambleChances = 0;
      let threePutts = 0;
      for (const h of hs) {
        mix[scoreName(h.strokes, h.par)]++;
        const sc = isScramble(h.strokes, h.putts, h.par);
        if (sc !== null) {
          scrambleChances++;
          if (sc) scrambles++;
        }
        if ((h.putts ?? 0) >= 3) threePutts++;
      }
      return { ...r, mix, scrambles, scrambleChances, threePutts };
    });

  const byPar = [3, 4, 5].map((par) => {
    const rel = holes.filter((h) => h.par === par).map((h) => h.strokes - h.par);
    return { par, holes: rel.length, avgToPar: mean(rel) };
  });

  const putted = holes.filter((h) => h.first_putt_m !== null && (h.putts ?? 0) >= 1);
  const puttMakeByDistance = PUTT_BUCKETS.map((b) => {
    const inBucket = putted.filter((h) => (h.first_putt_m ?? 0) >= b.minM && (h.first_putt_m ?? 0) < b.maxM);
    return {
      label: `${b.minM}-${b.maxM}`,
      minM: b.minM,
      maxM: b.maxM,
      attempts: inBucket.length,
      oneputts: inBucket.filter((h) => h.putts === 1).length,
    };
  });

  // Hole-by-hole for the course played most.
  const courseCounts = new Map<number, number>();
  for (const r of rounds) courseCounts.set(r.courseId, (courseCounts.get(r.courseId) ?? 0) + 1);
  const topCourse = [...courseCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const courseHoles = holes.filter((h) => h.course_id === topCourse);
  const holeNumbers = [...new Set(courseHoles.map((h) => h.number))].sort((a, b) => a - b);
  const byHole = holeNumbers.map((number) => {
    const hs = courseHoles.filter((h) => h.number === number);
    return { number, par: hs[0]?.par ?? 4, played: hs.length, avgToPar: mean(hs.map((h) => h.strokes - h.par)) };
  });

  return {
    rounds,
    byPar,
    puttMakeByDistance,
    byHole,
    courseName: rounds.find((r) => r.courseId === topCourse)?.courseName ?? null,
  };
}

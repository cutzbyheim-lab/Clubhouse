import type { DrillCategory } from '@shared/schemas';
import type { DB } from '../connection';

interface BuiltinDrill {
  name: string;
  category: DrillCategory;
  description: string;
  resultLabel: string;
  higherIsBetter: boolean;
}

/**
 * The drill library that ships with Clubhouse. These are instructions, not
 * measurements: results only exist once the player logs them.
 */
export const BUILTIN_DRILLS: readonly BuiltinDrill[] = [
  {
    name: 'Gate putting',
    category: 'putting',
    description:
      'Set two tees just wider than the putter head about 30 cm in front of the ball. Hit 10 putts from 2 m without touching the gate.',
    resultLabel: 'Putts holed of 10',
    higherIsBetter: true,
  },
  {
    name: 'Clock drill',
    category: 'putting',
    description:
      'Place 12 balls in a circle 1 m from the hole. Work around the clock; restart the count after any miss.',
    resultLabel: 'Consecutive holed of 12',
    higherIsBetter: true,
  },
  {
    name: 'Lag ladder',
    category: 'putting',
    description: 'Putt 10 balls from 10, 12 and 15 m. Count the ones that finish within a putter length of the hole.',
    resultLabel: 'Within a putter length of 10',
    higherIsBetter: true,
  },
  {
    name: 'Up-and-down nine',
    category: 'short_game',
    description:
      'Drop a ball at nine spots around the green: tight lie, rough and sand. Play each out and hole it.',
    resultLabel: 'Up-and-downs of 9',
    higherIsBetter: true,
  },
  {
    name: 'Bunker splash',
    category: 'short_game',
    description: 'From a greenside bunker, hit 10 balls. Count the ones that finish on the green.',
    resultLabel: 'On the green of 10',
    higherIsBetter: true,
  },
  {
    name: 'Wedge distance ladder',
    category: 'approach',
    description:
      'Pick targets at 40, 55, 70 and 85 m. Hit each wedge in turn and count shots that land within 5 m of the target.',
    resultLabel: 'Within 5 m of 12',
    higherIsBetter: true,
  },
  {
    name: 'Nine-shot iron drill',
    category: 'full_swing',
    description:
      'With a 7 iron, hit every combination of low, mid and high with draw, straight and fade. Count shapes that come off as called.',
    resultLabel: 'Shapes executed of 9',
    higherIsBetter: true,
  },
  {
    name: 'Fairway finder',
    category: 'driving',
    description: 'Choose a 30 m wide corridor on the range. Hit 10 drives with your full routine between each.',
    resultLabel: 'Drives in the corridor of 10',
    higherIsBetter: true,
  },
];

/** Inserts any built-in drills that are missing. Safe to run on every launch. */
export function ensureBuiltinDrills(db: DB): void {
  const insert = db.prepare(
    `INSERT INTO drill (name, category, description, result_label, higher_is_better, builtin)
     VALUES (@name, @category, @description, @resultLabel, @higherIsBetter, 1)
     ON CONFLICT (name) DO NOTHING`,
  );
  db.transaction(() => {
    for (const d of BUILTIN_DRILLS) insert.run({ ...d, higherIsBetter: d.higherIsBetter ? 1 : 0 });
  })();
}

import bag from '@/modules/bag';
import course from '@/modules/course';
import dashboard from '@/modules/dashboard';
import equipment from '@/modules/equipment';
import intelligence from '@/modules/intelligence';
import performance from '@/modules/performance';
import practice from '@/modules/practice';
import rounds from '@/modules/rounds';
import shots from '@/modules/shots';
import type { ModuleDefinition } from './module';

/** Order here is rail order within each group. */
export const modules: readonly ModuleDefinition[] = [
  dashboard,
  rounds,
  course,
  shots,
  performance,
  intelligence,
  bag,
  equipment,
  practice,
];

const ids = new Set<string>();
for (const m of modules) {
  if (ids.has(m.id)) throw new Error(`Duplicate module id "${m.id}"`);
  ids.add(m.id);
}

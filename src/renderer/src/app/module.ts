import type { ComponentType } from 'react';
import type { LucideIcon } from 'lucide-react';

/** How the rail groups modules: by what the golfer is doing. */
export const MODULE_GROUPS = ['Overview', 'Play', 'Analyse', 'Gear', 'Improve'] as const;
export type ModuleGroup = (typeof MODULE_GROUPS)[number];

export interface ModuleDefinition {
  readonly id: string;
  /** Route path without leading slash; '' is the index route. */
  readonly path: string;
  readonly title: string;
  readonly group: ModuleGroup;
  readonly icon: LucideIcon;
  /** One sentence, shown under the page title. */
  readonly lede: string;
  /** Lazily loaded page component (keeps Three.js etc. out of the startup bundle). */
  readonly load: () => Promise<{ default: ComponentType }>;
}

export const defineModule = (m: ModuleDefinition): ModuleDefinition => m;

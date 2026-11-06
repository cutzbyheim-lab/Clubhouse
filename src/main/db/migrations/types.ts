import type { DB } from '../connection';

export interface Migration {
  /** Strictly increasing, never reused. */
  readonly id: number;
  readonly name: string;
  readonly up: (db: DB) => void;
}

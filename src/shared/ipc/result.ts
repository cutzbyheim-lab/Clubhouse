/**
 * Every IPC handler resolves to a Result. Exceptions never cross the bridge raw:
 * the renderer always receives a serialisable, typed outcome.
 */

export const ERROR_CODES = [
  'VALIDATION', // input failed its Zod schema
  'NOT_FOUND', // referenced row does not exist
  'CONFLICT', // uniqueness / state conflict
  'DATABASE', // SQLite error
  'UNAVAILABLE', // an outside service (e.g. map data) couldn't be reached
  'INTERNAL', // anything unexpected
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface AppError {
  readonly code: ErrorCode;
  readonly message: string;
  /** Field-level issues for VALIDATION errors, keyed by dotted path. */
  readonly issues?: Readonly<Record<string, string>>;
}

export type Result<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly error: AppError };

export const ok = <T>(data: T): Result<T> => ({ ok: true, data });

export const fail = (
  code: ErrorCode,
  message: string,
  issues?: Readonly<Record<string, string>>,
): Result<never> => ({
  ok: false,
  error: issues === undefined ? { code, message } : { code, message, issues },
});

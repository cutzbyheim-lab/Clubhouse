/** Throw from services for expected, user-facing failures. Mapped to Result errors at the IPC boundary. */
export class DomainError extends Error {
  override readonly name = 'DomainError';
  constructor(
    readonly code: 'NOT_FOUND' | 'CONFLICT' | 'VALIDATION',
    message: string,
  ) {
    super(message);
  }
}

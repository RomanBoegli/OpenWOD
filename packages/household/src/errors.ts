/**
 * Structured household errors (API-02): an HTTP status, a machine code, a readable message and a field path where
 * one applies. The server sends them as they are; a browser backend raises the same ones.
 */
export class HouseholdError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly path?: string, readonly extra: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ApiError';
  }
}

export class NotFoundError extends HouseholdError {
  constructor(what: string) { super(404, 'NOT_FOUND', `${what} was not found.`); }
}

/** The stored revision differs from the one the client expected; the current document comes along so the client can resolve it. */
export class ConflictError extends HouseholdError {
  constructor(expected: number | undefined, readonly current: { revision: number; document?: unknown }) {
    super(409, 'REVISION_CONFLICT', `Expected revision ${expected ?? 'none'} but the stored revision is ${current.revision}.`, undefined, { current });
  }
}

import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { WorkoutValidationError } from '../../../packages/domain/src/validate';

/** Structured API errors (API-02): a machine code, a readable message and a field path where one applies. */
export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly path?: string, readonly extra: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ApiError';
  }
}

export class NotFoundError extends ApiError {
  constructor(what: string) { super(404, 'NOT_FOUND', `${what} was not found.`); }
}

/** The stored revision differs from the one the client expected; the current document comes along so the client can resolve it. */
export class ConflictError extends ApiError {
  constructor(expected: number | undefined, readonly current: { revision: number; document?: unknown }) {
    super(409, 'REVISION_CONFLICT', `Expected revision ${expected ?? 'none'} but the stored revision is ${current.revision}.`, undefined, { current });
  }
}

export function errorHandler(error: FastifyError | ApiError | WorkoutValidationError | Error, request: FastifyRequest, reply: FastifyReply) {
  if (error instanceof ApiError) return reply.code(error.status).send({ error: { code: error.code, message: error.message, ...(error.path ? { path: error.path } : {}), ...error.extra } });
  if (error instanceof WorkoutValidationError) return reply.code(400).send({ error: { code: 'VALIDATION_FAILED', message: 'The content is not a valid OpenWOD document.', path: error.issues[0]?.path, issues: error.issues } });
  const fastify = error as FastifyError;
  if (fastify.code === 'FST_ERR_CTP_BODY_TOO_LARGE') return reply.code(413).send({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'The request body is larger than this route accepts.' } });
  if (typeof fastify.code === 'string' && fastify.code.startsWith('FST_ERR_CTP_')) return reply.code(400).send({ error: { code: 'BAD_JSON', message: 'The request body is not valid JSON.' } });
  if (fastify.validation) return reply.code(400).send({ error: { code: 'VALIDATION_FAILED', message: error.message } });
  request.log.error(error);
  return reply.code(500).send({ error: { code: 'INTERNAL', message: 'Something went wrong on the server. The log has the details.' } });
}

import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { WorkoutValidationError } from '../../../packages/domain/src/validate';
import { HouseholdError as ApiError } from '../../../packages/household/src/errors';

/** Structured API errors (API-02) are the household's own (packages/household/src/errors.ts); this file maps them to replies. */
export { ConflictError, HouseholdError as ApiError, NotFoundError } from '../../../packages/household/src/errors';

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

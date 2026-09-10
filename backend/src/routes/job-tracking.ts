import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  validateChangeJobStatus,
  validateCreateSavedJob,
  validateUpdateSavedJob,
} from '../lib/job-tracking.js';
import {
  JobAlreadySavedError,
  changeJobStatus,
  createSavedJob,
  deleteSavedJob,
  getSavedJob,
  listSavedJobs,
  updateSavedJob,
} from '../services/job-tracking.service.js';

/**
 * Individual Job Tracking (AI Job Tools 1.3).
 *
 * Auth-only: the global preHandler sets request.userId and the service scopes
 * every query to it. Deliberately no credits, no rate limit and no
 * `recordToolResult` — reads and writes hit Postgres only, never an LLM (AC9).
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function unauthorized(reply: FastifyReply) {
  return reply.code(401).send({ code: 'UNAUTHORIZED', message: 'Authentication required.' });
}

function notFound(reply: FastifyReply) {
  // Someone else's card and a card that never existed are indistinguishable here.
  return reply.code(404).send({ code: 'NOT_FOUND', message: 'No such job.' });
}

function invalid(reply: FastifyReply, message: string) {
  return reply.code(400).send({ code: 'INVALID_REQUEST', message });
}

function handleError(error: unknown, request: FastifyRequest, reply: FastifyReply, fallback: string) {
  if (error instanceof JobAlreadySavedError) {
    return reply.code(409).send({ code: error.code, message: error.message, jobId: error.jobId });
  }
  const statusCode =
    typeof error === 'object' && error !== null && 'statusCode' in error
      ? Number((error as { statusCode?: unknown }).statusCode)
      : undefined;
  if (statusCode === 503) {
    return reply.code(503).send({ code: 'SERVICE_UNAVAILABLE', message: 'Job tracking is not configured.' });
  }
  request.log.error(error);
  return reply.code(500).send({ code: 'JOB_TRACKING_FAILED', message: fallback });
}

type IdParams = { Params: { id: string } };

export async function registerJobTrackingRoutes(app: FastifyInstance) {
  app.get('/api/job-tracking', async (request, reply) => {
    if (!request.userId) return unauthorized(reply);
    try {
      const jobs = await listSavedJobs(request.userId);
      return reply.code(200).send({ jobs });
    } catch (error) {
      return handleError(error, request, reply, 'Could not load your jobs.');
    }
  });

  app.post('/api/job-tracking', async (request, reply) => {
    if (!request.userId) return unauthorized(reply);
    const parsed = validateCreateSavedJob(request.body);
    if (!parsed.ok) return invalid(reply, parsed.message);
    try {
      const job = await createSavedJob(request.userId, parsed.value);
      return reply.code(201).send({ job });
    } catch (error) {
      return handleError(error, request, reply, 'Could not save that job.');
    }
  });

  app.get<IdParams>('/api/job-tracking/:id', async (request, reply) => {
    if (!request.userId) return unauthorized(reply);
    if (!UUID_RE.test(request.params.id)) return notFound(reply);
    try {
      const detail = await getSavedJob(request.userId, request.params.id);
      if (!detail) return notFound(reply);
      return reply.code(200).send(detail);
    } catch (error) {
      return handleError(error, request, reply, 'Could not load that job.');
    }
  });

  app.patch<IdParams>('/api/job-tracking/:id', async (request, reply) => {
    if (!request.userId) return unauthorized(reply);
    if (!UUID_RE.test(request.params.id)) return notFound(reply);
    const parsed = validateUpdateSavedJob(request.body);
    if (!parsed.ok) return invalid(reply, parsed.message);
    try {
      const job = await updateSavedJob(request.userId, request.params.id, parsed.value);
      if (!job) return notFound(reply);
      return reply.code(200).send({ job });
    } catch (error) {
      return handleError(error, request, reply, 'Could not update that job.');
    }
  });

  app.post<IdParams>('/api/job-tracking/:id/status', async (request, reply) => {
    if (!request.userId) return unauthorized(reply);
    if (!UUID_RE.test(request.params.id)) return notFound(reply);
    const parsed = validateChangeJobStatus(request.body);
    if (!parsed.ok) return invalid(reply, parsed.message);
    try {
      const job = await changeJobStatus(request.userId, request.params.id, parsed.value);
      if (!job) return notFound(reply);
      return reply.code(200).send({ job });
    } catch (error) {
      return handleError(error, request, reply, 'Could not change the status.');
    }
  });

  app.delete<IdParams>('/api/job-tracking/:id', async (request, reply) => {
    if (!request.userId) return unauthorized(reply);
    if (!UUID_RE.test(request.params.id)) return notFound(reply);
    try {
      const removed = await deleteSavedJob(request.userId, request.params.id);
      if (!removed) return notFound(reply);
      return reply.code(204).send();
    } catch (error) {
      return handleError(error, request, reply, 'Could not delete that job.');
    }
  });
}

import type { FastifyInstance } from 'fastify';
import { listToolResults, getToolResult } from '../services/tool-results.service.js';

/**
 * Tool run history (sprint F5). Both routes are auth-only — the global
 * preHandler sets request.userId, and every query is scoped to it, so there is
 * nothing to gate beyond "is signed in". No rate limit: reads hit Postgres only,
 * never an LLM.
 */
export async function registerToolResultsRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { tool?: string; limit?: string } }>(
    '/api/tool-results',
    async (request, reply) => {
      if (!request.userId) {
        return reply.code(401).send({ code: 'UNAUTHORIZED', message: 'Authentication required.' });
      }
      try {
        const results = await listToolResults(request.userId, {
          tool: request.query.tool,
          limit: request.query.limit ? Number(request.query.limit) : undefined,
        });
        return reply.code(200).send({ results, count: results.length });
      } catch (error) {
        request.log.error(error);
        return reply.code(500).send({ code: 'HISTORY_FAILED', message: 'Could not load your history.' });
      }
    },
  );

  app.get<{ Params: { id: string } }>('/api/tool-results/:id', async (request, reply) => {
    if (!request.userId) {
      return reply.code(401).send({ code: 'UNAUTHORIZED', message: 'Authentication required.' });
    }
    try {
      const result = await getToolResult(request.userId, request.params.id);
      // Someone else's row and a row that never existed are indistinguishable
      // from here — both are simply "not found".
      if (!result) {
        return reply.code(404).send({ code: 'NOT_FOUND', message: 'No such result.' });
      }
      return reply.code(200).send({ result });
    } catch (error) {
      request.log.error(error);
      return reply.code(500).send({ code: 'HISTORY_FAILED', message: 'Could not load that result.' });
    }
  });
}

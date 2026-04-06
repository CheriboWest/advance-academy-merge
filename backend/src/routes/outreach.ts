import type { FastifyInstance } from 'fastify';
import { generateOutreach } from '../services/outreach.service.js';
import type { OutreachRequest } from '../types/outreach.js';

export async function registerOutreachRoutes(app: FastifyInstance) {
  app.post<{ Body: OutreachRequest }>('/api/outreach/generate', async (request, reply) => {
    const body = request.body;

    if (
      !body?.rawProfile ||
      !body.targetData ||
      !body.roleData ||
      !body.recruiterData ||
      !body.desiredRole
    ) {
      return reply.code(400).send({
        error:
          'Missing required fields: rawProfile, targetData, roleData, recruiterData, desiredRole',
      });
    }

    try {
      return await generateOutreach(body);
    } catch (error) {
      const statusCode =
        error && typeof error === 'object' && 'statusCode' in error
          ? Number((error as { statusCode?: number }).statusCode)
          : undefined;
      if (statusCode === 503) {
        return reply.code(503).send({
          error:
            error instanceof Error
              ? error.message
              : 'LLM is not configured (set LLM_API_KEY in backend/.env).',
        });
      }
      const message =
        error instanceof Error ? error.message : 'Outreach generation failed';
      request.log.error(error);
      return reply.code(500).send({ error: message });
    }
  });
}

import type { FastifyInstance } from 'fastify';
import { extractJobFromUrl } from '../services/job-extraction.service.js';

export async function registerInterviewPrepRoutes(app: FastifyInstance) {
  app.post<{ Body: { url?: string } }>('/api/interview-prep/extract-job-from-url', async (request, reply) => {
    const url = request.body?.url?.trim();
    if (!url) {
      return reply.code(400).send({ error: 'Missing required field: url' });
    }

    try {
      const job = await extractJobFromUrl(url);
      return job;
    } catch (error) {
      const statusCode =
        error && typeof error === 'object' && 'statusCode' in error
          ? Number((error as { statusCode?: number }).statusCode)
          : 500;
      const message = error instanceof Error ? error.message : 'Job extraction failed';
      if (statusCode === 503) {
        return reply.code(503).send({ error: message });
      }
      request.log.error(error);
      return reply.code(statusCode || 500).send({ error: message });
    }
  });
}

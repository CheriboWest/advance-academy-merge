import type { FastifyInstance } from 'fastify';
import {
  generateCoachUnderstanding,
  getCoachReport,
  listCoachReports,
} from '../services/coach-understanding.service.js';

export async function registerCoachUnderstandingRoutes(app: FastifyInstance) {
  app.post('/api/coach-understanding/generate', async (request, reply) => {
    try {
      return await generateCoachUnderstanding(request.userId);
    } catch (error) {
      const code =
        error && typeof error === 'object' && 'statusCode' in error
          ? Number((error as { statusCode?: number }).statusCode) || 500
          : 500;
      const message = error instanceof Error ? error.message : 'Failed';
      request.log.error(error);
      return reply.code(code).send({ error: message });
    }
  });

  app.get('/api/coach-understanding/reports', async (request, reply) => {
    try {
      return await listCoachReports(request.userId);
    } catch (error) {
      request.log.error(error);
      return reply.code(500).send({ error: 'Failed to list reports' });
    }
  });

  app.get<{ Params: { id: string } }>('/api/coach-understanding/reports/:id', async (request, reply) => {
    try {
      const report = await getCoachReport(request.params.id, request.userId);
      if (!report) return reply.code(404).send({ error: 'Report not found' });
      return report;
    } catch (error) {
      request.log.error(error);
      return reply.code(500).send({ error: 'Failed' });
    }
  });
}

import type { FastifyInstance } from 'fastify';
import {
  analyzeCv,
  getAnalyzeTemplate,
} from '../services/cv-optimizer.service';
import type { AnalyzeCvDto } from '../types/cv-optimizer';

export async function registerCvOptimizerRoutes(app: FastifyInstance) {
  app.get('/api/cv-optimizer/template', async () => getAnalyzeTemplate());

  app.post<{ Body: AnalyzeCvDto }>('/api/cv-optimizer/analyze', async (request, reply) => {
    const body = request.body;

    if (!body?.candidateName || !body?.targetRole || !body?.currentCvText) {
      return reply.code(400).send({
        message: 'candidateName, targetRole, and currentCvText are required.',
      });
    }

    return analyzeCv(body);
  });
}

import type { FastifyInstance } from 'fastify';
import {
  createCvAnalysisJob,
  getCvAnalysisJob,
  getAnalyzeTemplate,
} from '../services/cv-optimizer.service.js';
import type { AnalyzeCvRequest } from '@advance-academy/contracts/cv-optimizer';

export async function registerCvOptimizerRoutes(app: FastifyInstance) {
  app.get('/api/cv-optimizer/template', async () => getAnalyzeTemplate());

  app.post<{ Body: AnalyzeCvRequest }>('/api/cv-optimizer/analyze', async (request, reply) => {
    const body = request.body as AnalyzeCvRequest;

    if (!body?.candidateName || !body?.targetRole || !body?.currentCvText) {
      return reply.code(400).send({
        code: 'INVALID_REQUEST',
        message: 'candidateName, targetRole, and currentCvText are required.',
      });
    }

    const job = await createCvAnalysisJob(body);

    return reply.code(202).send(job);
  });

  app.get<{ Params: { jobId: string } }>('/api/cv-optimizer/jobs/:jobId', async (request, reply) => {
    const job = getCvAnalysisJob(request.params.jobId);

    if (!job) {
      return reply.code(404).send({
        code: 'JOB_NOT_FOUND',
        message: `No CV analysis job found for id ${request.params.jobId}.`,
      });
    }

    return job;
  });
}

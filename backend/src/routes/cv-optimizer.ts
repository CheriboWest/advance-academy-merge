import type { FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import {
  createCvAnalysisJob,
  getCvAnalysisJob,
  getAnalyzeTemplate,
  extractFileText,
} from '../services/cv-optimizer.service.js';
import type { AnalyzeCvRequest } from '@advance-academy/contracts/cv-optimizer';

export async function registerCvOptimizerRoutes(app: FastifyInstance) {
  app.get('/api/cv-optimizer/template', async () => getAnalyzeTemplate());

  await app.register(async (scoped) => {
    await scoped.register(multipart, {
      limits: { fileSize: 15 * 1024 * 1024 },
    });

    scoped.post('/api/cv-optimizer/parse-file', async (request, reply) => {
      let data;
      try {
        data = await request.file();
      } catch {
        return reply.code(400).send({ code: 'INVALID_REQUEST', message: 'Invalid multipart upload' });
      }

      if (!data) {
        return reply.code(400).send({ code: 'INVALID_REQUEST', message: 'No file provided' });
      }

      const fileName = (data.filename ?? '').toLowerCase();
      if (!fileName.endsWith('.pdf') && !fileName.endsWith('.docx')) {
        return reply.code(400).send({ code: 'INVALID_REQUEST', message: 'Only PDF and DOCX files are supported' });
      }

      try {
        const buffer = await data.toBuffer();
        const text = await extractFileText(buffer, fileName);
        return { text };
      } catch (error) {
        const statusCode = error && typeof error === 'object' && 'statusCode' in error
          ? Number((error as { statusCode?: number }).statusCode)
          : undefined;
        if (statusCode === 400 || statusCode === 422) {
          return reply.code(statusCode).send({ code: 'INVALID_REQUEST', message: error instanceof Error ? error.message : 'Parse failed' });
        }
        return reply.code(500).send({ code: 'PARSE_FAILED', message: 'Failed to extract text from file' });
      }
    });
  });

  app.post<{ Body: AnalyzeCvRequest }>('/api/cv-optimizer/analyze', async (request, reply) => {
    const body = request.body as AnalyzeCvRequest;

    if (!body?.targetRole || !body?.currentCvText) {
      return reply.code(400).send({
        code: 'INVALID_REQUEST',
        message: 'targetRole and currentCvText are required.',
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

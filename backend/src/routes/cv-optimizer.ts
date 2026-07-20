import type { FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import {
  createCvAnalysisJob,
  getCvAnalysisJob,
  getAnalyzeTemplate,
  extractFileText,
  rewriteBulletWithAnswers,
} from '../services/cv-optimizer.service.js';
import { generateRewrittenCvFile } from '../services/cv-rewrite-file.service.js';
import { perUserDaily } from '../lib/rate-limit.js';
import type { AnalyzeCvRequest, RewriteBulletRequest, RewriteSuggestion } from '@advance-academy/contracts/cv-optimizer';

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

    scoped.post('/api/cv-optimizer/generate-rewritten-cv', async (request, reply) => {
      let fileBuffer: Buffer | null = null;
      let fileName = '';
      let suggestions: RewriteSuggestion[] = [];

      try {
        const parts = request.parts();
        for await (const part of parts) {
          if (part.type === 'file' && part.fieldname === 'file') {
            fileName = part.filename ?? '';
            fileBuffer = await part.toBuffer();
          } else if (part.type === 'field' && part.fieldname === 'suggestions') {
            try {
              const parsed = JSON.parse(String(part.value));
              if (Array.isArray(parsed)) suggestions = parsed as RewriteSuggestion[];
            } catch {
              return reply.code(400).send({ code: 'INVALID_REQUEST', message: 'Invalid suggestions JSON' });
            }
          }
        }
      } catch {
        return reply.code(400).send({ code: 'INVALID_REQUEST', message: 'Invalid multipart upload' });
      }

      if (!fileBuffer || !fileName) {
        return reply.code(400).send({ code: 'INVALID_REQUEST', message: 'No file provided' });
      }
      if (suggestions.length === 0) {
        return reply.code(400).send({ code: 'INVALID_REQUEST', message: 'No rewrite suggestions provided' });
      }

      try {
        const result = generateRewrittenCvFile(fileBuffer, fileName, suggestions);
        reply
          .header('Content-Type', result.contentType)
          .header('Content-Disposition', `attachment; filename="${result.filename}"`)
          .header('X-Rewrites-Applied', String(result.appliedCount))
          .header('X-Rewrites-Total', String(result.totalCount));
        return reply.send(result.buffer);
      } catch (error) {
        const statusCode = error && typeof error === 'object' && 'statusCode' in error
          ? Number((error as { statusCode?: number }).statusCode)
          : undefined;
        if (statusCode && statusCode >= 400 && statusCode < 500) {
          return reply.code(statusCode).send({
            code: statusCode === 415 ? 'UNSUPPORTED_FORMAT' : 'INVALID_REQUEST',
            message: error instanceof Error ? error.message : 'Rewrite failed',
          });
        }
        return reply.code(500).send({ code: 'REWRITE_FAILED', message: 'Failed to generate rewritten CV' });
      }
    });
  });

  // Per-student daily cap (was IP-keyed 5/10min — a whole campus behind one NAT shared it).
  app.post<{ Body: AnalyzeCvRequest }>(
    '/api/cv-optimizer/analyze',
    perUserDaily('DAILY_LIMIT_CV', 5, 'CV Optimiser'),
    async (request, reply) => {
    const body = request.body as AnalyzeCvRequest;

    if (!body?.targetRole || !body?.currentCvText) {
      return reply.code(400).send({
        code: 'INVALID_REQUEST',
        message: 'targetRole and currentCvText are required.',
      });
    }

    const job = await createCvAnalysisJob(body, request.userId);

    return reply.code(202).send(job);
  });

  app.post<{ Body: RewriteBulletRequest }>('/api/cv-optimizer/rewrite-bullet', async (request, reply) => {
    const body = request.body as RewriteBulletRequest;

    if (!body?.original || !body?.targetRole) {
      return reply.code(400).send({
        code: 'INVALID_REQUEST',
        message: 'original and targetRole are required.',
      });
    }

    try {
      const result = await rewriteBulletWithAnswers({
        original: body.original,
        project: body.project ?? 'Other',
        feedback: body.feedback ?? '',
        clarifyingQuestions: Array.isArray(body.clarifyingQuestions) ? body.clarifyingQuestions : [],
        answers: Array.isArray(body.answers) ? body.answers : [],
        targetRole: body.targetRole,
      });
      return result;
    } catch (error) {
      const statusCode = error && typeof error === 'object' && 'statusCode' in error
        ? Number((error as { statusCode?: number }).statusCode)
        : undefined;
      if (statusCode === 503) {
        return reply.code(503).send({ code: 'LLM_UNAVAILABLE', message: error instanceof Error ? error.message : 'LLM unavailable' });
      }
      return reply.code(500).send({
        code: 'REWRITE_FAILED',
        message: error instanceof Error ? error.message : 'Failed to rewrite bullet.',
      });
    }
  });

  app.get<{ Params: { jobId: string } }>('/api/cv-optimizer/jobs/:jobId', async (request, reply) => {
    const job = await getCvAnalysisJob(request.params.jobId);

    if (!job) {
      return reply.code(404).send({
        code: 'JOB_NOT_FOUND',
        message: `No CV analysis job found for id ${request.params.jobId}.`,
      });
    }

    return job;
  });
}

import type { FastifyInstance } from 'fastify';
import {
  generateCoachAnswer,
  previewCoachAnswer,
} from '../services/coach-answer.service.js';
import type {
  CoachGenerateRequest,
  CoachPreviewRequest,
} from '../types/cv-knowledge.js';

function statusOf(error: unknown): number {
  if (error && typeof error === 'object' && 'statusCode' in error) {
    return Number((error as { statusCode?: number }).statusCode) || 500;
  }
  return 500;
}

export async function registerCoachAnswerRoutes(app: FastifyInstance) {
  // Phase 1: preview — embedding-based retrieval, returns the user-editable
  // evidence pool. No LLM. More permissive limit (10/min) so the user can
  // iterate / re-fetch without being throttled.
  app.post<{ Body: CoachPreviewRequest }>(
    '/api/interview/coach-answer/preview',
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '1 minute',
          keyGenerator: (req) => req.userId ?? req.ip,
          errorResponseBuilder: (_req, ctx) => ({
            code: 'RATE_LIMIT_EXCEEDED',
            scope: 'coach-answer-preview',
            message: `Please slow down — wait ${ctx.after} before requesting another preview.`,
          }),
        },
      },
    },
    async (request, reply) => {
      const body = request.body;
      if (!body?.question?.trim()) {
        return reply.code(400).send({ error: 'question is required' });
      }
      try {
        return await previewCoachAnswer(body, request.userId);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Coach preview failed';
        request.log.error(error);
        return reply.code(statusOf(error)).send({ error: message });
      }
    },
  );

  // Phase 2: generate — runs the LLM rewriter with the user's edited
  // selection. Strict 1/minute limit because each call is an LLM round-trip.
  app.post<{ Body: CoachGenerateRequest }>(
    '/api/interview/coach-answer/generate',
    {
      config: {
        rateLimit: {
          max: 1,
          timeWindow: '1 minute',
          keyGenerator: (req) => req.userId ?? req.ip,
          errorResponseBuilder: (_req, ctx) => ({
            code: 'RATE_LIMIT_EXCEEDED',
            scope: 'coach-answer-generate',
            message: `You can only request one enhanced response per minute. Please wait ${ctx.after} before trying again.`,
          }),
        },
      },
    },
    async (request, reply) => {
      const body = request.body;
      if (!body?.question || !body?.answer || !body?.context) {
        return reply.code(400).send({ error: 'question, answer, and context are required' });
      }
      try {
        return await generateCoachAnswer(body, request.userId);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Coach answer failed';
        request.log.error(error);
        return reply.code(statusOf(error)).send({ error: message });
      }
    },
  );
}

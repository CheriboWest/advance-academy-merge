import type { FastifyInstance } from 'fastify';
import { coachAnswer } from '../services/coach-answer.service.js';
import type { CoachAnswerRequest } from '../types/cv-knowledge.js';

export async function registerCoachAnswerRoutes(app: FastifyInstance) {
  app.post<{ Body: CoachAnswerRequest }>('/api/interview/coach-answer', {
    config: {
      rateLimit: {
        max: 1,
        timeWindow: '1 minute',
        keyGenerator: (req) => req.userId ?? req.ip,
        errorResponseBuilder: (_req, ctx) => ({
          code: 'RATE_LIMIT_EXCEEDED',
          scope: 'coach-answer',
          message: `You can only request one enhanced response per minute. Please wait ${ctx.after} before trying again.`,
        }),
      },
    },
  }, async (request, reply) => {
    const body = request.body;
    if (!body?.question || !body?.answer || !body?.context) {
      return reply.code(400).send({ error: 'question, answer, and context are required' });
    }
    try {
      const result = await coachAnswer(body, request.userId);
      return result;
    } catch (error) {
      const statusCode =
        error && typeof error === 'object' && 'statusCode' in error
          ? Number((error as { statusCode?: number }).statusCode) || 500
          : 500;
      const message = error instanceof Error ? error.message : 'Coach answer failed';
      request.log.error(error);
      return reply.code(statusCode).send({ error: message });
    }
  });
}

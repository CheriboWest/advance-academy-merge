import type { FastifyInstance } from 'fastify';
import { coachAnswer } from '../services/coach-answer.service.js';
import type { CoachAnswerRequest } from '../types/cv-knowledge.js';

export async function registerCoachAnswerRoutes(app: FastifyInstance) {
  app.post<{ Body: CoachAnswerRequest }>('/api/interview/coach-answer', async (request, reply) => {
    const body = request.body;
    if (!body?.question || !body?.answer || !body?.context) {
      return reply.code(400).send({ error: 'question, answer, and context are required' });
    }
    try {
      const result = await coachAnswer(body);
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

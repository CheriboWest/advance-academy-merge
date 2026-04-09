import type { FastifyInstance } from 'fastify';
import {
  startInterviewSession,
  sendInterviewMessage,
  evaluateInterview,
} from '../services/interview.service.js';
import { dbListSessions, dbGetSession } from '../lib/interview-prep/db.js';
import type {
  StartSessionBody,
  SendMessageBody,
  EvaluateSessionBody,
} from '../types/interview-prep.js';

function statusOf(error: unknown): number {
  if (error && typeof error === 'object' && 'statusCode' in error) {
    return Number((error as { statusCode?: number }).statusCode) || 500;
  }
  return 500;
}

export async function registerInterviewRoutes(app: FastifyInstance) {
  // Combined start/message endpoint to mirror the existing client contract.
  app.post<{ Body: StartSessionBody | SendMessageBody }>('/api/interview', async (request, reply) => {
    const body = request.body as (StartSessionBody | SendMessageBody) & { action?: string };
    try {
      if (body?.action === 'start') {
        return await startInterviewSession(body as StartSessionBody);
      }
      if (body?.action === 'message') {
        return await sendInterviewMessage(body as SendMessageBody);
      }
      return reply.code(400).send({ error: 'Unknown action' });
    } catch (error) {
      const code = statusOf(error);
      const message = error instanceof Error ? error.message : 'Internal error';
      request.log.error(error);
      return reply.code(code).send({ error: message });
    }
  });

  app.post<{ Body: EvaluateSessionBody }>('/api/evaluate', async (request, reply) => {
    try {
      return await evaluateInterview(request.body);
    } catch (error) {
      const code = statusOf(error);
      const message = error instanceof Error ? error.message : 'Internal error';
      request.log.error(error);
      return reply.code(code).send({ error: message });
    }
  });

  app.get('/api/interview/sessions', async () => {
    const sessions = await dbListSessions();
    return { sessions };
  });

  app.get<{ Params: { id: string } }>('/api/interview/sessions/:id', async (request, reply) => {
    const session = await dbGetSession(request.params.id);
    if (!session) {
      return reply.code(404).send({ error: 'Session not found' });
    }
    return { session };
  });
}

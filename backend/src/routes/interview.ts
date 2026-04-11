import type { FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import {
  startInterviewSession,
  sendInterviewMessage,
  evaluateInterview,
} from '../services/interview.service.js';
import { transcribeAudio } from '../services/transcription.service.js';
import { dbListSessions, dbGetSession } from '../lib/interview-prep/db.js';
import type {
  StartSessionBody,
  SendMessageBody,
  EvaluateSessionBody,
} from '../types/interview-prep.js';

const ALLOWED_AUDIO_EXTENSIONS = ['.webm', '.mp3', '.wav', '.m4a', '.ogg', '.mp4', '.mpeg', '.mpga'];

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

  // Voice mode transcription (scoped so @fastify/multipart only applies here)
  await app.register(async (scoped) => {
    await scoped.register(multipart, {
      limits: { fileSize: 25 * 1024 * 1024 },
    });

    scoped.post('/api/interview/transcribe', async (request, reply) => {
      let data;
      try {
        data = await request.file();
      } catch {
        return reply.code(400).send({ error: 'Invalid multipart upload' });
      }

      if (!data) {
        return reply.code(400).send({ error: 'No audio file provided' });
      }

      const filename = (data.filename ?? '').toLowerCase();
      const hasAllowedExtension = ALLOWED_AUDIO_EXTENSIONS.some((ext) => filename.endsWith(ext));
      const mimeType = data.mimetype ?? '';
      const hasAudioMime = mimeType.startsWith('audio/') || mimeType.startsWith('video/webm');

      if (!hasAllowedExtension && !hasAudioMime) {
        return reply.code(400).send({
          error: 'Unsupported audio format. Use webm, mp3, wav, m4a, or ogg.',
        });
      }

      let buffer: Buffer;
      try {
        buffer = await data.toBuffer();
      } catch {
        return reply.code(413).send({ error: 'Audio file too large (25 MB max)' });
      }

      try {
        const result = await transcribeAudio(buffer, data.filename || 'answer.webm', mimeType);
        return result;
      } catch (error) {
        const statusCode =
          error && typeof error === 'object' && 'statusCode' in error
            ? Number((error as { statusCode?: number }).statusCode) || 500
            : 500;
        const message = error instanceof Error ? error.message : 'Transcription failed';
        request.log.error(error);
        return reply.code(statusCode).send({ error: message });
      }
    });
  });
}

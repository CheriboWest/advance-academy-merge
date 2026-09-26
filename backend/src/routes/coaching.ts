import type { FastifyInstance } from 'fastify';
import type {
  CreateCoachingSessionRequest,
  SaveSessionNotesRequest,
  UpdateCoachingPackRequest,
  UpdateCoachingSessionRequest,
} from '@advance-academy/contracts/coaching';
import {
  approveCoachingSession,
  buildMockContext,
  createCoachingSession,
  getCoachingSession,
  listCoachingSessions,
  listSessionPractice,
  reopenCoachingSession,
  saveSessionNotes,
  updateCoachingPack,
  updateCoachingSession,
} from '../services/coaching-session.service.js';
import {
  assessContextReadiness,
  listStudentContext,
} from '../services/coaching-context.service.js';
import { generateCoachingPack, regenerateQuestion } from '../services/coaching-pack.service.js';
import { isAdminUser } from '../lib/admin.js';

/**
 * Coaching booking + context (sprint Coaching Tool, ticket T2).
 *
 * The student-facing half of the tool, and the only part of it they touch. The
 * coach's workspace (T5) will get its own routes; nothing here writes anything a
 * coach owns.
 *
 * Rate limits are modest because none of this calls an LLM — booking writes one
 * row and the context endpoint is four selects. The cap on booking exists to
 * stop a loop creating rows, not to meter cost.
 */

const RATE = (max: number, timeWindow: string, message: string) => ({
  config: {
    rateLimit: {
      max,
      timeWindow,
      keyGenerator: (req: { userId?: string; ip: string }) => req.userId ?? req.ip,
      errorResponseBuilder: () => ({ code: 'RATE_LIMIT_EXCEEDED', message }),
    },
  },
});

function statusOf(error: unknown): number {
  const s = Number((error as { statusCode?: number })?.statusCode);
  return Number.isFinite(s) && s >= 400 && s < 600 ? s : 500;
}

function codeOf(error: unknown, fallback: string): string {
  return (error as { code?: string })?.code ?? fallback;
}

// Structural, not derived from FastifyReply: the generic reply type differs per
// route (it carries Params and Body), so a shared helper can only take the shape
// it actually uses. Same approach as routes/dream-company.ts.
type Reply = { code: (status: number) => { send: (body: unknown) => unknown } };
type Request = { userId?: string; log: { error: (o: unknown) => void } };

/**
 * Returns the admin's own id, or null once it has already replied.
 *
 * Returning the id rather than a boolean is what lets `approve` record who
 * signed the pack off without looking `request.userId` up a second time.
 */
async function requireAdmin(request: Request, reply: Reply): Promise<string | null> {
  const actorId = request.userId;
  if (!actorId) {
    reply.code(401).send({ code: 'UNAUTHORIZED', message: 'Authentication required.' });
    return null;
  }
  if (!(await isAdminUser(actorId))) {
    reply.code(403).send({ code: 'FORBIDDEN', message: 'Admin access required.' });
    return null;
  }
  return actorId;
}

/**
 * Pass a service error through when it carries a message written for a human —
 * 404 "no such session", 409 "already approved and locked" — and swallow it into
 * a generic 500 otherwise, so an internal detail never reaches the client.
 */
function sendServiceError(error: unknown, request: Request, reply: Reply, fallback: string) {
  const status = statusOf(error);
  if (status !== 500) {
    return reply
      .code(status)
      .send({ code: codeOf(error, 'REJECTED'), message: (error as Error).message });
  }
  request.log.error(error);
  return reply.code(500).send({ code: 'UPDATE_FAILED', message: fallback });
}

export async function registerCoachingRoutes(app: FastifyInstance) {
  /**
   * GET /api/coaching/context — everything this student has that a pack could be
   * built from, plus what Stage 0 would say about it right now.
   *
   * The `?studentId=` override is admin-only: a coach filling in a booking on
   * someone's behalf needs to see that person's material, not their own.
   */
  app.get<{ Querystring: { studentId?: string } }>(
    '/api/coaching/context',
    RATE(30, '1 minute', 'Too many context lookups. Wait a minute and try again.'),
    async (request, reply) => {
      const actorId = request.userId;
      if (!actorId) {
        return reply.code(401).send({ code: 'UNAUTHORIZED', message: 'Authentication required.' });
      }

      const requested = request.query?.studentId?.trim();
      let studentId = actorId;
      if (requested && requested !== actorId) {
        if (!(await isAdminUser(actorId))) {
          return reply
            .code(403)
            .send({ code: 'FORBIDDEN', message: 'You can only see your own context.' });
        }
        studentId = requested;
      }

      try {
        const inventory = await listStudentContext(studentId);
        // Assessed with no booking inputs yet, so the student sees what they are
        // missing on their side before they start typing.
        const readiness = assessContextReadiness({ inventory });
        return reply.code(200).send({ inventory, readiness });
      } catch (error) {
        request.log.error(error);
        return reply
          .code(statusOf(error))
          .send({ code: 'CONTEXT_FAILED', message: 'Could not load your context.' });
      }
    },
  );

  /**
   * POST /api/coaching/sessions — book one session.
   *
   * Membership + quota are enforced in the service, which is also where a coach
   * booking on behalf of a student bypasses both.
   */
  app.post<{ Body: CreateCoachingSessionRequest }>(
    '/api/coaching/sessions',
    RATE(5, '10 minutes', 'You have submitted several bookings already. Wait a few minutes.'),
    async (request, reply) => {
      const actorId = request.userId;
      if (!actorId) {
        return reply.code(401).send({ code: 'UNAUTHORIZED', message: 'Authentication required.' });
      }

      try {
        const session = await createCoachingSession({ actorId, body: request.body ?? ({} as CreateCoachingSessionRequest) });
        // Kick the pipeline off and return immediately. Four LLM calls plus
        // web fetches run for minutes; the student gets their confirmation now
        // and the row carries the progress. Errors land on the row, never here.
        void generateCoachingPack(session.id).catch((err) => {
          request.log.error({ err, sessionId: session.id }, 'coaching pack generation crashed');
        });
        return reply.code(201).send({ session });
      } catch (error) {
        const status = statusOf(error);
        const message = error instanceof Error ? error.message : 'Could not book the session.';
        // 403 (not membership), 422 (form problem) and 429 (quota spent) all
        // carry a message written for the student — pass it through verbatim.
        if (status !== 500) {
          return reply.code(status).send({ code: codeOf(error, 'BOOKING_REJECTED'), message });
        }
        request.log.error(error);
        return reply.code(500).send({ code: 'BOOKING_FAILED', message: 'Could not book the session.' });
      }
    },
  );

  /** GET /api/coaching/sessions — the student's own, or the whole queue for a coach. */
  app.get<{ Querystring: { studentId?: string; limit?: string; scope?: string } }>(
    '/api/coaching/sessions',
    async (request, reply) => {
      const actorId = request.userId;
      if (!actorId) {
        return reply.code(401).send({ code: 'UNAUTHORIZED', message: 'Authentication required.' });
      }

      // A coach sees the queue only when they ask for it, so opening their own
      // booking list does not dump every student's session on them.
      const wantsQueue = request.query?.scope === 'all' || Boolean(request.query?.studentId);
      const asAdmin = wantsQueue && (await isAdminUser(actorId));
      if (wantsQueue && !asAdmin) {
        return reply
          .code(403)
          .send({ code: 'FORBIDDEN', message: 'Admin access required.' });
      }

      try {
        const sessions = await listCoachingSessions(actorId, {
          asAdmin,
          studentId: request.query?.studentId?.trim() || undefined,
          limit: request.query?.limit ? Number(request.query.limit) : undefined,
        });
        return reply.code(200).send({ sessions, count: sessions.length });
      } catch (error) {
        request.log.error(error);
        return reply
          .code(500)
          .send({ code: 'LIST_FAILED', message: 'Could not load your coaching sessions.' });
      }
    },
  );

  /**
   * POST /api/coaching/sessions/:id/generate — (re)run the pipeline.
   *
   * Admin-only. This is the Context Desk's "generate anyway" button and the
   * retry after a failed stage; a student never regenerates their own pack,
   * because each run is four LLM calls they did not pay for.
   */
  app.post<{ Params: { id: string }; Body: { force?: boolean; sessionMinutes?: number } }>(
    '/api/coaching/sessions/:id/generate',
    RATE(6, '1 hour', 'That is several regenerations in an hour. Give it a rest.'),
    async (request, reply) => {
      const actorId = request.userId;
      if (!actorId) {
        return reply.code(401).send({ code: 'UNAUTHORIZED', message: 'Authentication required.' });
      }
      if (!(await isAdminUser(actorId))) {
        return reply.code(403).send({ code: 'FORBIDDEN', message: 'Admin access required.' });
      }

      const session = await getCoachingSession(request.params.id, actorId, true);
      if (!session) {
        return reply.code(404).send({ code: 'NOT_FOUND', message: 'No such session.' });
      }
      if (session.status === 'generating') {
        return reply
          .code(409)
          .send({ code: 'ALREADY_RUNNING', message: 'This pack is already being generated.' });
      }

      const body = request.body ?? {};
      // 202 and let it run: the same latency that forced the async design in the
      // first place applies just as much to a manual retry.
      void generateCoachingPack(request.params.id, {
        force: body.force === true,
        sessionMinutes: Number.isFinite(Number(body.sessionMinutes))
          ? Number(body.sessionMinutes)
          : undefined,
      }).catch((err) => {
        request.log.error({ err, sessionId: request.params.id }, 'coaching pack generation crashed');
      });

      return reply.code(202).send({ status: 'generating', sessionId: request.params.id });
    },
  );

  // ── Coach workspace (ticket T5) — every route below is admin-only ─────────

  /** PATCH /api/coaching/sessions/:id — coach notes, extra pages, the slot. */
  app.patch<{ Params: { id: string }; Body: UpdateCoachingSessionRequest }>(
    '/api/coaching/sessions/:id',
    async (request, reply) => {
      const guard = await requireAdmin(request, reply);
      if (!guard) return;
      try {
        const session = await updateCoachingSession(request.params.id, request.body ?? {});
        return reply.code(200).send({ session });
      } catch (error) {
        return sendServiceError(error, request, reply, 'Could not update the session.');
      }
    },
  );

  /** PATCH /api/coaching/sessions/:id/pack — question, agenda and reverse-question edits. */
  app.patch<{ Params: { id: string }; Body: UpdateCoachingPackRequest }>(
    '/api/coaching/sessions/:id/pack',
    async (request, reply) => {
      const guard = await requireAdmin(request, reply);
      if (!guard) return;
      try {
        const pack = await updateCoachingPack(request.params.id, request.body ?? {});
        return reply.code(200).send({ pack });
      } catch (error) {
        return sendServiceError(error, request, reply, 'Could not save your edits.');
      }
    },
  );

  /**
   * POST /api/coaching/sessions/:id/questions/:questionId/regenerate
   *
   * One LLM call, so it is capped tighter than the read routes but far looser
   * than a full regeneration — rejecting a single question is the commonest
   * edit a coach makes.
   */
  app.post<{ Params: { id: string; questionId: string }; Body: { direction?: string } }>(
    '/api/coaching/sessions/:id/questions/:questionId/regenerate',
    RATE(20, '10 minutes', 'That is a lot of rewrites. Give it a few minutes.'),
    async (request, reply) => {
      const guard = await requireAdmin(request, reply);
      if (!guard) return;
      try {
        const question = await regenerateQuestion({
          sessionId: request.params.id,
          questionId: request.params.questionId,
          direction: request.body?.direction,
        });
        return reply.code(200).send({ question });
      } catch (error) {
        return sendServiceError(error, request, reply, 'Could not rewrite that question.');
      }
    },
  );

  /**
   * PATCH /api/coaching/sessions/:id/notes — what came out of the hour (T6.5).
   *
   * Its own route rather than a field on the session PATCH, because it is the
   * one thing a coach writes AFTER approving, and the session PATCH refuses to
   * touch an approved session by design.
   */
  app.patch<{ Params: { id: string }; Body: SaveSessionNotesRequest }>(
    '/api/coaching/sessions/:id/notes',
    async (request, reply) => {
      const guard = await requireAdmin(request, reply);
      if (!guard) return;
      try {
        const session = await saveSessionNotes(request.params.id, request.body ?? {});
        return reply.code(200).send({ session });
      } catch (error) {
        return sendServiceError(error, request, reply, 'Could not save the notes.');
      }
    },
  );

  /** POST /api/coaching/sessions/:id/approve — sign it off; the student can now read it. */
  app.post<{ Params: { id: string } }>(
    '/api/coaching/sessions/:id/approve',
    async (request, reply) => {
      const actorId = await requireAdmin(request, reply);
      if (!actorId) return;
      try {
        const session = await approveCoachingSession(request.params.id, actorId);
        return reply.code(200).send({ session });
      } catch (error) {
        return sendServiceError(error, request, reply, 'Could not approve the session.');
      }
    },
  );

  /** POST /api/coaching/sessions/:id/reopen — undo an approval to edit again. */
  app.post<{ Params: { id: string } }>(
    '/api/coaching/sessions/:id/reopen',
    async (request, reply) => {
      const guard = await requireAdmin(request, reply);
      if (!guard) return;
      try {
        const session = await reopenCoachingSession(request.params.id);
        return reply.code(200).send({ session });
      } catch (error) {
        return sendServiceError(error, request, reply, 'Could not reopen the session.');
      }
    },
  );

  /**
   * GET /api/coaching/sessions/:id/mock — the Interview Lab context for this
   * pack, with the coach's approved questions as its question bank (T7).
   *
   * Open to the student: rehearsing is theirs to do. The approval gate lives in
   * the service.
   */
  app.get<{ Params: { id: string } }>('/api/coaching/sessions/:id/mock', async (request, reply) => {
    const actorId = request.userId;
    if (!actorId) {
      return reply.code(401).send({ code: 'UNAUTHORIZED', message: 'Authentication required.' });
    }
    try {
      const asAdmin = await isAdminUser(actorId);
      const context = await buildMockContext(request.params.id, actorId, asAdmin);
      if (!context) {
        return reply.code(404).send({ code: 'NOT_FOUND', message: 'No such session.' });
      }
      return reply.code(200).send({ context });
    } catch (error) {
      return sendServiceError(error, request, reply, 'Could not start a mock for this session.');
    }
  });

  /** GET /api/coaching/sessions/:id/practice — mocks run against this pack (T7). */
  app.get<{ Params: { id: string } }>(
    '/api/coaching/sessions/:id/practice',
    async (request, reply) => {
      const actorId = request.userId;
      if (!actorId) {
        return reply.code(401).send({ code: 'UNAUTHORIZED', message: 'Authentication required.' });
      }
      try {
        const asAdmin = await isAdminUser(actorId);
        const session = await getCoachingSession(request.params.id, actorId, asAdmin);
        if (!session) {
          return reply.code(404).send({ code: 'NOT_FOUND', message: 'No such session.' });
        }
        const runs = await listSessionPractice(request.params.id, session.studentId);
        return reply.code(200).send({ runs, count: runs.length });
      } catch (error) {
        return sendServiceError(error, request, reply, 'Could not load the practice runs.');
      }
    },
  );

  /** GET /api/coaching/sessions/:id — one session. */
  app.get<{ Params: { id: string } }>('/api/coaching/sessions/:id', async (request, reply) => {
    const actorId = request.userId;
    if (!actorId) {
      return reply.code(401).send({ code: 'UNAUTHORIZED', message: 'Authentication required.' });
    }

    try {
      const asAdmin = await isAdminUser(actorId);
      const session = await getCoachingSession(request.params.id, actorId, asAdmin);
      // Someone else's session and one that never existed are the same answer.
      if (!session) {
        return reply.code(404).send({ code: 'NOT_FOUND', message: 'No such session.' });
      }
      return reply.code(200).send({ session });
    } catch (error) {
      request.log.error(error);
      return reply
        .code(500)
        .send({ code: 'SESSION_FAILED', message: 'Could not load that session.' });
    }
  });
}

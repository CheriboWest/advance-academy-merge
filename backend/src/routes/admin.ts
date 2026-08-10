import type { FastifyInstance } from 'fastify';
import { isAdminUser } from '../lib/admin.js';
import { listUsers, updateUser, type UpdateUserPatch } from '../services/admin.service.js';
import { getPersonProfile } from '../services/admin-person.service.js';
import type { Tier } from '../lib/credits.js';

/**
 * Admin user management (sprint F4). The global auth preHandler already proves
 * the caller is logged in; every route here additionally requires admin rights
 * (users.is_admin or the ADMIN_USER_IDS allowlist — see lib/admin.ts).
 *
 * Not rate-limited: admin-only, no LLM spend.
 */

const TIERS: Tier[] = ['trial', 'membership'];
// 'pending' is the DB default, not something an admin sets — a review is a decision.
const REVIEW_DECISIONS = ['approved', 'rejected'] as const;

/**
 * Both balances move by a signed whole number, and both are typed `number` on the
 * wire, so `"3"`, `3.5` and `NaN` all have to be rejected here rather than reach
 * `planUserUpdate`, where a fractional delta would write a fractional balance.
 */
export function readDelta(value: unknown): number | null {
  // Booleans, null and objects are rejected outright: `Number(true)` is 1, which
  // would turn `{"coachingDelta": true}` into a free session.
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const delta = Number(value);
  return Number.isInteger(delta) ? delta : null;
}

export async function registerAdminRoutes(app: FastifyInstance) {
  // ── GET /api/admin/users ──────────────────────────────────────────────────
  app.get('/api/admin/users', async (request, reply) => {
    if (!(await isAdminUser(request.userId))) {
      return reply.code(403).send({ code: 'FORBIDDEN', message: 'Admin access required.' });
    }
    const q = (request.query ?? {}) as {
      search?: string;
      tier?: string;
      status?: string;
      limit?: string;
    };
    try {
      const users = await listUsers({
        search: q.search,
        tier: q.tier,
        status: q.status,
        limit: q.limit ? Number(q.limit) : undefined,
      });
      return reply.code(200).send({ users, count: users.length });
    } catch (error) {
      request.log.error(error);
      return reply.code(500).send({ code: 'LIST_FAILED', message: 'Could not load users.' });
    }
  });

  // ── GET /api/admin/people/:id ─────────────────────────────────────────────
  // `:id` is a users.id or a candidate_leads.id — both admin tables link here
  // with whatever id their row holds, and the service resolves the other half.
  app.get<{ Params: { id: string } }>('/api/admin/people/:id', async (request, reply) => {
    if (!(await isAdminUser(request.userId))) {
      return reply.code(403).send({ code: 'FORBIDDEN', message: 'Admin access required.' });
    }
    try {
      const person = await getPersonProfile(request.params.id);
      return reply.code(200).send({ person });
    } catch (error) {
      const e = error as { statusCode?: number; message?: string };
      if (Number(e?.statusCode) === 404) {
        return reply.code(404).send({ code: 'NOT_FOUND', message: 'No such person.' });
      }
      request.log.error(error);
      return reply.code(500).send({ code: 'LOAD_FAILED', message: 'Could not load this person.' });
    }
  });

  // ── PATCH /api/admin/users/:userId ────────────────────────────────────────
  // Body: { status?: 'approved'|'rejected', tier?: 'trial'|'membership',
  //         creditDelta?: number, coachingDelta?: number, isAdmin?: boolean }
  app.patch<{ Params: { userId: string }; Body: UpdateUserPatch }>(
    '/api/admin/users/:userId',
    async (request, reply) => {
      if (!(await isAdminUser(request.userId))) {
        return reply.code(403).send({ code: 'FORBIDDEN', message: 'Admin access required.' });
      }

      const body = (request.body ?? {}) as UpdateUserPatch;
      const patch: UpdateUserPatch = {};

      if (body.status !== undefined) {
        if (!REVIEW_DECISIONS.includes(body.status)) {
          return reply.code(400).send({
            code: 'INVALID_REQUEST',
            message: `status must be one of: ${REVIEW_DECISIONS.join(', ')}`,
          });
        }
        patch.status = body.status;
      }
      if (body.tier !== undefined) {
        if (!TIERS.includes(body.tier)) {
          return reply
            .code(400)
            .send({ code: 'INVALID_REQUEST', message: `tier must be one of: ${TIERS.join(', ')}` });
        }
        patch.tier = body.tier;
      }
      if (body.creditDelta !== undefined) {
        const delta = readDelta(body.creditDelta);
        if (delta === null) {
          return reply
            .code(400)
            .send({ code: 'INVALID_REQUEST', message: 'creditDelta must be a whole number.' });
        }
        patch.creditDelta = delta;
      }
      if (body.coachingDelta !== undefined) {
        const delta = readDelta(body.coachingDelta);
        if (delta === null) {
          return reply
            .code(400)
            .send({ code: 'INVALID_REQUEST', message: 'coachingDelta must be a whole number.' });
        }
        patch.coachingDelta = delta;
      }
      if (body.isAdmin !== undefined) {
        if (typeof body.isAdmin !== 'boolean') {
          return reply.code(400).send({ code: 'INVALID_REQUEST', message: 'isAdmin must be a boolean.' });
        }
        patch.isAdmin = body.isAdmin;
      }

      try {
        const user = await updateUser(request.userId!, request.params.userId, patch);
        return reply.code(200).send({ user });
      } catch (error) {
        const e = error as { statusCode?: number; message?: string };
        const status = Number(e?.statusCode) || 500;
        if (status !== 500) {
          return reply.code(status).send({ code: 'UPDATE_REJECTED', message: e.message });
        }
        request.log.error(error);
        return reply.code(500).send({ code: 'UPDATE_FAILED', message: 'Could not update the account.' });
      }
    },
  );
}

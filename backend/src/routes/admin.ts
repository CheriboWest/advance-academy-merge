import type { FastifyInstance } from 'fastify';
import { isAdminUser } from '../lib/admin.js';
import { listUsers, updateUser, type UpdateUserPatch } from '../services/admin.service.js';
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

  // ── PATCH /api/admin/users/:userId ────────────────────────────────────────
  // Body: { status?: 'approved'|'rejected', tier?: 'trial'|'membership',
  //         creditDelta?: number, isAdmin?: boolean }
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
        const delta = Number(body.creditDelta);
        if (!Number.isFinite(delta) || !Number.isInteger(delta)) {
          return reply
            .code(400)
            .send({ code: 'INVALID_REQUEST', message: 'creditDelta must be a whole number.' });
        }
        patch.creditDelta = delta;
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

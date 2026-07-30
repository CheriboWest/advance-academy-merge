import type { FastifyInstance } from 'fastify';
import { getReferralStatus, creditReferralOnActivation } from '../services/referral.service.js';

/**
 * Referral endpoints (CA-001, ticket P3c). Both require auth (the global
 * preHandler sets request.userId) — NOT in the skip-list.
 *
 *   GET  /api/referral/me       — the caller's invite code + progress.
 *   POST /api/referral/activate — called once from /auth/callback after a fresh
 *                                 sign-in; credits the inviter if this user was
 *                                 referred. Idempotent.
 */
export async function registerReferralRoutes(app: FastifyInstance) {
  app.get('/api/referral/me', async (request, reply) => {
    if (!request.userId) {
      return reply.code(401).send({ code: 'UNAUTHORIZED', message: 'Authentication required.' });
    }
    try {
      const status = await getReferralStatus(request.userId);
      return reply.code(200).send(status);
    } catch (error) {
      request.log.error(error);
      return reply.code(500).send({ code: 'REFERRAL_FAILED', message: 'Could not load referral status.' });
    }
  });

  app.post('/api/referral/activate', async (request, reply) => {
    if (!request.userId) {
      return reply.code(401).send({ code: 'UNAUTHORIZED', message: 'Authentication required.' });
    }
    try {
      await creditReferralOnActivation(request.userId);
      return reply.code(200).send({ ok: true });
    } catch (error) {
      request.log.error(error);
      // Best-effort: never block the login just because crediting failed.
      return reply.code(200).send({ ok: false });
    }
  });
}

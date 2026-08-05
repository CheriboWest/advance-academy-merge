import type { FastifyInstance } from 'fastify';
import { getAccount } from '../lib/credits.js';
import { isAdminUser } from '../lib/admin.js';
import { getUserStatus } from '../lib/user-access.js';

/**
 * The caller's own account summary (sprint F4 follow-up).
 *
 * GET /api/account/me — approval status, tier, wallet balance and admin flag.
 * Drives the header (credit pill, Admin link) and the /pending screen.
 *
 * This is the ONE route the approval gate in main.ts lets a pending account
 * through to — otherwise the pending screen could not read its own status.
 *
 * `isAdmin` comes from lib/admin.ts rather than straight off the row, so the
 * ADMIN_USER_IDS allowlist counts here exactly as it does on the admin routes —
 * otherwise an env-only admin would be denied the link to a page they can open.
 */
export async function registerAccountRoutes(app: FastifyInstance) {
  app.get('/api/account/me', async (request, reply) => {
    if (!request.userId) {
      return reply.code(401).send({ code: 'UNAUTHORIZED', message: 'Authentication required.' });
    }
    try {
      const [account, isAdmin, status] = await Promise.all([
        getAccount(request.userId),
        isAdminUser(request.userId),
        getUserStatus(request.userId),
      ]);
      return reply.code(200).send({
        status,
        tier: account.tier,
        credits: account.credits,
        isAdmin,
      });
    } catch (error) {
      request.log.error(error);
      return reply.code(500).send({ code: 'ACCOUNT_FAILED', message: 'Could not load your account.' });
    }
  });
}

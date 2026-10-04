import type { FastifyInstance } from 'fastify';
import { requireMembership } from '../lib/credits.js';
import { getCompanyContactSummary, getCompanyContacts } from '../services/company-contacts.service.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Unlock Contacts on the public company page.
 *
 * GET /api/public/company-contacts/:companyId/summary — public (no token): only
 *   counts per category, so a signed-out visitor sees what's behind the lock.
 * GET /api/company-contacts/:companyId — signed in, approved, and on Membership.
 *   Trial accounts get 403 MEMBERSHIP_REQUIRED, which the page shows as the
 *   upgrade prompt.
 */
export async function registerCompanyContactsRoutes(app: FastifyInstance) {
  app.get<{ Params: { companyId: string } }>(
    '/api/public/company-contacts/:companyId/summary',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { companyId } = request.params;
      if (!UUID.test(companyId)) return reply.code(400).send({ code: 'INVALID_REQUEST', message: 'Invalid company id.' });
      try {
        return await getCompanyContactSummary(companyId);
      } catch (error) {
        request.log.error(error);
        return reply.code(500).send({ code: 'CONTACTS_FAILED', message: 'Could not load contacts.' });
      }
    },
  );

  app.get<{ Params: { companyId: string } }>(
    '/api/company-contacts/:companyId',
    {
      config: {
        rateLimit: {
          // No LLM behind this; the cap is there to stop the directory being scraped.
          max: 30,
          timeWindow: '1 minute',
          keyGenerator: (req) => req.userId ?? req.ip,
          errorResponseBuilder: (_req, ctx) => ({
            code: 'RATE_LIMIT_EXCEEDED',
            scope: 'company-contacts',
            message: `Too many requests — please wait ${ctx.after}.`,
          }),
        },
      },
    },
    async (request, reply) => {
      const { companyId } = request.params;
      if (!UUID.test(companyId)) return reply.code(400).send({ code: 'INVALID_REQUEST', message: 'Invalid company id.' });
      try {
        await requireMembership(request.userId, 'Company contacts');
        return { contacts: await getCompanyContacts(companyId) };
      } catch (error) {
        const e = error as { statusCode?: number; code?: string; message?: string };
        if (e.statusCode === 403) {
          return reply.code(403).send({ code: e.code ?? 'MEMBERSHIP_REQUIRED', message: e.message });
        }
        request.log.error(error);
        return reply.code(500).send({ code: 'CONTACTS_FAILED', message: 'Could not load contacts.' });
      }
    },
  );
}

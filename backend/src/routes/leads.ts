import type { FastifyInstance, FastifyRequest } from 'fastify';
import { CSV_HEADER, toCsvLine } from '@advance-academy/contracts';
import {
  captureLead,
  confirmLead,
  unsubscribeLead,
  listLeads,
  sendConfirmEmail,
  isValidEmail,
} from '../services/leads.service.js';
import { createTrialAndSendMagicLink } from '../services/passwordless.service.js';
import { isAdminUser } from '../lib/admin.js';

/**
 * Candidate Acquisition — lead-capture pipe (CA-001).
 *
 * Public (no auth): /capture, /confirm, /unsubscribe — hit by anonymous
 *   job-seekers and by email-link clicks. These paths are added to the auth
 *   skip-list in main.ts.
 * Admin (auth): GET /leads — list + CSV export.
 */

// 5 requests / minute / IP — enough for a human, throttles bots. The endpoint is
// public (no userId), so we key by IP.
const CAPTURE_RATE_LIMIT = {
  config: {
    rateLimit: {
      max: 5,
      timeWindow: '1 minute',
      keyGenerator: (req: FastifyRequest) => req.ip,
      errorResponseBuilder: (_req: FastifyRequest, ctx: { after: string }) => ({
        code: 'RATE_LIMIT_EXCEEDED',
        message: `Too many submissions. Please try again in ${ctx.after}.`,
      }),
    },
  },
};

interface CaptureBody {
  email?: unknown;
  name?: unknown;
  source?: unknown;
  leadMagnetId?: unknown;
  result?: unknown;
  readinessScore?: unknown;
  consentMarketing?: unknown;
  website?: unknown; // honeypot — real users never fill this
  utm?: { source?: unknown; medium?: unknown; campaign?: unknown };
  ref?: unknown; // referral code of the inviter (P3c)
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

export async function registerLeadsRoutes(app: FastifyInstance) {
  // ── POST /api/leads/capture (public) ──────────────────────────────────────
  app.post('/api/leads/capture', CAPTURE_RATE_LIMIT, async (request, reply) => {
    // 1. Master switch off => behave as if the route doesn't exist.
    if (process.env.LEADS_CAPTURE_ENABLED !== 'true') {
      return reply.code(404).send({ code: 'NOT_FOUND', message: 'Not found' });
    }

    const body = (request.body ?? {}) as CaptureBody;

    // 2. Honeypot: a bot filled the hidden field. Pretend success, store nothing.
    if (str(body.website)) {
      return reply.code(200).send({ ok: true });
    }

    // 3. Validate email + source + consent.
    if (!isValidEmail(body.email)) {
      return reply.code(422).send({ code: 'INVALID_EMAIL', message: 'A valid email is required.' });
    }
    const source = str(body.source);
    if (!source) {
      return reply.code(422).send({ code: 'INVALID_SOURCE', message: 'A source is required.' });
    }
    const consentMarketing = body.consentMarketing === true;

    const readinessScore =
      typeof body.readinessScore === 'number' && Number.isFinite(body.readinessScore)
        ? Math.round(body.readinessScore)
        : null;

    try {
      const { leadId, optinToken } = await captureLead({
        email: body.email as string,
        name: str(body.name),
        source,
        leadMagnetId: str(body.leadMagnetId),
        result: body.result ?? null,
        readinessScore,
        consentMarketing,
        utm: {
          source: str(body.utm?.source),
          medium: str(body.utm?.medium),
          campaign: str(body.utm?.campaign),
        },
      });

      // Only email people who actually opted in to marketing contact.
      if (consentMarketing) {
        if (source === 'quiz') {
          // Quiz funnel (Lan story, steps 3–5): turn the lead into a trial
          // account and email a magic login link instead of a plain confirm.
          // Best-effort — the lead is already saved, so a mail/auth hiccup must
          // never 500 the capture; fall back to the confirm email.
          try {
            await createTrialAndSendMagicLink(body.email as string, str(body.name), str(body.ref));
          } catch (err) {
            request.log.error(err);
            await sendConfirmEmail(body.email as string, optinToken);
          }
        } else {
          await sendConfirmEmail(body.email as string, optinToken);
        }
      }

      return reply.code(200).send({ ok: true, leadId });
    } catch (error) {
      request.log.error(error);
      return reply.code(500).send({ code: 'CAPTURE_FAILED', message: 'Could not save your details. Please try again.' });
    }
  });

  // ── GET /api/leads/confirm?token= (public) ────────────────────────────────
  app.get('/api/leads/confirm', async (request, reply) => {
    const token = str((request.query as { token?: unknown })?.token);
    let ok = false;
    try {
      ok = token ? await confirmLead(token) : false;
    } catch (error) {
      request.log.error(error);
      return reply.code(500).type('text/html').send('<p>Something went wrong. Please try again later.</p>');
    }
    if (!ok) {
      return reply.code(400).type('text/html').send('<p>This confirmation link is invalid or has expired.</p>');
    }
    return reply
      .code(200)
      .type('text/html')
      .send('<p>Thanks — your email is confirmed. You can close this tab.</p>');
  });

  // ── POST /api/leads/unsubscribe?token= (public) ───────────────────────────
  app.post('/api/leads/unsubscribe', async (request, reply) => {
    const token = str((request.query as { token?: unknown })?.token);
    try {
      const ok = token ? await unsubscribeLead(token) : false;
      return reply.code(ok ? 200 : 400).send({ ok });
    } catch (error) {
      request.log.error(error);
      return reply.code(500).send({ code: 'UNSUB_FAILED', message: 'Could not process the request.' });
    }
  });

  // ── GET /api/leads (admin only) ───────────────────────────────────────────
  // The global preHandler already guarantees the caller is authenticated and set
  // request.userId; here we further require admin rights (users.is_admin or the
  // ADMIN_USER_IDS allowlist — see lib/admin.ts).
  app.get('/api/leads', async (request, reply) => {
    if (!(await isAdminUser(request.userId))) {
      return reply.code(403).send({ code: 'FORBIDDEN', message: 'Admin access required.' });
    }
    const q = (request.query ?? {}) as {
      status?: string;
      source?: string;
      utm_source?: string;
      format?: string;
      limit?: string;
    };
    try {
      const rows = await listLeads({
        status: q.status,
        source: q.source,
        utmSource: q.utm_source,
        limit: q.limit ? Number(q.limit) : undefined,
      });

      if (q.format === 'csv') {
        const lines = [CSV_HEADER, ...rows.map(toCsvLine)];
        // Same builder the /admin/leads download button uses — see contracts.
        return reply
          .code(200)
          .header('Content-Type', 'text/csv')
          .header('Content-Disposition', 'attachment; filename="candidate_leads.csv"')
          .send(lines.join('\n'));
      }

      return reply.code(200).send({ leads: rows, count: rows.length });
    } catch (error) {
      request.log.error(error);
      return reply.code(500).send({ code: 'LIST_FAILED', message: 'Could not load leads.' });
    }
  });
}

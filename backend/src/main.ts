import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import { getUserIdFromToken } from './lib/supabase.js';
import { approvalError, getUserAccess, type UserAccess } from './lib/user-access.js';
import { startCvAnalysisReaper } from './lib/cv-analysis-reaper.js';

declare module 'fastify' {
  interface FastifyRequest {
    userId: string;
    userAccess: UserAccess;
  }
}
import { registerAdminRoutes } from './routes/admin.js';
import { registerSystemRoutes } from './routes/system.js';
import { registerCvOptimizerRoutes } from './routes/cv-optimizer.js';
import { registerDreamCompanyRoutes } from './routes/dream-company.js';
import { registerOutreachRoutes } from './routes/outreach.js';
import { registerInterviewPrepRoutes } from './routes/interview-prep.js';
import { registerCvLibraryRoutes } from './routes/cv-library.js';
import { registerCoachAnswerRoutes } from './routes/coach-answer.js';
import { registerInterviewRoutes } from './routes/interview.js';
import { registerCoachUnderstandingRoutes } from './routes/coach-understanding.js';

function loadBackendEnvFile() {
  const candidates = [
    resolve(process.cwd(), '.env'),
    resolve(process.cwd(), 'backend/.env'),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      process.loadEnvFile?.(candidate);
      return;
    }
  }
}

async function bootstrap() {
  loadBackendEnvFile();

  const app = Fastify({
    logger: true,
  });
  const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000';
  const port = Number(process.env.PORT ?? 4000);

  await app.register(cors, {
    origin: frontendUrl.split(',').map((url) => url.trim()),
    credentials: true,
  });

  await app.register(rateLimit, {
    global: false, // opt-in per route only
    // Fire at preHandler so the route-level keyGenerator can read request.userId
    // (the auth preHandler below attaches it). Existing IP-keyed routes are
    // unaffected — request.ip is available at every lifecycle stage.
    hook: 'preHandler',
    keyGenerator: (request) => request.ip,
    errorResponseBuilder: (_request, context) => ({
      code: 'RATE_LIMIT_EXCEEDED',
      message: `Too many requests. Please try again in ${Math.ceil(context.ttl / 1000)}s.`,
    }),
  });

  app.addHook('preHandler', async (request, reply) => {
    const skipPaths = ['/api/health', '/api/system'];
    if (skipPaths.some((p) => request.url.startsWith(p))) return;

    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return reply.code(401).send({ code: 'UNAUTHORIZED', message: 'Authentication required.' });
    }
    try {
      request.userId = await getUserIdFromToken(authHeader.slice(7));
    } catch {
      return reply.code(401).send({ code: 'UNAUTHORIZED', message: 'Invalid or expired token.' });
    }

    // Approval gate. This is the ONE choke point every route already passes through,
    // so new features are covered without touching them. 403 not 401 — the token is
    // valid, the account just isn't cleared yet, and the frontend needs to tell those
    // apart (401 → re-login, 403 → show the pending screen).
    // `/api/me` is exempt so the pending screen can read its own status. Exact path
    // match, not startsWith — a prefix would silently exempt any future `/api/me*`.
    request.userAccess = await getUserAccess(request.userId);
    if (request.url.split('?')[0] === '/api/me') return;

    const denied = approvalError(request.userAccess);
    if (denied) return reply.code(403).send(denied);
  });

  await registerAdminRoutes(app);
  await registerSystemRoutes(app);
  await registerCvOptimizerRoutes(app);
  await registerDreamCompanyRoutes(app);
  await registerOutreachRoutes(app);
  await registerInterviewPrepRoutes(app);
  await registerCvLibraryRoutes(app);
  await registerCoachAnswerRoutes(app);
  await registerInterviewRoutes(app);
  await registerCoachUnderstandingRoutes(app);

  await app.listen({
    port,
    host: '0.0.0.0',
  });

  startCvAnalysisReaper();

  console.log(`Backend running at http://localhost:${port}/api`);
  console.log(`Health check: http://localhost:${port}/api/health`);
}

void bootstrap();

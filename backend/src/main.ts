import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import cors from '@fastify/cors';
import Fastify from 'fastify';
import { registerSystemRoutes } from './routes/system.js';
import { registerCvOptimizerRoutes } from './routes/cv-optimizer.js';
import { registerDreamCompanyRoutes } from './routes/dream-company.js';
import { registerOutreachRoutes } from './routes/outreach.js';
import { registerInterviewPrepRoutes } from './routes/interview-prep.js';
import { registerCvLibraryRoutes } from './routes/cv-library.js';
import { registerCoachAnswerRoutes } from './routes/coach-answer.js';

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

  await registerSystemRoutes(app);
  await registerCvOptimizerRoutes(app);
  await registerDreamCompanyRoutes(app);
  await registerOutreachRoutes(app);
  await registerInterviewPrepRoutes(app);
  await registerCvLibraryRoutes(app);
  await registerCoachAnswerRoutes(app);

  await app.listen({
    port,
    host: '0.0.0.0',
  });

  console.log(`Backend running at http://localhost:${port}/api`);
  console.log(`Health check: http://localhost:${port}/api/health`);
}

void bootstrap();

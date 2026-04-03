import cors from '@fastify/cors';
import Fastify from 'fastify';
import { registerSystemRoutes } from './routes/system';
import { registerCvOptimizerRoutes } from './routes/cv-optimizer';

async function bootstrap() {
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
  //await registerSomething(app); then come to /routes folder
  
  await app.listen({
    port,
    host: '0.0.0.0',
  });

  console.log(`Backend running at http://localhost:${port}/api`);
  console.log(`Health check: http://localhost:${port}/api/health`);
}

void bootstrap();

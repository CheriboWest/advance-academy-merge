import type { FastifyInstance } from 'fastify';
import { getHealth } from '../services/system.service.js';

export async function registerSystemRoutes(app: FastifyInstance) {
  app.get('/api/health', async () => getHealth());
}

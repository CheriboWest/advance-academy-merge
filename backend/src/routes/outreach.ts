import type { FastifyInstance } from 'fastify';
import { generateOutreach } from '../services/outreach.service.js';
import type { OutreachRequest } from '../types/outreach.js';

export async function registerOutreachRoutes(app: FastifyInstance) {
  app.post<{ Body: OutreachRequest }>('/api/outreach/generate', async (request, reply) => {
    const body = request.body;

    if (!body?.cvText || !body.targetCompany || !body.targetPersonName || !body.intent) {
      return reply.code(400).send({
        error:
          'Missing required fields: cvText, targetCompany, targetPersonName, intent',
      });
    }

    try {
      return await generateOutreach(body);
    } catch (error) {
      const statusCode = error && typeof error === 'object' && 'statusCode' in error ? Number((error as { statusCode?: number }).statusCode) : 500;
      if (statusCode === 503) {
        return reply.code(503).send({
          error: error instanceof Error ? error.message : 'LLM is not configured.',
        });
      }
      request.log.error(error);
      return reply.code(statusCode).send({ error: error instanceof Error ? error.message : 'Outreach generation failed' });
    }
  });

  await app.register(async (scoped) => {
    const multipart = await import('@fastify/multipart');
    await scoped.register(multipart.default, {
      limits: { fileSize: 15 * 1024 * 1024 }, // 15MB
    });

    scoped.post('/api/outreach/extract', async (request, reply) => {
      let data;
      try {
        data = await request.file();
      } catch {
        // Not multipart or no file
      }

      if (!data) {
        // Fallback to JSON check
        const body = request.body as { url?: string } | undefined;
        if (body && body.url) {
           try {
             const extService = await import('../services/outreach-extractor.service.js');
             const text = await extService.extractTextFromUrl(body.url);
             return { text };
           } catch (error: any) {
             const code = error.statusCode || 500;
             return reply.code(code).send({ error: error.message });
           }
        }
        return reply.code(400).send({ error: 'No File or URL provided' });
      }

      const fileName = (data.filename ?? '').toLowerCase();
      try {
        const buffer = await data.toBuffer();
        const extService = await import('../services/outreach-extractor.service.js');
        const text = await extService.extractTextFromFile(buffer, fileName);
        return { text };
      } catch (error: any) {
        const code = error.statusCode || 400;
        return reply.code(code).send({ error: error.message });
      }
    });
  });
}

import type { FastifyInstance } from 'fastify';
import { generateOutreach } from '../services/outreach.service.js';
import { runEnrichment } from '../services/outreach-enrichment.service.js';
import { validateJdUrl } from '../services/outreach-jd-validator.service.js';
import type { EnrichmentRequest, OutreachRequest } from '../types/outreach.js';
import { perUserDaily } from '../lib/rate-limit.js';

const RATE_1MIN = (max: number) => ({ config: { rateLimit: { max, timeWindow: '1 minute' } } });

export async function registerOutreachRoutes(app: FastifyInstance) {
  // Per-student daily cap on the paid endpoint; extract/enrich/validate stay on burst (sub-steps).
  app.post<{ Body: OutreachRequest }>('/api/outreach/generate', perUserDaily('DAILY_LIMIT_OUTREACH', 5, 'Outreach Generator'), async (request, reply) => {
    const body = request.body;

    if (!body?.cvText || !body.targetCompany || !body.targetRole || !body.intent || !body.outputs) {
      return reply.code(400).send({
        error: 'Missing required fields: cvText, targetCompany, targetRole, intent, outputs',
      });
    }

    if (!body.outputs.email && !body.outputs.linkedIn) {
      return reply.code(400).send({
        error: 'At least one output (email or linkedIn) must be enabled.',
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

  app.post<{ Body: EnrichmentRequest }>('/api/outreach/enrich', RATE_1MIN(15), async (request, reply) => {
    const body = request.body;

    if (!body?.companyName || !body.targetRole || !body.experienceLevel) {
      return reply.code(400).send({
        error: 'Missing required fields: companyName, targetRole, experienceLevel',
      });
    }

    try {
      return await runEnrichment(body);
    } catch (error) {
      const statusCode = error && typeof error === 'object' && 'statusCode' in error ? Number((error as { statusCode?: number }).statusCode) : 500;
      request.log.error(error);
      return reply.code(statusCode).send({
        error: error instanceof Error ? error.message : 'Enrichment failed',
      });
    }
  });

  app.post<{ Body: { url?: string } }>('/api/outreach/validate-jd', RATE_1MIN(20), async (request, reply) => {
    const body = request.body;

    if (!body?.url?.trim()) {
      return reply.code(400).send({ error: 'Missing required field: url' });
    }

    try {
      return await validateJdUrl(body.url.trim());
    } catch (error) {
      const statusCode = error && typeof error === 'object' && 'statusCode' in error ? Number((error as { statusCode?: number }).statusCode) : 500;
      request.log.error(error);
      return reply.code(statusCode).send({
        error: error instanceof Error ? error.message : 'JD validation failed',
      });
    }
  });

  await app.register(async (scoped) => {
    const multipart = await import('@fastify/multipart');
    await scoped.register(multipart.default, {
      limits: { fileSize: 15 * 1024 * 1024 }, // 15MB
    });

    scoped.post('/api/outreach/extract', RATE_1MIN(5), async (request, reply) => {
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

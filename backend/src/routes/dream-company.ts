import type { FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import {
  generateProfileAnalysis,
  generateTargetRoles,
  generateRoadmapWithJobs,
  parseDreamCompanyCv,
  validateDreamCompanyProfile,
} from '../services/dream-company.service.js';
import type { DreamCompanyInput, ProfileAnalysis, TargetRole } from '../types/dream-company.js';

function anthropicHttpStatus(error: unknown): number | undefined {
  if (error && typeof error === 'object' && 'status' in error) {
    const s = Number((error as { status?: number }).status);
    return Number.isFinite(s) ? s : undefined;
  }
  return undefined;
}

function handleServiceError(error: unknown, request: { log: { error: (e: unknown) => void } }, reply: { code: (n: number) => { send: (body: unknown) => unknown } }) {
  const step =
    error && typeof error === 'object' && 'step' in error
      ? String((error as { step: string }).step)
      : undefined;
  if (step) {
    return reply.code(500).send({ error: 'Failed to parse LLM response', step });
  }
  const statusCode =
    error && typeof error === 'object' && 'statusCode' in error
      ? Number((error as { statusCode?: number }).statusCode)
      : undefined;
  if (statusCode === 503) {
    return reply.code(503).send({
      error:
        error instanceof Error
          ? error.message
          : 'LLM is not configured (set LLM_API_KEY in backend/.env).',
    });
  }
  const http = anthropicHttpStatus(error);
  if (http === 401) {
    return reply.code(401).send({
      error: 'Anthropic API rejected the key (401). Check LLM_API_KEY in backend/.env.',
    });
  }
  if (http === 404) {
    return reply.code(502).send({
      error:
        'Anthropic returned 404 for the configured model. Set LLM_MODEL_DREAM_COMPANY to a model your account can use.',
    });
  }
  request.log.error(error);
  return reply.code(500).send({ error: 'Internal server error' });
}

export async function registerDreamCompanyRoutes(app: FastifyInstance) {
  // Step 1: Profile Analysis
  app.post<{ Body: { profile?: DreamCompanyInput } }>(
    '/api/dream-company/analyze',
    async (request, reply) => {
      const profile = request.body?.profile;
      const missing = validateDreamCompanyProfile(profile);
      if (missing.length > 0) {
        return reply.code(400).send({ error: 'Missing required fields', missing });
      }

      try {
        return await generateProfileAnalysis(profile!);
      } catch (error) {
        return handleServiceError(error, request, reply);
      }
    },
  );

  // Step 2: Roles + Exa Job Search
  app.post<{ Body: { profile?: DreamCompanyInput; analysis?: ProfileAnalysis } }>(
    '/api/dream-company/roles',
    async (request, reply) => {
      const { profile, analysis } = request.body ?? {};
      const missing = validateDreamCompanyProfile(profile);
      if (missing.length > 0) {
        return reply.code(400).send({ error: 'Missing required fields', missing });
      }
      if (!analysis) {
        return reply.code(400).send({ error: 'Missing analysis object' });
      }

      try {
        return await generateTargetRoles(profile!, analysis);
      } catch (error) {
        return handleServiceError(error, request, reply);
      }
    },
  );

  // Step 3: Exa Job Search + Roadmap (from selected roles)
  app.post<{ Body: { profile?: DreamCompanyInput; analysis?: ProfileAnalysis; selectedRoles?: TargetRole[] } }>(
    '/api/dream-company/roadmap',
    async (request, reply) => {
      const { profile, analysis, selectedRoles } = request.body ?? {};
      const missing = validateDreamCompanyProfile(profile);
      if (missing.length > 0) {
        return reply.code(400).send({ error: 'Missing required fields', missing });
      }
      if (!analysis) {
        return reply.code(400).send({ error: 'Missing analysis object' });
      }
      if (!selectedRoles || selectedRoles.length === 0) {
        return reply.code(400).send({ error: 'Select at least one role' });
      }

      try {
        return await generateRoadmapWithJobs(profile!, analysis, selectedRoles);
      } catch (error) {
        return handleServiceError(error, request, reply);
      }
    },
  );

  // CV Parsing
  await app.register(async (scoped) => {
    await scoped.register(multipart, {
      limits: { fileSize: 15 * 1024 * 1024 },
    });

    scoped.post('/api/dream-company/parse-cv', async (request, reply) => {
      let data;
      try {
        data = await request.file();
      } catch {
        return reply.code(400).send({ error: 'Invalid multipart upload' });
      }

      if (!data) {
        return reply.code(400).send({ error: 'No CV file provided' });
      }

      const fileName = (data.filename ?? '').toLowerCase();
      if (!fileName.endsWith('.pdf') && !fileName.endsWith('.docx')) {
        return reply.code(400).send({ error: 'Only PDF and DOCX files are supported' });
      }

      try {
        const buffer = await data.toBuffer();
        const parsed = await parseDreamCompanyCv(buffer, fileName);
        return parsed;
      } catch (error) {
        const statusCode =
          error && typeof error === 'object' && 'statusCode' in error
            ? Number((error as { statusCode?: number }).statusCode)
            : undefined;
        if (statusCode === 400 || statusCode === 422) {
          return reply.code(statusCode).send({
            error: error instanceof Error ? error.message : 'Parse failed',
          });
        }
        return handleServiceError(error, request, reply);
      }
    });
  });
}

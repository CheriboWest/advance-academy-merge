import type { FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import { APIConnectionTimeoutError } from '@anthropic-ai/sdk';
import {
  generateProfileAnalysis,
  generateTargetRoles,
  generateRoadmapWithJobs,
  parseDreamCompanyCv,
  validateDreamCompanyProfile,
  streamProfileAnalysis,
  streamTargetRoles,
  streamRoadmapWithJobs,
} from '../services/dream-company.service.js';
import type { DreamCompanyInput, ProfileAnalysis, TargetRole } from '../types/dream-company.js';
import { getJobMaxRoleQueries } from '../config/job-source.js';
import { perUserDaily } from '../lib/rate-limit.js';
import { assertCredits, spendCredits } from '../lib/credits.js';

// Reply 429 for an out-of-credits error; return true if it handled the error.
function replyIfOutOfCredits(
  error: unknown,
  reply: { code: (n: number) => { send: (body: unknown) => unknown } },
): boolean {
  const e = error as { statusCode?: number; code?: string; message?: string; scope?: string };
  if (Number(e?.statusCode) !== 429) return false;
  const message = e.message ?? 'You have no credits left.';
  reply.code(429).send({
    code: e.code ?? 'CREDIT_EXHAUSTED',
    message,
    error: message,
    scope: e.scope,
  });
  return true;
}

type FastifyReplyLike = {
  hijack: () => void;
  raw: import('node:http').ServerResponse;
};
type FastifyRequestLike = { log: { error: (e: unknown) => void } };

// Maps a service error to the SSE `error` event payload. Mirrors handleServiceError's HTTP
// codes, but since SSE has already sent 200 headers the semantic status travels in the body.
function toStreamError(error: unknown): { status: number; code: string; message: string } {
  const statusCode =
    error && typeof error === 'object' && 'statusCode' in error
      ? Number((error as { statusCode?: number }).statusCode)
      : undefined;
  if (statusCode === 502) {
    return { status: 502, code: 'LLM_TRUNCATED', message: error instanceof Error ? error.message : 'The AI response was cut off. Please try again.' };
  }
  if (error instanceof APIConnectionTimeoutError) {
    return { status: 504, code: 'TIMEOUT', message: 'The AI service took too long to respond. Please try again.' };
  }
  // Anthropic overload/capacity blip (429/529/503) that survived the retry backoff — friendly,
  // retryable message rather than a bare "Internal server error".
  const overloadStatus = anthropicHttpStatus(error);
  if (overloadStatus === 529 || overloadStatus === 503 || overloadStatus === 429) {
    return { status: 503, code: 'LLM_OVERLOADED', message: 'The AI service is briefly overloaded. Please try again in a moment.' };
  }
  if (statusCode === 503) {
    return { status: 503, code: 'LLM_NOT_CONFIGURED', message: error instanceof Error ? error.message : 'LLM is not configured.' };
  }
  if (error && typeof error === 'object' && 'step' in error) {
    return { status: 500, code: 'LLM_PARSE_FAILED', message: 'Failed to parse LLM response' };
  }
  return { status: 500, code: 'INTERNAL', message: 'Internal server error' };
}

// Runs an SSE response: emits `open`, streams `delta` text chunks, then `done` with the final
// result (or `error`). Keeps the connection alive with heartbeat comments and stops writing if
// the client disconnects.
async function runSse<T>(
  request: FastifyRequestLike,
  reply: FastifyReplyLike,
  produce: (onDelta: (text: string) => void) => Promise<T>,
) {
  reply.hijack();
  const raw = reply.raw;
  raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  let closed = false;
  raw.on('close', () => { closed = true; });
  const send = (event: string, data: unknown) => {
    if (!closed) raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const heartbeat = setInterval(() => { if (!closed) raw.write(': keepalive\n\n'); }, 15000);
  send('open', { ok: true });
  try {
    const result = await produce((text) => send('delta', { text }));
    send('done', result);
  } catch (err) {
    request.log.error(err);
    send('error', toStreamError(err));
  } finally {
    clearInterval(heartbeat);
    if (!closed) raw.end();
  }
}

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
  const statusCode =
    error && typeof error === 'object' && 'statusCode' in error
      ? Number((error as { statusCode?: number }).statusCode)
      : undefined;
  // Truncated LLM output (max_tokens) — retryable 502, not a bare 500. Checked before the
  // `step` branch because truncation errors also carry `step` for debugging.
  if (statusCode === 502) {
    return reply.code(502).send({
      error:
        error instanceof Error
          ? error.message
          : 'The AI response was cut off. Please try again.',
      ...(step ? { step } : {}),
    });
  }
  // SDK request exceeded its per-step timeout — controlled abort, not a hang. 504 + retry hint.
  if (error instanceof APIConnectionTimeoutError) {
    request.log.error(error);
    return reply.code(504).send({
      error: 'The AI service took too long to respond. Please try again.',
    });
  }
  if (step) {
    return reply.code(500).send({ error: 'Failed to parse LLM response', step });
  }
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
  // Overload/capacity blip (429/529/503) that survived the retry backoff — friendly, retryable.
  if (http === 529 || http === 503 || http === 429) {
    request.log.error(error);
    return reply.code(503).send({
      error: 'The AI service is briefly overloaded. Please try again in a moment.',
    });
  }
  request.log.error(error);
  return reply.code(500).send({ error: 'Internal server error' });
}

const RATE_1MIN = (max: number) => ({ config: { rateLimit: { max, timeWindow: '1 minute' } } });

// Per-student daily cap on the two credit-heavy steps (analyze + the job-search+roadmap step).
// `roles` stays on the cheap per-minute burst — it's part of the same run and light. Env:
// DAILY_LIMIT_DREAM_COMPANY (default 3).
// ponytail: @fastify/rate-limit counts per-route, so the JSON and /stream variant of each step
// have separate counters — the FE only calls /stream, so real usage is capped correctly; the
// raw-JSON path is a bounded defensive edge case. A shared store isn't worth it.
const DAILY_DREAM = () => perUserDaily('DAILY_LIMIT_DREAM_COMPANY', 3, 'Dream Company Finder');

export async function registerDreamCompanyRoutes(app: FastifyInstance) {
  // Step 1: Profile Analysis
  app.post<{ Body: { profile?: DreamCompanyInput } }>(
    '/api/dream-company/analyze',
    DAILY_DREAM(),
    async (request, reply) => {
      const profile = request.body?.profile;
      const missing = validateDreamCompanyProfile(profile);
      if (missing.length > 0) {
        return reply.code(400).send({ error: 'Missing required fields', missing });
      }

      try {
        // Credit wallet — charged once per run, at step 1 (no-op for admins).
        await assertCredits(request.userId, 'dream');
        const result = await generateProfileAnalysis(profile!);
        await spendCredits(request.userId, 'dream');
        return result;
      } catch (error) {
        if (replyIfOutOfCredits(error, reply)) return;
        return handleServiceError(error, request, reply);
      }
    },
  );

  // Step 2: Roles + Exa Job Search
  app.post<{ Body: { profile?: DreamCompanyInput; analysis?: ProfileAnalysis } }>(
    '/api/dream-company/roles',
    RATE_1MIN(10),
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

  // Config for the FE — single source of truth for the role-selection cap. The FE reads
  // this so changing JOB_MAX_ROLE_QUERIES on Railway updates the UI limit without a FE deploy.
  app.get('/api/dream-company/config', async () => {
    return { maxRoles: getJobMaxRoleQueries() };
  });

  // Step 3: Live Job Search + Roadmap (from selected roles)
  app.post<{ Body: { profile?: DreamCompanyInput; analysis?: ProfileAnalysis; selectedRoles?: TargetRole[] } }>(
    '/api/dream-company/roadmap',
    DAILY_DREAM(),
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

  // ---- Streaming (SSE) variants (M2.1) — same inputs/validation as the JSON routes above,
  // but stream text deltas and finish with a `done` event carrying the parsed result. ----
  app.post<{ Body: { profile?: DreamCompanyInput } }>(
    '/api/dream-company/analyze/stream',
    DAILY_DREAM(),
    async (request, reply) => {
      const profile = request.body?.profile;
      const missing = validateDreamCompanyProfile(profile);
      if (missing.length > 0) {
        return reply.code(400).send({ error: 'Missing required fields', missing });
      }
      // Credits must be checked BEFORE the stream opens (can't 429 mid-SSE).
      try {
        await assertCredits(request.userId, 'dream');
      } catch (error) {
        if (replyIfOutOfCredits(error, reply)) return;
        return handleServiceError(error, request, reply);
      }
      await runSse(request, reply, (onDelta) => streamProfileAnalysis(profile!, onDelta));
      await spendCredits(request.userId, 'dream');
    },
  );

  app.post<{ Body: { profile?: DreamCompanyInput; analysis?: ProfileAnalysis } }>(
    '/api/dream-company/roles/stream',
    RATE_1MIN(10),
    async (request, reply) => {
      const { profile, analysis } = request.body ?? {};
      const missing = validateDreamCompanyProfile(profile);
      if (missing.length > 0) {
        return reply.code(400).send({ error: 'Missing required fields', missing });
      }
      if (!analysis) {
        return reply.code(400).send({ error: 'Missing analysis object' });
      }
      await runSse(request, reply, (onDelta) => streamTargetRoles(profile!, analysis, onDelta));
    },
  );

  app.post<{ Body: { profile?: DreamCompanyInput; analysis?: ProfileAnalysis; selectedRoles?: TargetRole[] } }>(
    '/api/dream-company/roadmap/stream',
    DAILY_DREAM(),
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
      await runSse(request, reply, (onDelta) => streamRoadmapWithJobs(profile!, analysis, selectedRoles, onDelta));
    },
  );

  // CV Parsing
  await app.register(async (scoped) => {
    await scoped.register(multipart, {
      limits: { fileSize: 15 * 1024 * 1024 },
    });

    scoped.post('/api/dream-company/parse-cv', RATE_1MIN(5), async (request, reply) => {
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

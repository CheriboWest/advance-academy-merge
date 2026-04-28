import type { FastifyInstance } from 'fastify';
import {
  activateCvVersion,
  addArtifactToGap,
  backfillEmbeddings,
  deleteCvVersion,
  finalizeCvBullets,
  findSimilarBullets,
  getBulletsWithGapsByIds,
  getCvVersion,
  listBulletsWithGaps,
  listCvVersions,
  mergeBullets,
  parseCvVersion,
  parseCvVersionFromFile,
  recordJitClarification,
  skipGap,
  updateArtifactText,
} from '../services/cv-knowledge.service.js';
import type { BulletResolution, ParsedBulletWithCandidates } from '../types/cv-knowledge.js';

function statusOf(error: unknown): number {
  if (error && typeof error === 'object' && 'statusCode' in error) {
    return Number((error as { statusCode?: number }).statusCode) || 500;
  }
  return 500;
}

function sendError(reply: any, error: unknown) {
  const code = statusOf(error);
  const message = error instanceof Error ? error.message : 'Internal error';
  return reply.code(code).send({ error: message });
}

export async function registerCvLibraryRoutes(app: FastifyInstance) {
  app.get('/api/cv-library/versions', async (request, reply) => {
    try {
      return await listCvVersions(request.userId);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.post<{ Body: { id: string } }>('/api/cv-library/versions/:id/activate', async (request, reply) => {
    const id = (request.params as { id: string }).id;
    try {
      await activateCvVersion(id, request.userId);
      return { ok: true };
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.get('/api/cv-library/versions/:id', async (request, reply) => {
    const id = (request.params as { id: string }).id;
    try {
      const row = await getCvVersion(id, request.userId);
      if (!row) return reply.code(404).send({ error: 'Not found' });
      return {
        id: row.id,
        name: row.name,
        rawText: row.raw_text,
        detectedField: row.detected_field,
        isActive: row.is_active,
      };
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.delete('/api/cv-library/versions/:id', async (request, reply) => {
    const id = (request.params as { id: string }).id;
    try {
      await deleteCvVersion(id, request.userId);
      return { ok: true };
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.get('/api/cv-library/versions/:id/bullets', async (request, reply) => {
    const id = (request.params as { id: string }).id;
    try {
      return await listBulletsWithGaps(id);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  // ── Finalize: Phase 2 of two-phase upload ─────────────────────────────────
  app.post('/api/cv-library/versions/:id/finalize', async (request, reply) => {
    const cvVersionId = (request.params as { id: string }).id;
    const body = request.body as {
      parsedBullets?: ParsedBulletWithCandidates[];
      resolutions?: BulletResolution[];
    } | undefined;
    if (!body?.parsedBullets || !body?.resolutions) {
      return reply.code(400).send({ error: 'parsedBullets and resolutions required' });
    }
    try {
      return await finalizeCvBullets(request.userId, cvVersionId, body.parsedBullets, body.resolutions);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  // ── Single bullet's gaps + RAW artifacts ──────────────────────────────────
  // Used by the coach-answer preview UI when the user adds a bullet from the
  // picker that wasn't in the auto-selected set.
  app.get<{ Params: { id: string } }>('/api/cv-library/bullets/:id/details', async (request, reply) => {
    const bulletId = request.params.id;
    try {
      const rows = await getBulletsWithGapsByIds(request.userId, [bulletId]);
      if (rows.length === 0) return reply.code(404).send({ error: 'Bullet not found' });
      return rows[0];
    } catch (err) {
      return sendError(reply, err);
    }
  });

  // ── Similar bullets for a given bullet ────────────────────────────────────
  // Returns up to 5 OTHER bullets above the merge similarity threshold,
  // ordered by similarity descending. Anything below threshold is filtered
  // server-side in match_bullets, so the response can have fewer than 5
  // entries (or be empty) when the user has no closely-related bullets.
  app.post('/api/cv-library/bullets/:id/similar', async (request, reply) => {
    const bulletId = (request.params as { id: string }).id;
    try {
      const supabase = (await import('../lib/supabase.js')).getSupabase();
      const { data: bullet } = await supabase
        .from('cv_bullets')
        .select('bullet_text, user_id')
        .eq('id', bulletId)
        .single();
      if (!bullet) return reply.code(404).send({ error: 'Bullet not found' });
      // Fetch 6: the bullet itself always self-matches at similarity=1 and
      // takes one slot, so we need an extra to guarantee up to 5 OTHER bullets
      // when enough exist above threshold.
      const candidates = await findSimilarBullets(bullet.user_id, bullet.bullet_text, 6);
      return candidates.filter((c) => c.bulletId !== bulletId).slice(0, 5);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  // ── Merge two bullets ─────────────────────────────────────────────────────
  app.post<{ Body: { sourceBulletId: string; targetBulletId: string } }>(
    '/api/cv-library/bullets/merge',
    async (request, reply) => {
      const body = request.body;
      if (!body?.sourceBulletId || !body?.targetBulletId) {
        return reply.code(400).send({ error: 'sourceBulletId and targetBulletId required' });
      }
      try {
        await mergeBullets(body.sourceBulletId, body.targetBulletId, request.userId);
        return { ok: true };
      } catch (err) {
        return sendError(reply, err);
      }
    },
  );

  // ── Backfill embeddings ───────────────────────────────────────────────────
  app.post('/api/cv-library/backfill-embeddings', async (_request, reply) => {
    try {
      return await backfillEmbeddings();
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.post<{ Params: { gapId: string } }>('/api/cv-library/gaps/:gapId/skip', async (request, reply) => {
    try {
      await skipGap(request.params.gapId);
      return { ok: true };
    } catch (err) {
      return sendError(reply, err);
    }
  });

  // Edit an existing artifact's text (re-summarises)
  app.patch<{ Params: { artifactId: string }; Body: { text?: string } }>(
    '/api/cv-library/artifacts/:artifactId',
    async (request, reply) => {
      const text = request.body?.text;
      if (typeof text !== 'string' || !text.trim()) {
        return reply.code(400).send({ error: 'text is required' });
      }
      try {
        await updateArtifactText(request.params.artifactId, text);
        return { ok: true };
      } catch (err) {
        return sendError(reply, err);
      }
    },
  );

  app.post<{ Body: { bulletId: string | null; question: string; answer: string } }>(
    '/api/cv-library/jit-clarification',
    async (request, reply) => {
      const body = request.body;
      if (!body?.question || !body?.answer) {
        return reply.code(400).send({ error: 'question and answer required' });
      }
      try {
        await recordJitClarification({
          bulletId: body.bulletId ?? null,
          question: body.question,
          answer: body.answer,
        });
        return { ok: true };
      } catch (err) {
        return sendError(reply, err);
      }
    },
  );

  // Multipart routes (file upload, file/text/url artifact intake)
  await app.register(async (scoped) => {
    const multipart = await import('@fastify/multipart');
    await scoped.register(multipart.default, {
      limits: { fileSize: 15 * 1024 * 1024 },
    });

    // Phase 1: Parse CV → return bullets + similarity candidates
    scoped.post('/api/cv-library/versions', async (request, reply) => {
      const ctype = request.headers['content-type'] ?? '';
      try {
        if (ctype.includes('multipart/form-data')) {
          let name = '';
          let fileBuffer: Buffer | null = null;
          let fileName = '';
          const parts = request.parts();
          for await (const part of parts) {
            if (part.type === 'file') {
              fileBuffer = await part.toBuffer();
              fileName = part.filename;
            } else if (part.fieldname === 'name' && typeof part.value === 'string') {
              name = part.value;
            }
          }
          if (!fileBuffer || !fileName) {
            return reply.code(400).send({ error: 'file is required' });
          }
          if (!name.trim()) {
            return reply.code(400).send({ error: 'name is required' });
          }
          return await parseCvVersionFromFile(name.trim(), fileBuffer, fileName, request.userId);
        }
        const body = request.body as { name?: string; rawText?: string } | undefined;
        if (!body?.name || !body?.rawText) {
          return reply.code(400).send({ error: 'name and rawText required' });
        }
        return await parseCvVersion({ name: body.name.trim(), rawText: body.rawText, userId: request.userId });
      } catch (err) {
        return sendError(reply, err);
      }
    });

    // Add an artifact to a gap (text only — file/url removed)
    scoped.post<{ Params: { gapId: string } }>(
      '/api/cv-library/gaps/:gapId/artifacts',
      async (request, reply) => {
        const gapId = request.params.gapId;
        try {
          const body = request.body as { text?: string } | undefined;
          const text = body?.text?.trim();
          if (!text) {
            return reply.code(400).send({ error: 'text is required' });
          }
          await addArtifactToGap(gapId, { sourceType: 'text', text });
          return { ok: true };
        } catch (err) {
          return sendError(reply, err);
        }
      },
    );
  });
}

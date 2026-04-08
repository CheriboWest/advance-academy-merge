import type { FastifyInstance } from 'fastify';
import {
  activateCvVersion,
  addArtifactToGap,
  createCvVersionFromFile,
  createCvVersionFromText,
  deleteCvVersion,
  listBulletsWithGaps,
  listCvVersions,
  recordJitClarification,
  skipGap,
} from '../services/cv-knowledge.service.js';

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
  app.get('/api/cv-library/versions', async (_request, reply) => {
    try {
      return await listCvVersions();
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.post<{ Body: { id: string } }>('/api/cv-library/versions/:id/activate', async (request, reply) => {
    const id = (request.params as { id: string }).id;
    try {
      await activateCvVersion(id);
      return { ok: true };
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.delete('/api/cv-library/versions/:id', async (request, reply) => {
    const id = (request.params as { id: string }).id;
    try {
      await deleteCvVersion(id);
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

  app.post<{ Params: { gapId: string } }>('/api/cv-library/gaps/:gapId/skip', async (request, reply) => {
    try {
      await skipGap(request.params.gapId);
      return { ok: true };
    } catch (err) {
      return sendError(reply, err);
    }
  });

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

    // Create a CV version (multipart with file + name field, OR JSON with text)
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
          const result = await createCvVersionFromFile(name.trim(), fileBuffer, fileName);
          return result;
        }
        // JSON path: { name, rawText }
        const body = request.body as { name?: string; rawText?: string } | undefined;
        if (!body?.name || !body?.rawText) {
          return reply.code(400).send({ error: 'name and rawText required' });
        }
        return await createCvVersionFromText({ name: body.name.trim(), rawText: body.rawText });
      } catch (err) {
        return sendError(reply, err);
      }
    });

    // Add an artifact to a gap (multipart file OR JSON {text} or {url})
    scoped.post<{ Params: { gapId: string } }>(
      '/api/cv-library/gaps/:gapId/artifacts',
      async (request, reply) => {
        const gapId = request.params.gapId;
        const ctype = request.headers['content-type'] ?? '';
        try {
          if (ctype.includes('multipart/form-data')) {
            let fileBuffer: Buffer | null = null;
            let fileName = '';
            let textValue = '';
            let urlValue = '';
            for await (const part of request.parts()) {
              if (part.type === 'file') {
                fileBuffer = await part.toBuffer();
                fileName = part.filename;
              } else if (part.fieldname === 'text' && typeof part.value === 'string') {
                textValue = part.value;
              } else if (part.fieldname === 'url' && typeof part.value === 'string') {
                urlValue = part.value;
              }
            }
            if (fileBuffer) {
              await addArtifactToGap(gapId, { sourceType: 'file', buffer: fileBuffer, fileName });
            } else if (urlValue.trim()) {
              await addArtifactToGap(gapId, { sourceType: 'url', url: urlValue.trim() });
            } else if (textValue.trim()) {
              await addArtifactToGap(gapId, { sourceType: 'text', text: textValue.trim() });
            } else {
              return reply.code(400).send({ error: 'Provide file, url, or text' });
            }
            return { ok: true };
          }
          const body = request.body as { text?: string; url?: string } | undefined;
          if (body?.url?.trim()) {
            await addArtifactToGap(gapId, { sourceType: 'url', url: body.url.trim() });
          } else if (body?.text?.trim()) {
            await addArtifactToGap(gapId, { sourceType: 'text', text: body.text.trim() });
          } else {
            return reply.code(400).send({ error: 'Provide url or text' });
          }
          return { ok: true };
        } catch (err) {
          return sendError(reply, err);
        }
      },
    );
  });
}

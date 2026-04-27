# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Run from the repo root (npm workspaces; `backend` is a workspace):

- `npm run dev:frontend` — Next.js dev server (port 3000)
- `npm run dev:backend` — Fastify dev server with `tsx watch` (port 4000)
- `npm run dev:all` — both concurrently
- `npm run build:all` — `next build` then backend `tsc -p tsconfig.build.json`
- `npm run lint` — ESLint over the whole repo
- `npm run typecheck --workspace backend` — backend type check only (uses `tsconfig.json`, so it includes `scripts/` and other files the build excludes via `tsconfig.build.json`)
- `npx tsc --noEmit` (from repo root) — frontend type check
- `npm run usage --workspace backend` (also `usage:week`, `usage:month`) — LLM cost report from `cost-log.jsonl`, written by `backend/src/lib/cost-tracker.ts`

There is no test runner configured. Env: copy `.env.local.example` → `.env.local` (frontend, mainly `BACKEND_URL`) and `backend/.env.example` → `backend/.env`. Required backend vars: `LLM_API_KEY`, `FRONTEND_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. Feature-specific keys: `GROQ_API_KEY` (Interview Prep voice transcription via Groq Whisper), `JINA_API_KEY` (Outreach + CV Library URL fetching), `EXA_API_KEY` (Outreach search via `lib/exa-client.ts`), `VOYAGE_API_KEY` (embeddings via `lib/voyage.ts`). Optional overrides: `LLM_TIMEOUT_MS`, per-feature LLM keys (`LLM_API_KEY_OUTREACH` covers Dream Company + Outreach, `LLM_API_KEY_CV` for CV Optimizer, `LLM_API_KEY_INTERVIEW` for Interview Prep + CV Library), and per-feature model overrides `LLM_MODEL_DEFAULT` / `LLM_MODEL_CV_OPTIMIZER` / `LLM_MODEL_OUTREACH` / `LLM_MODEL_DREAM_COMPANY` / `LLM_MODEL_INTERVIEW_PREP` (see `backend/src/config/llm.ts`).

## Architecture

Career-tools web app with five AI features (CV Optimizer, Dream Company Finder, Outreach Generator, Interview Prep, CV Library), all powered by Anthropic Claude. The Outreach Generator and CV Library extractors also use Jina Reader for URL fetching, Exa for web search, and Voyage for embeddings. **Persistence:** Supabase Postgres backs Interview Prep (sessions, assessments, coaching) and the CV Library (versions, bullets, gaps, artifacts, coach answers); the other features remain stateless request/response. **Auth:** Supabase bearer-token auth (see Authentication below). See `docs/ARCHITECTURE.md` for the canonical reference and diagrams; `docs/BACKEND.md`, `docs/FRONTEND.md`, `docs/ADD_A_FEATURE.md`, `docs/CV_KNOWLEDGE_BASE.md`, `docs/COACH_ANSWER_FLOW.md`, `docs/CV_LIBRARY_UPLOAD_FLOW.md`, `docs/PERF_BATCHED_QUERIES.md`, `docs/INTERVIEW_PREP_WORKFLOW.md`, and `docs/CONVENTIONS.md` are also authoritative.

### The 4-layer request flow

Every feature follows the same shape — replicate it when adding new ones:

```
UI (features/*/components)
  → hook (features/*/hooks)
  → frontend client (features/*/api/frontend-client.ts)
  → Next.js proxy route (app/api/*/route.ts)
  → backend client (shared/api/backend-client.ts)
  → Fastify route (backend/src/routes)
  → service (backend/src/services)
  → Anthropic SDK
```

### Why the Next.js proxy layer exists

`app/api/*/route.ts` is not optional plumbing — it does three jobs:
1. Keeps `BACKEND_URL` server-only (read via `shared/env/server.ts`).
2. Validates request bodies with type guards before forwarding to Fastify.
3. Catches `HttpClientError` from `shared/api/http-client.ts` and normalizes it to `ApiErrorResponse` (`{ code, message }` from `@advance-academy/contracts`).

### Loading bars for unknowable-duration actions

User-triggered actions whose total time can't be predicted (LLM calls, multi-step pipelines) use the shared `useFakeProgress` hook + `<ProgressBar>` in `shared/hooks/`. The hook drives an asymptotic curve `ceiling * (1 - exp(-t / tauMs))` that plateaus near 92% until the real response lands, then snaps to 100%. Pick `tauMs` to match the typical "feels half done" point. Currently used in CV upload (`tau=12s`), CV finalise (adaptive: ~4s × new-bullet-count), Coach Understanding (`tau=15s`), and Interview Prep extract-from-URL (`tau=8s`). Don't roll new spinners for these flows — extend the existing hook instead.

### Backend layout

- `backend/src/main.ts` — entry, CORS reads `FRONTEND_URL` (comma-split for multiple origins); also kicks off `startCvAnalysisReaper()` (sweeps stuck CV-analysis jobs from `lib/cv-analysis-reaper.ts`). Env loading is path-flexible: tries `./.env` then `./backend/.env` (`main.ts:24-36`), so the backend boots from either repo root or the `backend/` workspace.
- `backend/src/routes/` — thin HTTP handlers; inspect thrown `Error.statusCode`/`step` and map to HTTP codes (`routes/dream-company.ts` is the canonical pattern). CV Library coach flow is split across `routes/coach-answer.ts` (answering gap questions) and `routes/coach-understanding.ts` (the understanding-report sibling) — see `docs/COACH_ANSWER_FLOW.md` for how they fit together.
- **Two interview routes**: `routes/interview.ts` owns the live interview turn loop (`/api/interview`, `/api/evaluate`); `routes/interview-prep.ts` owns the prep-session lifecycle (sessions, assessments, coaching). New endpoints go in whichever matches the surface — don't merge them.
- `backend/src/services/` — business logic + LLM calls. Outreach has the most fan-out: `outreach.service.ts` is the orchestrator and delegates to `outreach-extractor`, `outreach-enrichment`, `outreach-jd-validator`, and `outreach-rerank` — when touching outreach, find the right sub-service first.
- `backend/src/lib/` — prompts, Anthropic SDK helpers, plus integration clients: `voyage.ts` (embeddings), `exa-client.ts` (web search), `cost-tracker.ts` (LLM cost logging to `cost-log.jsonl`)
- `backend/src/config/llm.ts` — feature → model + API key mapping (per-feature env overrides)

### Shared contracts

Types and error shapes shared between frontend and backend live in `packages/contracts` (`@advance-academy/contracts`, a workspace package). Use it for any cross-layer type.

### Persistence

- **Interview Prep + CV Library** persist to Supabase via `backend/src/lib/supabase.ts` (`getSupabase()`, `getMvpUserId()`). Migrations live in `supabase/migrations/`. See `docs/CV_KNOWLEDGE_BASE.md` for the schema and the coach-answer / JIT-clarification flow.
- **CV Optimizer** uses an async job pattern: `POST /api/cv-optimizer/analyze` returns `202 + jobId`; the client polls `GET /api/cv-optimizer/jobs/:jobId`. Jobs are persisted to the Supabase `cv_analysis_jobs` table via `createCvAnalysisJob` / `getCvAnalysisJob` in `backend/src/services/cv-optimizer.service.ts`, so polls are safe across multiple backend instances.

### CV Library design notes

- **No blob storage anywhere.** Gap artifact intake is text-only — `POST /api/cv-library/gaps/:gapId/artifacts` accepts `{ text }` only, the file and URL options were intentionally removed. Historical rows with `source_type` of `'file'` or `'url'` are read-only; do not reintroduce write paths or a Supabase Storage bucket. CV upload still accepts PDF/DOCX but only stores extracted text + the original filename in `cv_versions.source_file_path` (it's metadata, not a blob path). The same stance is why `extractTextFromUrl` is no longer imported from `cv-knowledge.service` even though the helper still exists for outreach.
- **Artifact edits re-summarise.** `PATCH /api/cv-library/artifacts/:artifactId` updates `content_text` and re-runs the LLM summariser so `summary_json` stays consistent with the raw text. Both `addArtifactToGap` and `updateArtifactText` go through the shared `summarizeArtifactText(rawText, gapQuestion)` helper in `cv-knowledge.service.ts` — keep them aligned if you change one.

### Interview-prep refactor note

Earlier versions kept interview-prep LLM + DB calls inside Next.js route handlers (`app/api/interview/route.ts`, `app/api/evaluate/route.ts`, `app/api/interview/sessions/*`). These have been moved to Fastify (`backend/src/routes/interview.ts` + `backend/src/services/interview.service.ts`). The `app/api/interview/*` and `app/api/evaluate/*` files are now thin proxies. Any new interview-prep work goes in the backend.

### Interview-prep prompt caching

`startInterviewSession` and `sendInterviewMessage` in `backend/src/services/interview.service.ts` use Anthropic prompt caching (1-hour TTL) on two breakpoints: (1) the system block holding `persona.systemPrompt + buildContextPreamble(JD + CV)` (~3500–5700 tokens — the static prefix that's identical across all turns of one session); and (2) the last assistant message in the conversation (multi-turn caching, so the growing history caches turn-over-turn). The `[IMPORTANT: This is the final exchange]` addendum is intentionally placed in a **separate, uncached** system text block — keep it that way, otherwise concatenating it into the cached prefix invalidates the cache on the final turn. Both calls log `[interview-prep:start]` / `[interview-prep:turn]` lines with `cache_read` / `cache_write` token counts so you can verify hits in dev. `scoreAnswer` (irs-scoring.ts) and `generateFeedbackReport` (feedback-engine.service.ts) are intentionally **not** cached — see `docs/INTERVIEW_PREP_WORKFLOW.md` for the full rationale, the Sonnet 4.0 caching constraints (1024-token min prefix, 4-breakpoint cap, 20-block lookback), and the silent-invalidator audit checklist.

### Timeouts (know these before debugging hangs)

- Frontend `fetchJson`: 15s; `fetchFormDataJson`: 120s (`shared/api/http-client.ts`)
- Backend client per-feature: 10–120s (`shared/api/backend-client.ts`) — Dream Company is 120s because it runs 4 sequential LLM calls
- LLM HTTP call: 30s default, override with `LLM_TIMEOUT_MS`

### Authentication

Supabase-based bearer-token auth is enforced on the backend. A Fastify `preHandler` hook in `backend/src/main.ts` rejects any request without an `Authorization: Bearer <token>` header, validates the token via `getUserIdFromToken()` in `backend/src/lib/supabase.ts` (which calls `supabase.auth.getUser()`), and attaches `request.userId` for routes/services to use. Only `/api/health` and `/api/system` are exempt.

The Next.js proxy layer pulls the user's token with `getProxyAuthToken()` and forwards it through `shared/api/backend-client.ts`, which sets the `Authorization` header when a token is present. Frontend calls that need auth must thread the token through the proxy — see the recent fixes in commits `e72a65f`, `f776727`, `a4f46ca` for the canonical wiring.

A second auth layer lives at the Next.js edge: `middleware.ts` in the repo root checks every non-`/api`, non-public route for an `aa-session` cookie and redirects to `/login` if missing. This gates page navigation only — it intentionally excludes `/api/*` so the proxy routes can run their own bearer-token forwarding. Public paths are `/login` and `/register`.

`getMvpUserId()` still exists in `backend/src/lib/supabase.ts` but is dead code — do not reach for it; use `request.userId` from the auth hook instead.

### Rate limiting

`@fastify/rate-limit` is registered globally with `global: false` (opt-in per route) in `backend/src/main.ts`, keyed by client IP, returning `{ code: 'RATE_LIMIT_EXCEEDED', message }` on 429. Current per-route caps:

- CV Optimizer `/analyze`: 5 / 10 minutes (`backend/src/routes/cv-optimizer.ts`)
- Dream Company: 10 / minute via a `RATE_1MIN()` helper (`backend/src/routes/dream-company.ts`)
- Outreach: 5–20 / minute depending on endpoint (`backend/src/routes/outreach.ts`)

When adding a new route that hits an LLM, opt it in with a `config.rateLimit` block.

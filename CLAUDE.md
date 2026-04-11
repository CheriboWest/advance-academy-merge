# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Run from the repo root (npm workspaces; `backend` is a workspace):

- `npm run dev:frontend` — Next.js dev server (port 3000)
- `npm run dev:backend` — Fastify dev server with `tsx watch` (port 4000)
- `npm run dev:all` — both concurrently
- `npm run build:all` — `next build` then backend `tsc -p tsconfig.build.json`
- `npm run lint` — ESLint over the whole repo
- `npm run typecheck --workspace backend` — backend type check only
- `npx tsc --noEmit` (from repo root) — frontend type check

There is no test runner configured. Env: copy `.env.local.example` → `.env.local` (frontend, mainly `BACKEND_URL`) and `backend/.env.example` → `backend/.env` (`LLM_API_KEY`, `FRONTEND_URL`, optional `LLM_TIMEOUT_MS`, plus `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` for the interview-prep + CV Library features that persist data, and `GROQ_API_KEY` for Interview Prep voice-mode transcription via Groq Whisper).

## Architecture

Career-tools web app with five AI features (CV Optimizer, Dream Company Finder, Outreach Generator, Interview Prep, CV Library), all powered by Anthropic Claude. The Outreach Generator and CV Library extractors also use Jina Reader for URL fetching. **Persistence:** Supabase Postgres backs Interview Prep (sessions, assessments, coaching) and the CV Library (versions, bullets, gaps, artifacts); the other features remain stateless request/response. **Auth:** there is no auth — all data belongs to a hardcoded `MVP_USER_ID`. See `docs/ARCHITECTURE.md` for the canonical reference and diagrams; `docs/BACKEND.md`, `docs/FRONTEND.md`, `docs/ADD_A_FEATURE.md`, `docs/CV_KNOWLEDGE_BASE.md`, and `docs/CONVENTIONS.md` are also authoritative.

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

### Backend layout

- `backend/src/main.ts` — entry, CORS reads `FRONTEND_URL` (comma-split for multiple origins)
- `backend/src/routes/` — thin HTTP handlers; inspect thrown `Error.statusCode`/`step` and map to HTTP codes (`routes/dream-company.ts` is the canonical pattern)
- `backend/src/services/` — business logic + LLM calls
- `backend/src/lib/` — prompts and Anthropic SDK helpers
- `backend/src/config/llm.ts` — feature → model mapping

### Shared contracts

Types and error shapes shared between frontend and backend live in `packages/contracts` (`@advance-academy/contracts`, a workspace package). Use it for any cross-layer type.

### Persistence

- **Interview Prep + CV Library** persist to Supabase via `backend/src/lib/supabase.ts` (`getSupabase()`, `getMvpUserId()`). Migrations live in `supabase/migrations/`. See `docs/CV_KNOWLEDGE_BASE.md` for the schema and the coach-answer / JIT-clarification flow.
- **CV Optimizer** has its own in-memory job pattern: `POST /api/cv-optimizer/analyze` returns `202 + jobId`; the client polls `GET /api/cv-optimizer/jobs/:jobId`. The job map is an **in-memory `Map` in the backend process** — sticky to a single instance. Multi-instance deploys behind a load balancer will return "not found" on polls that land on a different instance. Use sticky sessions or stay single-instance.

### Interview-prep refactor note

Earlier versions kept interview-prep LLM + DB calls inside Next.js route handlers (`app/api/interview/route.ts`, `app/api/evaluate/route.ts`, `app/api/interview/sessions/*`). These have been moved to Fastify (`backend/src/routes/interview.ts` + `backend/src/services/interview.service.ts`). The `app/api/interview/*` and `app/api/evaluate/*` files are now thin proxies. Any new interview-prep work goes in the backend.

### Timeouts (know these before debugging hangs)

- Frontend `fetchJson`: 15s; `fetchFormDataJson`: 120s (`shared/api/http-client.ts`)
- Backend client per-feature: 10–120s (`shared/api/backend-client.ts`) — Dream Company is 120s because it runs 4 sequential LLM calls
- LLM HTTP call: 30s default, override with `LLM_TIMEOUT_MS`

### Authentication

There is none. Every endpoint is public. CV Library and Interview Prep use a hardcoded `MVP_USER_ID` (set in `backend/.env`, defaults to the all-zeros UUID). Do not add real auth without a product decision; the right place would be middleware in `backend/src/main.ts` plus a hook in `shared/api/backend-client.ts`.

# Backend Structure

This backend uses `Fastify + TypeScript`.

## Command to check
npm run dev:backend
test the api http://localhost:4000/api/health and see if the "status" is "ok"

## LLM Config

Backend reads LLM settings from `backend/.env`.

```text
LLM_PROVIDER=anthropic
LLM_BASE_URL=https://api.anthropic.com/v1
LLM_API_KEY=your_api_key
LLM_ANTHROPIC_API_VERSION=2023-06-01
LLM_TIMEOUT_MS=30000
LLM_MODEL_DEFAULT=claude-sonnet-4-20250514
LLM_MODEL_CV_OPTIMIZER=claude-sonnet-4-20250514
LLM_MODEL_OUTREACH=claude-sonnet-4-20250514
LLM_MODEL_DREAM_COMPANY=claude-sonnet-4-20250514
LLM_MODEL_INTERVIEW_PREP=claude-sonnet-4-20250514
```

Current behavior:

- `cv-optimizer` uses the configured LLM if `LLM_API_KEY` is present; otherwise it falls back to local heuristic analysis
- `dream-company` (`/api/dream-company/generate`, `/api/dream-company/parse-cv`) and `outreach` (`/api/outreach/generate`) run on the backend and require `LLM_API_KEY` (and optional `LLM_MODEL_*` overrides)
- The Next.js app proxies these paths to `BACKEND_URL` (same pattern as CV optimizer)

## Folder Layout

```text
backend/
  src/
    main.ts
    routes/
      system.ts
      cv-optimizer.ts
      dream-company.ts
      outreach.ts
    services/
      system.service.ts
      cv-optimizer.service.ts
      dream-company.service.ts
    lib/
      llm-anthropic.ts
      dream-company/prompts.ts
      outreach/*.ts
    types/
      dream-company.ts
      outreach.ts
```
## How To Add A New Feature

For a feature like `auth`, `users`, or `courses`, usually add:

```text
src/
  routes/
    auth.ts
  services/
    auth.service.ts
  types/
    auth.ts
```

Then register it in `src/main.ts` --> define endpoints in `src/routes` + simple handle request/response --> Write logic as functions in `src/services` (folder `src/types` is optional for define type of reponse and request)

## What Each Folder Does

`src/main.ts`

- Starts the Fastify server
- Registers plugins like CORS
- Registers route groups

`src/routes/`

- Contains HTTP route handlers
- Reads request body, params, query, and headers
- Sets HTTP status codes when needed
- Calls service functions to do the real work

`src/services/`

- Contains business logic
- Does calculations and data transformation
- Place for database calls or AI calls

`src/config/`

- Contains shared runtime config such as LLM provider and per-feature model selection

`src/types/`
- Contains TypeScript types and interfaces
- Defines the shape of request or response data

## Current Route Files

`routes/system.ts`
- Handles general backend routes
- `GET /api/health`

## Current Service Files

`services/system.service.ts`
- Returns the health-check response

`services/cv-optimizer.service.ts`
- Analyzes a CV via LLM when configured
- Falls back to local scoring logic when no LLM is available

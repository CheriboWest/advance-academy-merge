# Conventions

The rules every PR in this repo is expected to follow. When in doubt, look at how Dream Company, Outreach, and CV Optimizer already do it.

## File naming

- **Files** — `kebab-case.ts[x]`. Examples: `dream-company-screen.tsx`, `use-dream-company.ts`, `backend-client.ts`.
- **Exports** — `PascalCase` for components and types, `camelCase` for functions and variables.
- **Folders** — `kebab-case`. Feature folders: `features/dream-company/`, not `features/DreamCompany/`.
- **Test files** (when added) — colocated, `{filename}.test.ts[x]`.

## Import aliases

Always use the `@/*` alias configured in `tsconfig.json`. Never use `../../../` relative imports.

```ts
// ✅ Good
import { fetchJson } from '@/shared/api/http-client'
import type { DreamCompanyInput } from '@/types/dream-company'

// ❌ Bad
import { fetchJson } from '../../shared/api/http-client'
```

## Backend layering rules

The backend has three layers with one rule each:

| Layer | Folder | Rule |
|---|---|---|
| Routes | `backend/src/routes/` | Thin. Parse request, call one service, map errors. No business logic. |
| Services | `backend/src/services/` | All business logic. Return plain objects. Throw errors with `statusCode`/`step`. **Do not import `fastify`.** |
| Lib | `backend/src/lib/` | Pure helpers (prompts, SDK wrappers). No I/O beyond the LLM call. No Fastify types. |

If a file in `services/` or `lib/` imports `fastify`, the layering is broken.

## Frontend layering rules

| Rule | Why |
|---|---|
| Components never call `fetch` directly. | They must go through the feature's `frontend-client.ts` so URLs and timeouts stay consistent. |
| Hooks never import `backend-client.ts`. | That file is server-only and importing it bundles `BACKEND_URL` into the browser. |
| `'use client'` components never read `process.env`. | Use `getClientEnv()` from `shared/env/client.ts`. |
| Proxy routes at `app/api/*/route.ts` never contain business logic. | They validate → call `backend-client` → map errors. That's it. |
| Feature-local types live inside `features/{feature}/`. | Cross-feature types go in `types/` or `packages/contracts`. |

## Error shape

All errors conform to `ApiErrorResponse` from `@advance-academy/contracts`:

```ts
interface ApiErrorResponse {
  code: string      // e.g. 'HTTP_ERROR', 'TIMEOUT', 'INVALID_REQUEST', 'NETWORK_ERROR'
  message: string
}
```

- **Frontend** — `shared/api/http-client.ts` throws `HttpClientError` carrying `status` and `payload`.
- **Proxy** — catches `HttpClientError` and re-emits via `NextResponse.json(error.payload, { status: error.status || 500 })`.
- **Backend** — services throw `Error` with `statusCode` (ours) or `status` (Anthropic SDK) or `step` (multi-step pipelines). Routes inspect these and map to HTTP status.

**Canonical error-mapping block:** `backend/src/routes/dream-company.ts:28-65`. Copy it when you add a new route. Do not invent a different pattern.

## Environment access

- **Backend** — only `backend/src/main.ts` and `backend/src/config/llm.ts` read `process.env`. Services receive config as arguments or read from `config/llm.ts` exports.
- **Frontend** — only `shared/env/server.ts` and `shared/env/client.ts` read `process.env`. Every other file imports `getServerEnv()` or `getClientEnv()`.

If you need a new env var, add it to **`backend/.env.example`** and document it in `docs/GETTING_STARTED.md`.

## LLM prompts

Prompts live in `backend/src/lib/{feature}/prompts.ts` as exported string constants. Never inline a prompt inside a service or route — this keeps the business logic readable and lets you iterate on prompts without touching the control flow.

```ts
// backend/src/lib/outreach/prompts.ts
export const OUTREACH_SYSTEM_PROMPT = `You are...`
```

## `'use client'` discipline

- Put `'use client'` at the top of any file that uses `useState`, `useEffect`, `useRef`, browser APIs, or event handlers.
- **Never** put `'use client'` at the top of a file that reads server-only env vars or imports `backend-client.ts`. Those files must stay server-side (Next.js route handlers, `shared/api/backend-client.ts`).
- When in doubt, leave it off. Server Components are the default.

## Commits

Follow the existing `git log` style:

```
feat: add job tracker analyze endpoint
fix: handle 401 from anthropic in dream-company route
refactor: move prompts out of service into lib
```

Prefixes in use: `feat:`, `fix:`, `refactor:`. Keep the subject under ~70 characters. Use the body for "why", not "what" (the diff shows the what).

## Timeouts

Pick a timeout that matches the feature's real latency, not a default. Current values:

| Endpoint | Client timeout | Why |
|---|---|---|
| CV Optimizer `/analyze` | 30s | Returns 202 immediately |
| CV Optimizer `/jobs/:jobId` | 10s | Quick poll |
| Dream Company `/generate` | 120s | 4-step LLM pipeline |
| Dream Company `/parse-cv` | 120s | File parse + LLM |
| Outreach `/generate` | 60s | Single LLM call |
| Outreach `/extract` | 60–120s | URL fetch or file parse |

Set the timeout in **both** `features/*/api/frontend-client.ts` and `shared/api/backend-client.ts`.

## When you're stuck

1. **Mirror the closest feature.** If your new feature is a single LLM call, copy Outreach. If it's a multi-step pipeline, copy Dream Company. If it's async with polling, copy CV Optimizer.
2. **Read [ADD_A_FEATURE.md](./ADD_A_FEATURE.md).** It's the exact step-by-step for adding a new feature end-to-end.
3. **Do not invent a new pattern** unless the existing patterns genuinely don't fit. If they don't, bring it up in review before writing 500 lines of code.

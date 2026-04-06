# Advance Academy Tools

Frontend:
- Next.js + TypeScript

Backend:
- Fastify + TypeScript

## Documentation

Full developer documentation lives in [`docs/`](./docs/README.md):

- **[Getting Started](./docs/GETTING_STARTED.md)** — prerequisites, env setup, running dev
- **[Architecture](./docs/ARCHITECTURE.md)** — system design with diagrams
- **[Backend guide](./docs/BACKEND.md)** — Fastify layout, services, LLM integration
- **[Frontend guide](./docs/FRONTEND.md)** — Next.js layout, feature modules, HTTP client
- **[API reference](./docs/API_REFERENCE.md)** — all endpoints with request/response types
- **[Conventions](./docs/CONVENTIONS.md)** — naming, layering rules, commit style
- **[Add a feature](./docs/ADD_A_FEATURE.md)** — end-to-end walkthrough for new features

## Install

```bash
npm install
```

## Run

Frontend only:

```bash
npm run dev:frontend
```

Backend only:

```bash
npm run dev:backend
```

Both together:

```bash
npm run dev:all
```

## Backend URLs

- `http://localhost:4000/api`
- `http://localhost:4000/api/health`
- `http://localhost:4000/api/cv-optimizer/template`
- `http://localhost:4000/api/dream-company/generate` (POST JSON `{ "profile": { ... } }`)
- `http://localhost:4000/api/dream-company/parse-cv` (POST multipart, field `cv`)
- `http://localhost:4000/api/outreach/generate` (POST JSON outreach payload)

Dream Company and Outreach LLM calls run on the backend; set `LLM_API_KEY` in `backend/.env`.

## Env setup

Frontend (optional — mainly `BACKEND_URL` for API routes that proxy to Fastify):

```bash
copy .env.local.example .env.local
```

Backend (required for LLM features):

```bash
copy backend\\.env.example backend\\.env
```

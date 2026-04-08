# Advance Academy — Developer Documentation

This folder is the single source of truth for understanding, running, and extending the Advance Academy codebase.

## Where to start

| If you are... | Read this first |
|---|---|
| New to the project | [GETTING_STARTED.md](./GETTING_STARTED.md) |
| Looking for the big picture | [ARCHITECTURE.md](./ARCHITECTURE.md) |
| Building a new feature | [ADD_A_FEATURE.md](./ADD_A_FEATURE.md) |
| Working on the API / backend | [BACKEND.md](./BACKEND.md) + [API_REFERENCE.md](./API_REFERENCE.md) |
| Working on the UI | [FRONTEND.md](./FRONTEND.md) |
| Reviewing a pull request | [CONVENTIONS.md](./CONVENTIONS.md) |

## Index

- **[GETTING_STARTED.md](./GETTING_STARTED.md)** — prerequisites, install, env vars, running dev, smoke tests, troubleshooting.
- **[ARCHITECTURE.md](./ARCHITECTURE.md)** — high-level system design, the 4-layer request flow, diagrams, the "no database" model, cross-cutting concerns.
- **[BACKEND.md](./BACKEND.md)** — Fastify layout, routes → services → lib layering, LLM integration, error handling, async job pattern.
- **[FRONTEND.md](./FRONTEND.md)** — Next.js App Router layout, feature module anatomy, HTTP client pattern, proxy routes, state management.
- **[API_REFERENCE.md](./API_REFERENCE.md)** — full HTTP reference for every backend endpoint with request/response types.
- **[CONVENTIONS.md](./CONVENTIONS.md)** — naming, file layout, layering rules, error shape, environment access, commit style.
- **[ADD_A_FEATURE.md](./ADD_A_FEATURE.md)** — end-to-end walkthrough of adding a new feature using a "Job Tracker" example.

## Keeping these docs accurate

These docs describe patterns that already exist in the codebase (CV Optimizer, Dream Company, Outreach all follow the same shape). If you change a pattern in code, update the corresponding doc in the same PR. If you find a doc that disagrees with reality, trust the code and fix the doc.

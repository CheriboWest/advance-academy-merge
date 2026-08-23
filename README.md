# CareerHub UK

A company and job discovery platform for students, with a private coach
workspace (implemented in a later milestone).

This repository is an **npm workspaces monorepo**. This milestone ships the
**public-facing student portal** (`apps/web`) and the shared project scaffold.

## Structure

```
careerhub/
├── apps/
│   ├── web/                # Next.js 15 student portal (implemented)
│   └── api/                # FastAPI backend (scaffold only)
├── packages/
│   ├── ui/                 # Shared UI primitives (scaffold)
│   ├── types/              # Shared TypeScript types (scaffold)
│   └── utils/              # Shared utilities (scaffold)
├── infra/
│   ├── supabase/           # Supabase config (scaffold)
│   └── github-actions/     # CI/CD workflows (scaffold)
└── docs/                   # Documentation
```

## Tech stack

- **Frontend:** Next.js 15 (App Router) + TypeScript
- **Styling:** Tailwind CSS v4
- **Components:** shadcn/ui primitives on a custom "Editorial UK" theme
- **Type:** Instrument Serif (display) + Inter Tight (body)
- **Animations:** CSS transitions + `tw-animate-css` (no animation library)
- **Icons:** Lucide React
- **Package manager:** npm
- **Backend:** FastAPI (scaffold only for this milestone)

## Getting started

```bash
# Install all workspace dependencies from the repo root
npm install

# Run the web app (http://localhost:3000)
npm run dev
```

See [`apps/web/README.md`](apps/web/README.md) for details on the student
portal, including the exact dependency and shadcn/ui commands used to build it.

## Scope of this milestone

Implemented:

- Landing page (`/`)
- Public search page (`/search`)
- Company detail page (`/companies/[slug]`)
- Coach login placeholder (`/coach/login`)
- Dark mode, responsive layout, mock data only

Not implemented (intentionally): Supabase, authentication, FastAPI, AI,
email, coach dashboard, real search, pagination.

## Deployment

Production is deployed on Vercel from the `main` branch — every push to `main`
triggers a new production deployment automatically.

# CareerHub UK — Documentation

## Milestone 1 — Public student portal (this milestone)

Ships the public-facing student portal (`apps/web`) and the shared monorepo
scaffold.

### Delivered

- **Landing page** (`/`) — hero with student and coach entry cards.
- **Public search** (`/search`) — search input plus location, sector, and sort
  filters over a responsive grid of company cards.
- **Company detail** (`/companies/[slug]`) — company profile with website and
  careers links, lead score, and a list of open jobs.
- **Coach login placeholder** (`/coach/login`).
- Dark mode via `next-themes`, mobile-first responsive layout, reusable
  components, and in-memory mock data.

### Deliberately out of scope

Supabase, authentication, FastAPI endpoints, AI, email, the coach dashboard,
real search, and pagination.

## Architecture

CareerHub UK is an **npm workspaces monorepo**:

- `apps/web` — Next.js 15 (App Router) student portal.
- `apps/api` — FastAPI backend (scaffold).
- `packages/*` — shared `types`, `ui`, and `utils` (scaffold).
- `infra/*` — Supabase and GitHub Actions configuration (scaffold).

## Data model (current, mock)

- **Company** — `name`, `slug`, `location`, `sector`, `website`, `careersUrl`,
  `description`, `leadScore` (0–100).
- **Job** — `title`, `companyId`, `location`, optional `salary`, `postedDate`,
  `url`.

See `apps/web/lib/mock-data.ts` for the seed dataset (5 companies, 8 jobs).

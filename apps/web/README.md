# CareerHub UK — Web (`apps/web`)

The public-facing student portal for CareerHub UK, built with Next.js 15
(App Router), Tailwind CSS v4, and shadcn/ui.

## Pages

| Route                 | Access  | Description                                              |
| --------------------- | ------- | -------------------------------------------------------- |
| `/`                   | Public  | Landing page: hero search, role shortcuts, live counts, hiring list. |
| `/search`             | Public  | Company search with location, sector, and sort filters.  |
| `/companies/[slug]`   | Public  | Company detail with links and a list of open jobs.       |
| `/coach/login`        | Public  | Email/password sign-in to the coach workspace.           |
| `/coach/dashboard`    | Coach   | KPIs, top hiring companies, and recent companies.        |
| `/coach/companies`    | Coach   | Searchable table with per-coach starring, notes, hide/restore, and permanent (global) deletion. |
| `/coach/crawler`      | Coach   | Trigger Adzuna/Reed crawls; cache prompt, progress, stats, history. |
| `/coach/outreach`     | Coach   | Companies to draft outreach for (with a "draft saved" flag). |
| `/coach/outreach/[companyId]` | Coach | AI-assisted composer with editable subject/body and draft saving. |

Public pages read live from **Supabase** (read-only, anon key) — the
`public_company_summary` view and the `jobs` table. The **private coach
workspace** adds Supabase Auth (email/password) and per-coach data in the
`coach_company_meta` and `outreach_emails` tables, all protected by Row Level
Security. No FastAPI or email sending in this milestone; "AI" generation is a
deterministic local template.

## Coach workspace

- **Auth:** Supabase Auth (email/password) via `@supabase/ssr`, with
  cookie-based sessions. `lib/supabase-server.ts` and `lib/supabase-browser.ts`
  provide the server and browser clients; sign-in/out use **server actions**.
- **Route protection:** `middleware.ts` guards `/coach/dashboard`,
  `/coach/companies`, and `/coach/outreach`, redirecting unauthenticated users
  to `/coach/login`. The workspace layout re-checks the session server-side
  (defence in depth).
- **Security:** only the anon key is used in the app — never the service role
  key. All private reads/writes rely on RLS keyed to `auth.uid()`. The one
  privileged operation, permanent company deletion, is delegated to the API
  (see below), which holds the service role key server-side.

### Removing vs. deleting a company

The companies table has two destructive-looking actions that mean very different
things. They are deliberately separate:

| Action | Scope | Reversible | Mechanism |
| ------ | ----- | ---------- | --------- |
| **Remove from my list** (eye icon) | This coach only | Yes — the "Removed" tab restores it | `coach_company_meta.hidden = true` (`hideCompanyAction`) |
| **Delete permanently** (trash icon, and "Delete selected (N)") | Everyone: all coaches, students, public search, detail pages | **No** | The `companies` row and its jobs are deleted from the database |

The "Removed" tab lists hidden companies **only**. A permanently deleted company
does not appear there — it no longer exists.

Permanent deletion never runs in the browser and never runs with the coach's own
database credentials:

1. `deleteCompaniesPermanentlyAction` (a server action) validates and
   de-duplicates the ids, authenticates the coach, and forwards their Supabase
   access token.
2. `POST {NEXT_PUBLIC_API_URL}/companies/delete` verifies that token and calls
   the Postgres function `delete_companies_permanently(uuid[])` with the
   **service role key**, which lives only in the API server's environment.
3. The function deletes dependants and the company in **one transaction** —
   jobs and `coach_company_meta` are deleted, `outreach_emails` are kept with
   `company_id` cleared, so a coach never loses their own drafts or sent-mail
   record.

Single-row and bulk deletion call the same action with an array of one or many,
and both go through the same confirmation dialog. Rows are removed from the
table only after the server reports which ids it actually deleted, and the route
is then refreshed so the dashboard, outreach list, and public pages reflect the
new company set. Requires migration
`infra/supabase/migrations/0004_company_permanent_delete.sql`.

### Outreach generation & drafts

- **AI generation:** "Generate with AI" calls the FastAPI backend at
  `POST {NEXT_PUBLIC_API_URL}/ai/outreach` (`lib/outreach-api.ts`), which uses
  Anthropic Claude Sonnet server-side. The Anthropic API key lives only in the
  backend and is never exposed to the frontend. The composer shows loading and
  error states around the call; subject and body remain editable.
- **Fallback template:** `lib/outreach.ts` keeps a pure, deterministic
  British-English generator (no LLM). It is no longer wired into the composer
  but is retained as a reference/offline fallback.
- **Drafts:** stored in `outreach_emails` with `status = 'draft'`, one per
  `(coach, company)`. Opening the composer auto-loads any existing draft;
  saving updates it in place or inserts a new row (via a server action).

Requires `NEXT_PUBLIC_API_URL` (see Environment variables) pointing at the
running API (`apps/api`).

### Expected `coach_company_meta` schema

The companies table stores private, per-coach metadata in `coach_company_meta`.
This app expects the following columns and a unique constraint on
`(coach_user_id, company_id)`:

| Column          | Type        | Notes                                     |
| --------------- | ----------- | ----------------------------------------- |
| `coach_user_id` | `uuid`      | References `auth.users.id` (`auth.uid()`) |
| `company_id`    | `uuid`/`id` | References the company's `id`             |
| `starred`       | `boolean`   |                                           |
| `hidden`        | `boolean`   |                                           |
| `notes`         | `text`      | Nullable                                  |

RLS policies should restrict `select`/`insert`/`update` to rows where
`coach_user_id = auth.uid()`.

### Expected `outreach_emails` schema

Outreach drafts are stored in `outreach_emails`:

| Column          | Type          | Notes                                     |
| --------------- | ------------- | ----------------------------------------- |
| `id`            | `uuid`/`id`   | Primary key                               |
| `coach_user_id` | `uuid`        | References `auth.users.id` (`auth.uid()`) |
| `company_id`    | `uuid`/`id`   | References the company's `id`             |
| `recruiter_id`  | `uuid`/`id`   | Nullable — not used in this milestone     |
| `subject`       | `text`        |                                           |
| `body`          | `text`        |                                           |
| `status`        | `text`        | This milestone only writes `'draft'`      |
| `sent_at`       | `timestamptz` | Nullable — unused until email sending     |
| `created_at`    | `timestamptz` | Defaults to `now()`                       |

RLS policies should restrict `select`/`insert`/`update` to rows where
`coach_user_id = auth.uid()`. Drafts are treated as one-per-`(coach_user_id,
company_id)` where `status = 'draft'`.

## Environment variables

The public pages read from Supabase using two variables. Copy the example file
and fill in your project values:

```bash
cp apps/web/.env.local.example apps/web/.env.local
```

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
NEXT_PUBLIC_API_URL=https://your-api.up.railway.app
```

The Supabase pair is safe to expose to the browser (public anon key, read-only
access via the view and RLS policies). `NEXT_PUBLIC_API_URL` points at
`apps/api` and is required for AI generation, email sending, the crawler, and
permanent company deletion.

## Getting started

From the **repo root** (recommended — installs the whole workspace):

```bash
npm install
npm run dev            # runs apps/web on http://localhost:3000
```

Or from within `apps/web`:

```bash
cd apps/web
npm install
npm run dev
```

Other scripts:

```bash
npm run build          # production build
npm run start          # serve the production build
npm run lint           # eslint
```

## How this app was built

### 1. Dependencies

Runtime:

```bash
npm install next@^15 react@^19 react-dom@^19 \
  @supabase/supabase-js \
  framer-motion lucide-react next-themes \
  class-variance-authority clsx tailwind-merge \
  @radix-ui/react-select @radix-ui/react-separator @radix-ui/react-slot
```

Dev / tooling:

```bash
npm install -D typescript @types/node @types/react @types/react-dom \
  tailwindcss @tailwindcss/postcss tw-animate-css \
  eslint eslint-config-next @eslint/eslintrc
```

### 2. shadcn/ui

`components.json` is configured for the **new-york** style with Tailwind v4 CSS
variables. The following components are vendored under `components/ui`:

```bash
npx shadcn@latest init
npx shadcn@latest add button input select textarea badge separator dialog
```

> The generated component sources are committed directly and then retuned to
> the Editorial UK theme (sharp radii, no drop shadows), so the app builds
> without re-running the shadcn CLI.

## Tech stack

- **Next.js 15** (App Router) + **TypeScript** (strict)
- **Tailwind CSS v4** via `@tailwindcss/postcss` (CSS-first config in
  `app/globals.css`)
- **shadcn/ui** (Button, Input, Select, Textarea, Badge, Separator, Dialog)
- **Supabase** (`@supabase/supabase-js`) for live public data
- **CSS transitions** for hover and press states; `tw-animate-css` for the
  Radix enter/exit animations. No animation library.
- **Lucide React** icons
- **next-themes** for class-based dark mode with a navbar toggle

## Data layer

- `lib/supabase.ts` — lazily-created Supabase client (anon key, read-only).
- `lib/types.ts` — `CompanySummary` (the `public_company_summary` view) and
  `Job` (the `jobs` table).
- `lib/queries.ts` — `fetchCompanies`, `fetchCompanyBySlug`, `fetchActiveJobs`.
- `lib/filters.ts` — filter options, defaults, and URL-param parsing.

Both data pages are async **server components** (`export const dynamic =
"force-dynamic"`); the only client component in the data path is
`search-filters.tsx`, which just reads and writes URL search params. There is
no client-side data fetching for the initial page load.

## Structure

```
apps/web/
├── app/
│   ├── companies/[slug]/page.tsx   # Company detail (async server component)
│   ├── coach/login/page.tsx        # Coach login placeholder
│   ├── search/page.tsx             # Public search (async server component)
│   ├── globals.css                 # Tailwind v4 + theme tokens
│   ├── layout.tsx                  # Root layout, fonts, theme, navbar
│   ├── not-found.tsx               # 404
│   └── page.tsx                    # Landing page
├── components/
│   ├── ui/                         # shadcn primitives
│   ├── company-row.tsx
│   ├── empty-state.tsx
│   ├── job-item.tsx
│   ├── lead-score-badge.tsx
│   ├── navbar.tsx
│   ├── page-container.tsx
│   ├── search-filters.tsx          # client: reads/writes URL params
│   ├── search-results.tsx          # async server: runs the Supabase query
│   ├── search-results-skeleton.tsx # Suspense loading fallback
│   ├── theme-provider.tsx
│   └── theme-toggle.tsx
├── lib/
│   ├── filters.ts                  # filter options + URL parsing
│   ├── queries.ts                  # Supabase data fetchers
│   ├── supabase.ts                 # Supabase client
│   ├── types.ts                    # CompanySummary, Job
│   └── utils.ts                    # cn() helper
├── .env.local.example
├── components.json
├── next.config.ts
├── postcss.config.mjs
├── eslint.config.mjs
├── tsconfig.json
└── package.json
```

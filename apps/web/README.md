# CareerHub UK — Web (`apps/web`)

The public-facing student portal for CareerHub UK, built with Next.js 15
(App Router), Tailwind CSS v4, and shadcn/ui.

## Pages

| Route                 | Description                                                    |
| --------------------- | -------------------------------------------------------------- |
| `/`                   | Landing page with student and coach entry cards.               |
| `/search`             | Public company search with location, sector, and sort filters. |
| `/companies/[slug]`   | Company detail with links and a list of open jobs.             |
| `/coach/login`        | Placeholder for the private coach workspace (coming soon).     |

All data is in-memory mock data (`lib/mock-data.ts`) — no backend, auth, or
real search in this milestone.

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
npx shadcn@latest add button input select card badge separator
```

> The generated component sources are committed directly, so the app builds
> without re-running the shadcn CLI.

## Tech stack

- **Next.js 15** (App Router) + **TypeScript** (strict)
- **Tailwind CSS v4** via `@tailwindcss/postcss` (CSS-first config in
  `app/globals.css`)
- **shadcn/ui** (Button, Input, Select, Card, Badge, Separator)
- **Framer Motion** for entrance and hover animations
- **Lucide React** icons
- **next-themes** for class-based dark mode with a navbar toggle

## Structure

```
apps/web/
├── app/
│   ├── companies/[slug]/page.tsx   # Company detail (server component)
│   ├── coach/login/page.tsx        # Coach login placeholder
│   ├── search/page.tsx             # Public search (client component)
│   ├── globals.css                 # Tailwind v4 + theme tokens
│   ├── layout.tsx                  # Root layout, fonts, theme, navbar
│   ├── not-found.tsx               # 404
│   └── page.tsx                    # Landing page
├── components/
│   ├── ui/                         # shadcn primitives
│   ├── company-card.tsx
│   ├── empty-state.tsx
│   ├── job-item.tsx
│   ├── lead-score-badge.tsx
│   ├── navbar.tsx
│   ├── page-container.tsx
│   ├── search-filters.tsx
│   ├── theme-provider.tsx
│   └── theme-toggle.tsx
├── lib/
│   ├── mock-data.ts                # 5 companies, 8 jobs
│   └── utils.ts                    # cn() helper
├── components.json
├── next.config.ts
├── postcss.config.mjs
├── eslint.config.mjs
├── tsconfig.json
└── package.json
```

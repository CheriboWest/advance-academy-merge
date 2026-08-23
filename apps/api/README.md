# CareerHub UK — API (`apps/api`)

FastAPI backend for CareerHub UK. This milestone implements **AI outreach
generation** using Anthropic Claude Sonnet. Deploy target: **Railway**.

The Anthropic API key lives here, server-side only, and is **never** exposed to
the frontend — the frontend calls this backend, which calls Anthropic.

## Stack

- **Framework:** FastAPI
- **Server:** Uvicorn
- **AI:** Anthropic Claude Sonnet (`claude-sonnet-5`) via the official
  `anthropic` Python SDK
- **Language:** Python 3.11+

## Structure

```
apps/api/
├── app/
│   ├── __init__.py
│   ├── main.py            # FastAPI app + CORS + /health
│   ├── config.py          # env-based settings (dotenv)
│   ├── schemas.py         # Pydantic request/response models
│   └── routers/
│       └── ai.py          # POST /ai/outreach
├── requirements.txt
├── .env.example
├── Procfile               # Railway/Heroku-style start command
├── railway.json           # Railway deploy config
└── runtime.txt            # Python version hint
```

## Endpoint

### `POST /ai/outreach` (authenticated)

Requires a Supabase access token: `Authorization: Bearer <token>`. The token's
signature, expiry, and issuer (must contain `SUPABASE_URL`) are verified with
`python-jose`; the coach's user id (`sub`) is read via the reusable
`get_current_user` dependency. A missing or invalid token returns **401**.

Request:

```json
{
  "company_name": "TechNova Solutions",
  "location": "London",
  "sector": "Technology",
  "open_jobs": 2,
  "lead_score": 85
}
```

Response:

```json
{
  "subject": "…",
  "body": "…"
}
```

The system prompt instructs Claude to write professional British English,
concise, personalised to the company, mentioning hiring activity naturally,
avoiding spammy language, 120–180 words, suitable for a recruitment/coaching
business reaching out to a hiring company. Errors, timeouts, and refusals are
mapped to appropriate HTTP status codes.

### `POST /email/send` (authenticated)

Requires a Supabase access token (same `get_current_user` dependency). Sends a
saved outreach draft through **Resend's HTTPS API**. Railway blocks outbound
SMTP on every plan below Pro, so mail leaves over port 443 and Resend does the
SMTP delivery.

Request:

```json
{ "draft_id": "…", "to": "recruiter@company.com" }
```

Flow: verify coach JWT → load the draft from Supabase with the **service role
key** → confirm `coach_user_id` matches the caller → POST to Resend → update the
row (`status = 'sent'`, `sent_at = now()`). Returns
`{ "status": "sent", "sent_at": "…", "recipient_email": "…" }`. A missing draft
is 404; a draft owned by another coach is 403; a send failure is 502.

### `POST /companies/delete` (authenticated)

Permanently deletes companies **for every user** — the coach who asked, other
coaches, students, the public search, and the company detail pages. Requires a
Supabase access token (same `get_current_user` dependency).

Request:

```json
{ "company_ids": ["uuid", "uuid"] }
```

Ids are validated as UUIDs and capped at 200 per request. The endpoint calls the
Postgres function `delete_companies_permanently(uuid[])` with the **service role
key**, which performs the whole deletion in a single transaction:

| Table | Treatment | Why |
| ----- | --------- | --- |
| `jobs` | deleted | Shared crawler data, meaningless without the company |
| `coach_company_meta` | deleted (all coaches) | Per-coach stars/notes/hidden for that company; its foreign key also forbids leaving it behind |
| `outreach_emails` | **kept**, `company_id` set to `null` | Coach-authored drafts and the record of mail actually sent — not the company's data to delete |
| `companies` | deleted | The company itself |

The function refuses (and rolls back) if any other table references
`companies.id`, so an unhandled relationship fails loudly instead of destroying
un-audited rows.

Response:

```json
{
  "requested": 2,
  "deleted_companies": 1,
  "deleted_company_ids": ["…"],
  "missing_company_ids": ["…"],
  "deleted_jobs": 7,
  "deleted_coach_meta": 3,
  "unlinked_outreach_emails": 1
}
```

`deleted_companies + len(missing_company_ids) == requested`, so a partial result
is explicit rather than implied. A missing token is 401, a malformed id is 422,
an uninstalled function is 500 (naming the migration to apply), and any other
database failure is 502 — in which case nothing was deleted, because the
transaction rolled back.

Requires migration `infra/supabase/migrations/0004_company_permanent_delete.sql`.

### Crawler (authenticated)

- **`POST /discover/start`** — `{ query, city, sources, force }`. Verifies the
  coach JWT, checks the 24h cache (`discovery_queries`); returns
  `{ cached: true, hours_ago, jobs_available }` on a fresh hit, otherwise creates
  a `crawl_runs` row and launches a **BackgroundTask**, returning
  `{ cached: false, run_id, status: "running" }`.
- **`GET /discover/status/{run_id}`** — the run's status + statistics (poll until
  `status` is `completed`/`failed`).
- **`GET /discover/history`** — the last 10 crawl runs.

Crawl pipeline: fetch from Adzuna/Reed (per-source timeouts, partial failure
tolerated) → normalize company/title/city/salary → merge company name variants
into one slug → upsert companies (best-effort homepage enrichment: description,
sector, careers_url) → recompute `lead_score` → dedup jobs by `content_hash` and
upsert into `jobs` → record stats on `crawl_runs`. Newly ingested companies with
active jobs appear automatically in the student portal via
`public_company_summary`.

### Sponsor register (authenticated)

The **[UK Register of Licensed Sponsors: workers](https://www.gov.uk/government/publications/register-of-licensed-sponsors-workers)**
is the only authority for whether an organisation currently holds a sponsor
licence. Claude is an *entity-resolution* layer on top of it — it decides
whether a crawled company and a register row describe the same organisation,
and never whether a licence exists.

- **`POST /sponsors/import`** — locate the current CSV on GOV.UK, download,
  parse, and upsert it. Also the refresh path: the publication page is read on
  every run, so a newly published edition is picked up without a code change.
  Safe to run repeatedly.
- **`GET /sponsors/imports`** — recent ingestion runs with their statistics.
- **`POST /sponsors/resolve/{company_id}`** — narrow the register to a few
  candidates in the database, then ask Claude which (if any) is the same entity.

Requires migration `infra/supabase/migrations/0006_sponsor_register.sql`.

#### Stored fields

| GOV.UK column | Stored as | Notes |
| --- | --- | --- |
| Organisation Name | `organisation_name` | Verbatim; never rewritten |
| Town/City | `town_city` | Verbatim |
| County | `county` | Verbatim |
| Type & Rating | `type_rating` | Verbatim, plus parsed `licence_type` + `rating` |
| Route | `route` | Verbatim |

Alongside them: `normalized_name`/`normalized_town` (lookup only), `natural_key`
(the register line's identity), `source_url`, `register_published_at`,
`first_seen_at`, `last_seen_at`, `is_current`, `withdrawn_at`.

#### Deduplication and current status

A register line is identified by (organisation, town, county, type & rating,
route), hashed into `natural_key` with a unique index — so one organisation can
hold several rows (multiple routes or sites) and re-running the importer over an
unchanged file inserts nothing. A row that stops appearing in a newer edition is
marked `is_current = false` with a `withdrawn_at` stamp and **kept**: absence
from today's file means the licence is not listed today, not that it never
existed.

#### Running the importer manually

```bash
cd apps/api
python scripts/import_sponsor_register.py                       # download + ingest
python scripts/import_sponsor_register.py --file register.csv   # ingest a local file
python scripts/import_sponsor_register.py --file register.csv --dry-run
```

`GET /health` returns `{"status": "ok"}`.

## Environment variables

Copy `.env.example` to `.env` and fill in:

| Variable            | Required | Default           | Notes                                   |
| ------------------- | -------- | ----------------- | --------------------------------------- |
| `ANTHROPIC_API_KEY` | ✅       | —                 | Server-side only; never sent to browser |
| `ANTHROPIC_MODEL`   | ❌       | `claude-sonnet-5` | Claude Sonnet model id                  |
| `ANTHROPIC_TIMEOUT` | ❌       | `30`              | Request timeout (seconds)               |
| `ALLOWED_ORIGINS`   | ❌       | `http://localhost:3000` | Comma-separated CORS origins (your Vercel URL) |
| `ALLOWED_ORIGIN_REGEX` | ❌    | —                 | Extra CORS origins by regex, for Vercel preview URLs. Full-matched — anchor it to your own scope |
| `SUPABASE_URL`      | ✅       | —                 | Supabase project URL; coach tokens are verified against its public JWKS, and the issuer must contain it |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | —              | Service role key; loads/updates drafts, runs the crawler ingestion, and performs permanent company deletion server-side (never sent to browser) |
| `RESEND_API_KEY`    | ✅       | —                 | Resend API key (`re_…`); sends over HTTPS |
| `EMAIL_FROM`        | ✅       | —                 | From address; its domain must be verified in Resend |
| `ADZUNA_APP_ID`     | ✅ (crawler) | —             | Adzuna API app id                       |
| `ADZUNA_APP_KEY`    | ✅ (crawler) | —             | Adzuna API app key                      |
| `REED_API_KEY`      | ✅ (crawler) | —             | Reed API key                            |
| `SPONSOR_RESOLVER_MODEL` | ❌  | `claude-opus-5` | Model used for sponsor entity resolution |

## Run locally

```bash
cd apps/api
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env            # then add your ANTHROPIC_API_KEY
uvicorn app.main:app --reload --port 8000
```

- API: http://localhost:8000
- Interactive docs: http://localhost:8000/docs

## Deploy to Railway

1. Create a new Railway project from this repo, root directory `apps/api`.
2. Railway uses `railway.json` / `Procfile` to run
   `uvicorn app.main:app --host 0.0.0.0 --port $PORT`.
3. Set the environment variables above in the Railway dashboard — set
   `ALLOWED_ORIGINS` to your Vercel frontend URL.
4. Point the frontend's `NEXT_PUBLIC_API_URL` at the Railway service URL.

## Self-checks

The API ships plain-Python self-checks (no pytest). Run them from `apps/api`:

```bash
python test_auth.py        # JWKS token verification
python test_cors.py        # CORS configuration
python test_scoring.py     # lead scoring
python test_companies.py   # permanent company deletion endpoint
python test_sponsor_register.py   # sponsor-register ingestion (fixture CSV)
python test_sponsor_matching.py   # candidate search + entity resolution
```

`test_companies.py` stubs the Supabase call, so it needs no network and no
database: it covers auth, id validation, the de-duplicated RPC payload, partial
results, and error mapping.

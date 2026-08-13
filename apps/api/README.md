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
saved outreach draft through the shared Google Workspace mailbox (Gmail SMTP,
TLS on port 587).

Request:

```json
{ "draft_id": "…", "to": "recruiter@company.com" }
```

Flow: verify coach JWT → load the draft from Supabase with the **service role
key** → confirm `coach_user_id` matches the caller → send via SMTP → update the
row (`status = 'sent'`, `sent_at = now()`, `recipient_email = to`). Returns
`{ "status": "sent", "sent_at": "…", "recipient_email": "…" }`. A missing draft
is 404; a draft owned by another coach is 403; an SMTP failure is 502.

`GET /health` returns `{"status": "ok"}`.

## Environment variables

Copy `.env.example` to `.env` and fill in:

| Variable            | Required | Default           | Notes                                   |
| ------------------- | -------- | ----------------- | --------------------------------------- |
| `ANTHROPIC_API_KEY` | ✅       | —                 | Server-side only; never sent to browser |
| `ANTHROPIC_MODEL`   | ❌       | `claude-sonnet-5` | Claude Sonnet model id                  |
| `ANTHROPIC_TIMEOUT` | ❌       | `30`              | Request timeout (seconds)               |
| `ALLOWED_ORIGINS`   | ❌       | `http://localhost:3000` | Comma-separated CORS origins (your Vercel URL) |
| `SUPABASE_JWT_SECRET` | ✅     | —                 | Supabase JWT secret; verifies coach access tokens |
| `SUPABASE_URL`      | ✅       | —                 | Supabase project URL; token issuer must contain it |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | —              | Service role key; loads/updates drafts server-side (never sent to browser) |
| `SMTP_HOST`         | ✅       | `smtp.gmail.com`  | SMTP host                               |
| `SMTP_PORT`         | ✅       | `587`             | SMTP port (TLS/STARTTLS)                |
| `SMTP_USERNAME`     | ✅       | —                 | Mailbox username                        |
| `SMTP_PASSWORD`     | ✅       | —                 | Gmail **App Password** (not the normal password) |
| `SMTP_FROM`         | ✅       | —                 | From address (the shared mailbox)       |

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

## Out of scope for this milestone

Authentication, Supabase integration, email sending, and all
company/job/search endpoints remain deferred.

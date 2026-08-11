# CareerHub UK — API (`apps/api`)

FastAPI backend for CareerHub UK.

**Scaffold only for this milestone.** No endpoints, database access, or
business logic are implemented yet. This folder reserves the structure and
documents the intended stack so the backend milestone can start cleanly.

## Planned stack

- **Framework:** FastAPI
- **Server:** Uvicorn
- **Data:** Supabase (Postgres) — not wired up yet
- **Language:** Python 3.11+

## Planned local development (not yet functional)

```bash
cd apps/api
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

## Out of scope for this milestone

Authentication, Supabase integration, AI features, email sending, and all
search/company/job endpoints are deliberately deferred.

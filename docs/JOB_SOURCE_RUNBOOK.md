# Runbook — Dream Company Live-Vacancy Job Source (Adzuna + Reed)

Operational guide for the job-source feature that replaces raw Exa web-search with
routed live-vacancy sources. Code lives in `backend/src/services/job-search.service.ts`
(orchestrator), `backend/src/lib/adzuna-client.ts`, `backend/src/lib/reed-client.ts`,
`backend/src/lib/job-http.ts`, `backend/src/lib/job-cache.ts`, and
`backend/src/config/job-source.ts`.

## How it routes

`searchLiveJobs({ roleTitles, location })` picks a source from the location:

| Location | Source |
|----------|--------|
| UK (London, Manchester, England, "United Kingdom", …) | Adzuna `gb` **+** Reed, merged |
| Adzuna-covered country (US, AU, CA, DE, FR, IN, NL, SG, …) | Adzuna (that country) |
| Anything else (e.g. Vietnam) | Exa (legacy web search) |

Fallback chain on failure: primary source → the other source (UK) → Exa → clean
`{ jobs: [], error: AAT-10 }`. It never throws — a dead job source cannot take down the
roadmap.

## Environment variables (Railway → backend service)

| Var | Purpose | Default |
|-----|---------|---------|
| `DREAM_JOB_SOURCE` | `hybrid` \| `adzuna_reed` \| `exa` | `hybrid` (unknown value → hybrid + warn) |
| `ADZUNA_APP_ID` / `ADZUNA_APP_KEY` | Adzuna auth (query params) | — (missing → source returns 503, routed around) |
| `REED_API_KEY` | Reed auth (Basic, key = username, empty password) | — |
| `JOB_SOURCE_TIMEOUT_MS` | per-source HTTP timeout | `8000` |
| `JOB_CACHE_TTL_MS` | in-memory result cache TTL | `1200000` (20 min) |

Get free-tier keys: Adzuna → https://developer.adzuna.com ; Reed → https://www.reed.co.uk/developers.

## Rollout (staged)

1. **dev**: `DREAM_JOB_SOURCE=hybrid`, keys set locally in `backend/.env`. Run
   `npm run dev:all` and exercise a UK profile.
2. **prod stays on Exa** until acceptance passes: set Railway `DREAM_JOB_SOURCE=exa`
   (byte-identical to the old behaviour) while Adzuna/Reed keys are added.
3. **Acceptance**: from repo root with keys in `backend/.env`, run
   `npx tsx test/dream-company/jobsource-harness.ts`. It must report:
   - Jobs ≤ 45 days: ≥ 90%
   - Valid URLs: 100%
   - LinkedIn `/in/` profiles: 0
   It writes `test/dream-company/COMPARISON-jobsource.md`.
   ⚠️ The harness makes **live** Adzuna/Reed/Exa calls — run it deliberately.
4. **Flip prod**: set Railway `DREAM_JOB_SOURCE=hybrid`. No redeploy needed — the flag
   is read lazily per request. Verify one real UK roadmap in production and confirm the
   "Currently Hiring" list shows recent postings with a "Posted N days ago" line.

## Rollback (< 1 minute, no deploy)

Set Railway `DREAM_JOB_SOURCE=exa`. The next request reads the new value and reverts to
the exact previous Exa behaviour. Remove the Adzuna/Reed keys only if you also want the
sources hard-disabled (not required — `exa` mode ignores them).

## Reading logs (Railway backend)

- `[job-search] source=uk country=gb jobs=17` — a served result and its source.
- `[job-search] cache=hit|miss key="hybrid|london, uk|data analyst"` — cache behaviour.
- `[job-search] fetched source=adzuna results=15` — a source returned N raw results.
- `[job-search] source=reed failed: …` — a source errored (fell back).
- `[adzuna] 429 rate-limited — backing off 1000ms …` — free-tier throttling; the retry
  handles it. Frequent 429s = approaching the free-tier ceiling (see below).
- `[cost] … provider=adzuna calls=1 cost=$0.00000` — per-request source call counts.

## Free-tier limits & rate limiting

- Adzuna free tier is roughly ~250 calls/day, ~25/min (check your plan on the dashboard).
- Reed free tier is generous but not unlimited.
- Mitigations already in place: 20-minute in-memory cache (per mode|location|roles),
  429/5xx retry with 1s→2s→4s backoff, and 8s per-source timeout. If you see sustained
  429s in logs, raise `JOB_CACHE_TTL_MS` or request a higher Adzuna tier.
- The cache is **process-local** — with multiple Railway instances each has its own, so
  the effective hit-rate is lower than single-instance. That's acceptable (soft cache).

## Key rotation

The Adzuna/Reed keys were shared over chat during setup — rotate them after first
rollout:
1. Regenerate keys on each provider's dashboard.
2. Update Railway `ADZUNA_APP_ID` / `ADZUNA_APP_KEY` / `REED_API_KEY`.
3. No code change; the next request picks up the new values.

## Failure modes

| Symptom | Cause | Action |
|---------|-------|--------|
| UK profile shows Exa-style results | Adzuna+Reed both failing → Exa fallback | Check keys / 401 / 503 in logs |
| "Could not load live job listings" (AAT-10) | All sources down | Roadmap still valid; check provider status |
| Stale jobs in list | Freshness filter relaxed (<8 fresh found) | Expected for sparse roles — see D2 in the work order |
| No "Posted" line on a card | Job had no/invalid publishedDate | Cosmetic; Exa fallback items sometimes lack dates |

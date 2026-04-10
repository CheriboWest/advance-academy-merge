# Plan: Auto-extract Job Details from a Posted Job URL (Jina-powered)

## Context

The user wants to speed up the **interview prep** flow. Today, in the SetupStep of `features/interview-prep/components/interview-prep-screen.tsx`, users must manually type/paste 5 fields:
- Job Title, Job Description, Company Name, Company URL, Additional Links

The user wants to paste a single job posting URL (e.g. LinkedIn) and have those fields auto-populated. Anything Jina/LLM can't extract should be left blank for manual entry.

**Important finding from exploration:** there is **no existing backend endpoint that takes a job URL and returns structured job fields**. However:
- Jina is **already integrated** (`JINA_API_KEY` in `backend/.env.example`, `extractTextFromUrl()` in `backend/src/services/outreach-extractor.service.ts`)
- The LLM client (Anthropic) is already wired and used by `dream-company.service.ts` and similar services
- The `@features/dream-company/` mention in the request appears to be a misdirection — the fields listed (Job Title, JD, Company Name, Company URL, additional links) live in **`features/interview-prep`**, not dream-company. The dream-company feature stores career profile fields (degree, skills, etc.), not job-posting fields. **This plan targets interview-prep.** Confirm via ExitPlanMode if this is wrong.

## Approach

Reuse the existing Jina extractor (do not duplicate it). Add one new backend endpoint that:
1. Calls `extractTextFromUrl(url)` to fetch the page markdown via Jina Reader
2. Sends that markdown to the LLM with a strict JSON schema prompt
3. Returns `{ jobTitle, jobDescription, companyName, companyUrl, extraLinks }` — empty strings for any field the LLM cannot determine

Then add a small UI affordance in interview-prep SetupStep: a URL input + "Extract" button above the existing fields that pre-fills them on success.

## Backend changes

### 1. New service: `backend/src/services/job-extraction.service.ts`
- Export `extractJobFromUrl(url: string): Promise<ExtractedJob>`
- Steps:
  - Validate URL (basic `new URL()` check)
  - Call `extractTextFromUrl(url)` from `outreach-extractor.service.ts` (reuse — do not re-implement Jina)
  - Truncate markdown to a safe size (e.g. 20k chars)
  - Call the existing LLM helper used by `dream-company.service.ts` (check that file for the exact import — likely `callLLM` / `chatJSON` in `backend/src/services/llm/`) with a prompt like:
    > "Extract the following from this job posting markdown. Return ONLY valid JSON with keys: jobTitle, jobDescription, companyName, companyUrl, extraLinks. Use empty string '' for any field you cannot confidently determine. extraLinks should be a newline-separated list of relevant URLs found in the page (apply link, company careers page, recruiter LinkedIn) or ''. jobDescription should be the full responsibilities/requirements text, not a summary."
  - Parse and normalize JSON; coerce missing keys to `''`
- Model: reuse `LLM_MODEL_INTERVIEW_PREP` env var (matches existing convention in `.env.example`)

### 2. New route: `backend/src/routes/job-extraction.ts`
- `POST /api/interview-prep/extract-job-from-url`
- Body: `{ url: string }`
- 400 if missing/invalid url
- Returns the `ExtractedJob` object
- Mirror error handling from `outreach.ts:36-70` (503 for LLM not configured, propagate `statusCode`)
- Register in `backend/src/main.ts` next to other route registrations

### 3. Type
Add to `backend/src/types/` (e.g. extend `interview-prep.ts` if it exists, otherwise new file):
```ts
export interface ExtractedJob {
  jobTitle: string;
  jobDescription: string;
  companyName: string;
  companyUrl: string;
  extraLinks: string;
}
```

## Frontend changes

### 4. Backend client helper
In `shared/api/backend-client.ts`, add:
```ts
export function extractJobFromUrlWithBackend(payload: { url: string }): Promise<ExtractedJob>
```
Follow the same fetch pattern as `extractOutreachTextWithBackend`.

### 5. Interview-prep hook / API client
In `features/interview-prep/` (check for an existing api/hook file similar to dream-company's pattern), add a thin wrapper that calls the helper and returns `ExtractedJob`.

### 6. UI: SetupStep in `features/interview-prep/components/interview-prep-screen.tsx`
Above the existing Job Title field, add:
- A labeled URL input ("Paste job posting URL (LinkedIn, etc.)")
- An "Extract" button (disabled while loading; shows spinner)
- On success: merge result into the existing context state — **only overwrite fields that come back non-empty**, so a partial extraction never wipes user-typed data
- On failure: show inline error toast/message; leave fields untouched
- Keep all existing fields editable so user can fix/fill anything Jina/LLM missed

## Critical files

- `backend/src/services/outreach-extractor.service.ts` — **reuse `extractTextFromUrl`**
- `backend/src/services/dream-company.service.ts` — reference for LLM call pattern + JSON parsing
- `backend/src/routes/outreach.ts` — reference for route + error handling pattern
- `backend/src/main.ts` — register new route
- `backend/.env.example` — already has `JINA_API_KEY` and `LLM_MODEL_INTERVIEW_PREP`; no new env vars needed
- `features/interview-prep/components/interview-prep-screen.tsx` — SetupStep UI
- `shared/api/backend-client.ts` — add new helper

## Verification

1. Backend unit-ish test via curl:
   ```
   curl -X POST http://localhost:<port>/api/interview-prep/extract-job-from-url \
     -H "Content-Type: application/json" \
     -d '{"url":"https://www.linkedin.com/jobs/view/<id>"}'
   ```
   Expect JSON with the 5 fields populated (or `''`).
2. End-to-end: run frontend + backend, open interview-prep, paste a real LinkedIn job URL, click Extract, confirm the form pre-fills and that empty fields remain empty for manual entry.
3. Negative cases: invalid URL → 400; URL Jina cannot fetch → graceful error toast; LLM not configured → 503 surfaced as friendly message.
4. Confirm partial-extraction safety: type into Company Name, then extract a URL whose page lacks a company name → the typed value is preserved.

## Out of scope

- No schema/migration changes (the extracted data feeds the in-memory `InterviewContext`; persistence to `job_targets` already happens elsewhere when a session is saved).
- No changes to dream-company feature.
- No caching of extraction results (can add later if Jina cost becomes a concern).

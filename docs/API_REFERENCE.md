# API Reference

Every HTTP endpoint exposed by the backend. The frontend hits the **same paths** via the Next.js proxy routes under `app/api/*`, minus the `http://localhost:4000` prefix.

- **Base URL (dev):** `http://localhost:4000`
- **Content-Type:** `application/json` unless noted (multipart for file uploads).
- **Error shape:** all errors return `{ code: string, message: string }` per `@advance-academy/contracts`.

---

## System

### `GET /api/health`

Liveness check. Used by `curl` smoke tests and the `docs/GETTING_STARTED.md` verification step.

**Response 200**

```json
{
  "status": "ok",
  "timestamp": "2026-04-06T12:00:00.000Z",
  "adapter": "..."
}
```

---

## CV Optimizer

### `GET /api/cv-optimizer/template`

Returns the schema and configuration for the CV Optimizer endpoint. Useful for clients that want to render the input form dynamically.

**Response 200** — template object (schema for the analyze request).

### `POST /api/cv-optimizer/analyze`

Submits a CV for async analysis. Returns immediately with a `jobId`. The client polls `/jobs/:jobId` until the result is ready.

**Request body**

```ts
{
  candidateName: string
  targetRole: string
  currentCvText: string
  jobDescription?: string
}
```

**Response 202**

```ts
{
  jobId: string
}
```

### `GET /api/cv-optimizer/jobs/:jobId`

Returns the current status of an analysis job. The frontend polls this every `1500ms` (see `shared/env/client.ts`).

**Response 200** (pending)

```ts
{
  status: 'pending'
}
```

**Response 200** (completed)

```ts
{
  status: 'completed',
  result: {
    overallScore: number          // 0-100
    sections: Array<{
      title: string
      score: number               // 0-100
      feedback: string
    }>
    expertReview: string
  }
}
```

**Response 200** (failed)

```ts
{
  status: 'failed',
  error: { code: string, message: string }
}
```

**Response 404** — jobId unknown (e.g. wrong process after horizontal scale).

> **Gotcha:** Jobs are stored in-memory per process. If your backend is deployed with multiple instances, you must use sticky sessions or the poll may 404.

---

## Dream Company

### `POST /api/dream-company/generate`

Generates a full career intelligence report. This is the 4-step pipeline (profile analysis → company matrix → target roles → career roadmap). Typical latency: 60–120 seconds.

**Request body**

```ts
{
  profile: {
    degree: string
    workExperience: string
    skills: string
    interests: string
    targetSalary: string
    location: string
  }
}
```

**Response 200**

```ts
{
  profile: DreamCompanyInput
  analysis: {
    marketLevel: string
    salaryRange: { min: number, max: number, currency: string }
    strengths: string[]
    gaps: string[]
    readiness: string
  }
  matrix: {
    tier1: Company[]   // ~7 stretch companies
    tier2: Company[]   // ~7 target companies
    tier3: Company[]   // ~6 safe companies
  }
  roles: Array<{
    title: string
    salary: { min: number, max: number, currency: string }
    demand: string
    fitReason: string
  }>
  roadmap: {
    phases: Array<{
      name: string
      durationWeeks: number
      actions: string[]
    }>
  }
  generatedAt: string    // ISO 8601
}
```

**Errors**

- `400` — missing required profile fields.
- `401` — Anthropic rejected the API key.
- `500 { error, step }` — LLM response parse failure at a specific pipeline step.
- `502` — Anthropic returned 404 for the configured model (set `LLM_MODEL_DREAM_COMPANY`).
- `503` — `LLM_API_KEY` not set.

### `POST /api/dream-company/parse-cv`

Parses an uploaded CV file and returns structured profile fields the user can then edit and submit to `/generate`.

**Request** — `multipart/form-data` with a single field `cv` containing a `.pdf` or `.docx` file (≤15 MB).

**Response 200**

```ts
{
  degree: string
  workExperience: string
  skills: string
  interests: string
  targetSalary: string
  location: string
  currentLevel: 'intern' | 'junior' | 'mid' | 'senior' | 'lead' | 'manager' | 'director' | 'executive'
  confidence: {
    degree: 'high' | 'medium' | 'low'
    workExperience: 'high' | 'medium' | 'low'
    skills: 'high' | 'medium' | 'low'
    location: 'high' | 'medium' | 'low'
  }
}
```

**Errors**

- `400` — invalid multipart or missing `cv` field or unsupported file extension.
- `422` — file was valid but unreadable (corrupt PDF/DOCX).
- `401` / `502` / `503` — same LLM-related errors as `/generate`.

---

## Outreach

### `POST /api/outreach/generate`

Generates a LinkedIn message (<300 chars) and an email (subject + body) for a specific target.

**Request body**

```ts
{
  cvText: string
  linkedInText?: string
  targetCompany: string
  targetPersonName: string
  targetPersonRole?: string
  enrichedContexts: Array<{
    type: string        // e.g. "company_website", "job_description"
    content: string
  }>
  intent: 'direct_application' | 'referral_request' | 'informational_interview' | 'agency_recruiter'
}
```

**Response 200**

```ts
{
  intent: OutreachIntent
  linkedInMessage: string     // <300 chars
  email: {
    subject: string
    body: string
  }
}
```

**Errors** — same LLM error mapping as Dream Company.

### `POST /api/outreach/extract`

Extracts plain text from a file upload **or** a URL, to feed into the `enrichedContexts` field of `/generate`.

**Request (file mode)** — `multipart/form-data` with a file field (PDF/DOCX, ≤15 MB).

**Request (URL mode)** — `application/json`:

```ts
{ url: string }
```

URL mode uses the Jina Reader API (`https://r.jina.ai/{targetUrl}`). Set `JINA_API_KEY` for authenticated access if you're rate-limited.

**Response 200**

```ts
{ text: string }
```

**Errors**

- `400` — neither file nor URL provided.
- `422` — extraction failed (unreadable file or blocked URL).

---

## Error code cheat sheet

| Status | When | Typical message |
|---|---|---|
| 400 | Bad request body / missing fields / invalid file type | "Missing required fields" |
| 401 | Anthropic key rejected | "Anthropic API rejected the key (401). Check LLM_API_KEY in backend/.env." |
| 404 | Unknown jobId (CV Optimizer) | — |
| 422 | Valid request but parsing/extraction failed | "Parse failed" |
| 500 | Unexpected or LLM response parse error | "Internal server error" or `{ error, step }` |
| 502 | Anthropic returned 404 for the model | "Anthropic returned 404 for the configured model. Set LLM_MODEL_{FEATURE}..." |
| 503 | LLM not configured | "LLM is not configured (set LLM_API_KEY in backend/.env)." |
| 504 | Client-side request timeout | "The request timed out." |

## Frontend proxy paths

The frontend hits these paths on **its own origin** (Next.js, port 3000 in dev). The proxy route forwards to the backend with the matching path:

| Frontend path | Backend path |
|---|---|
| `/api/cv-optimizer/analyze` | `/api/cv-optimizer/analyze` |
| `/api/cv-optimizer/jobs/:jobId` | `/api/cv-optimizer/jobs/:jobId` |
| `/api/dream-company/generate` | `/api/dream-company/generate` |
| `/api/dream-company/parse-cv` | `/api/dream-company/parse-cv` |
| `/api/outreach/generate` | `/api/outreach/generate` |
| `/api/outreach/extract` | `/api/outreach/extract` |

The proxy paths are identical to the backend paths by convention. **Keep it that way** when you add new endpoints.

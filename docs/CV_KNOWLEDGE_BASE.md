# CV Knowledge Base + Grounded Coach Answer

This feature adds a persistent **CV Library** and a per-answer **Enhanced Version** coach to the interview prep flow. The goal is to stop the LLM from inventing facts ("hallucinating") when it rewrites a candidate's interview answer, by grounding it in evidence the user has previously attached to specific CV bullets.

Two source plans inform this implementation. If they conflict, the second one wins:
- [plans/cv-knowledge-base.md](plans/cv-knowledge-base.md) — primary
- `.claude/plans/idempotent-bouncing-lynx.md` — earlier strategy doc (per-answer coach prompt + JIT clarification loop)

## High-level flow

1. **Once per CV** (in the new `/cv-library` page):
   1. User uploads a PDF/DOCX and names the version (e.g. *"2025 SWE CV"*).
   2. The backend extracts every bullet point and detects the field (`tech` / `business` / `marketing`).
   3. For each bullet, the LLM generates **exactly 5** "most important missing details" an interviewer would ask about.
   4. The user fills those gaps with text, file uploads, or URLs (Jina-fetched). Each artifact is summarized into a small structured `summary_json` blob.
2. **During every interview**:
   1. After each candidate answer is scored, the user can click **See enhanced version** below their message.
   2. The coach endpoint pulls the user's **active CV**, picks the 1–3 most relevant bullets for the interview question, fetches their `bullet_artifacts.summary_json` blobs, and asks Claude to rewrite the answer using ONLY that evidence pool. Anything missing becomes a `[CANDIDATE TO FILL: bulletId|question]` placeholder.
   3. The UI renders placeholders as yellow chips with inline forms. When the user types an answer, it's POSTed to the JIT-clarification endpoint, written back to `bullet_artifacts` with `source_type='jit_clarification'`, and the coach is re-run so the placeholder disappears. The knowledge base grows with every session.

A user can have multiple CVs; only one is `is_active=true` at a time (enforced by a partial unique index). The coach automatically picks the active CV.

## Database schema

Migration: [supabase/migrations/002_cv_knowledge_base.sql](../supabase/migrations/002_cv_knowledge_base.sql) — idempotent (`create … if not exists`, `add column if not exists`). Re-runnable safely.

```
users (existing)
  └── cv_versions               one row per named CV the user uploads
        └── cv_bullets          one row per extracted bullet point
              └── bullet_gaps   up to 5 rows per bullet (the "missing details")
                    └── bullet_artifacts   user-supplied evidence answering a gap
```

| Table | Notable columns |
|---|---|
| `cv_versions` | `user_id`, `name`, `raw_text`, `detected_field`, `is_active` (partial unique index: only one active per user), `source_file_path` |
| `cv_bullets` | `cv_version_id`, `section_path` (e.g. `"Experience > Acme > Backend Engineer"`), `bullet_text`, `ordinal` |
| `bullet_gaps` | `bullet_id`, `question`, `rationale`, `ordinal` (1..5, unique per bullet), `status` (`open` \| `answered` \| `skipped`) |
| `bullet_artifacts` | `gap_id`, `source_type` (`text` \| `file` \| `url` \| `jit_clarification`), `content_text`, `source_url`, `source_file_path`, `summary_json` |

One additive change to an existing table:
```sql
alter table interview_sessions
  add column if not exists cv_version_id uuid references cv_versions(id) on delete set null;
```

DBML mirrors live in [supabase/migrations/schema.dbml](../supabase/migrations/schema.dbml) — paste into https://dbdiagram.io/d to visualize.

## Backend changes (Fastify)

The backend now talks to Supabase. New environment variables in [backend/.env.example](../backend/.env.example):

```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
MVP_USER_ID=00000000-0000-0000-0000-000000000000
```

`MVP_USER_ID` is the placeholder user — there's no auth yet, so all CVs belong to this hardcoded UUID (matches the seeded MVP user in `001_create_tables.sql`).

New dependency: `@supabase/supabase-js` (already hoisted in the workspace root).

### New files

| File | Purpose |
|---|---|
| [backend/src/lib/supabase.ts](../backend/src/lib/supabase.ts) | Server-side Supabase client (service-role key, RLS bypassed) + `getMvpUserId()` |
| [backend/src/types/cv-knowledge.ts](../backend/src/types/cv-knowledge.ts) | Row types, `CvVersionSummary`, `BulletWithGaps`, `CoachAnswerRequest/Response`, `MissingEvidencePrompt`, `ArtifactSummary` |
| [backend/src/lib/cv-knowledge/prompts.ts](../backend/src/lib/cv-knowledge/prompts.ts) | All prompt builders: bullet extraction, gap generation (field-aware), artifact summarize-with-quotes, bullet relevance ranking, coach-answer (constrained "no invention" prompt with placeholder format) |
| [backend/src/services/cv-knowledge.service.ts](../backend/src/services/cv-knowledge.service.ts) | Orchestrates Anthropic + Supabase. Functions listed below. |
| [backend/src/services/coach-answer.service.ts](../backend/src/services/coach-answer.service.ts) | Builds the evidence pool from the active CV and runs the constrained coach prompt |
| [backend/src/routes/cv-library.ts](../backend/src/routes/cv-library.ts) | REST surface for CV library |
| [backend/src/routes/coach-answer.ts](../backend/src/routes/coach-answer.ts) | `POST /api/interview/coach-answer` |

### Modified files

- [backend/src/main.ts](../backend/src/main.ts) — registers the two new route bundles
- [backend/package.json](../backend/package.json) — adds `@supabase/supabase-js`
- [backend/.env.example](../backend/.env.example) — adds `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `MVP_USER_ID`

### `cv-knowledge.service.ts` exports

| Function | What it does |
|---|---|
| `createCvVersionFromFile(name, buffer, fileName)` | Reuses [outreach-extractor.service.ts](../backend/src/services/outreach-extractor.service.ts)'s `extractTextFromFile`, then delegates to `createCvVersionFromText`. |
| `createCvVersionFromText({ name, rawText, sourceFilePath? })` | Inserts `cv_versions` row → calls LLM to extract bullets + detect field → inserts `cv_bullets` → loops over bullets and calls LLM to generate ≤5 `bullet_gaps` per bullet. Returns `{ cvVersionId, bulletCount, gapCount }`. Synchronous; expect 20–60s depending on CV length. |
| `listCvVersions()` | Returns `CvVersionSummary[]` with bullet count and open-gap count. |
| `activateCvVersion(id)` | Clears any existing active CV for the user, then sets this one active. (Two-step to avoid the partial unique index conflict.) |
| `deleteCvVersion(id)` | Cascade-deletes bullets/gaps/artifacts via FK `on delete cascade`. |
| `getActiveCvVersion()` | Used by the coach to find which CV to ground against. |
| `listBulletsWithGaps(cvVersionId)` | Returns bullets nested with their gaps and existing artifacts. Drives the intake UI. |
| `addArtifactToGap(gapId, payload)` | Accepts `text`, `file`, `url`, or `jit_clarification`. URL/file paths reuse the existing Jina/PDF/DOCX extractors. Then runs the **summarize-with-quotes** LLM pass biased toward the gap question, producing `summary_json: { overview, my_contribution, concrete_facts[], metrics[] }`. Marks the gap `answered`. Short text (≤80 chars, e.g. JIT one-liners) skips the LLM summary and stores the literal text as a single fact. |
| `skipGap(gapId)` | Marks the gap `skipped`. |
| `recordJitClarification({ bulletId, question, answer })` | Finds or creates a gap on the bullet, then writes the answer as a `bullet_artifacts` row with `source_type='jit_clarification'`. If `bulletId` is null/`'none'`, the call is a no-op (v1 doesn't keep a "loose facts" pool). |
| `getRelevantBulletsForQuestion(cvVersionId, question)` | Lists all bullets, then asks the LLM to pick 1–3 most relevant to the interview question. Falls back to "first 3 bullets" if the call fails. CVs with ≤4 bullets skip the LLM call and return everything. |
| `getArtifactsForBullets(bulletIds)` | Returns a `Map<bulletId, ArtifactSummary[]>` for the coach to consume. |

### `coach-answer.service.ts`

Single export `coachAnswer(req: CoachAnswerRequest): Promise<CoachAnswerResponse>`. Steps:

1. Resolve CV version: explicit `cvVersionId` from the request → otherwise the active CV → otherwise none.
2. If a CV exists, pull all bullets (for the prompt's "CV BULLETS:" section), then call `getRelevantBulletsForQuestion` + `getArtifactsForBullets` to build an evidence pool.
3. Build the coach prompt via `buildCoachAnswerPrompt`. The system prompt forbids invention and instructs the model to emit `[CANDIDATE TO FILL: <bulletId>|<short question>]` placeholders for any missing facts.
4. Parse the JSON response. If the model forgot to populate `missingEvidencePrompts`, scan the rewritten text with a regex to recover them. Decorate each prompt with `bulletText` for the UI.

### REST routes

CV library — registered in `cv-library.ts`:

| Method | Path | Purpose |
|---|---|---|
| `GET`    | `/api/cv-library/versions` | List the user's CVs |
| `POST`   | `/api/cv-library/versions` | Multipart `file + name` (or JSON `{ name, rawText }`); creates the version + extracts bullets + generates gaps |
| `POST`   | `/api/cv-library/versions/:id/activate` | Mark active |
| `DELETE` | `/api/cv-library/versions/:id` | Cascade-delete |
| `GET`    | `/api/cv-library/versions/:id/bullets` | Bullets nested with gaps and artifacts (drives intake UI) |
| `POST`   | `/api/cv-library/gaps/:gapId/artifacts` | Multipart with `file`, or JSON `{ text }` / `{ url }` |
| `POST`   | `/api/cv-library/gaps/:gapId/skip` | Mark gap skipped |
| `POST`   | `/api/cv-library/jit-clarification` | `{ bulletId, question, answer }` — JIT writeback during an interview |

Coach — registered in `coach-answer.ts`:

| Method | Path | Body |
|---|---|---|
| `POST` | `/api/interview/coach-answer` | `{ question, answer, context: { jobTitle, jobDescription, companyName }, cvVersionId?, irsScore? }` → `{ critique, improvedAnswer, missingEvidencePrompts[] }` |

## Frontend changes (Next.js)

### New page

- [app/cv-library/page.tsx](../app/cv-library/page.tsx) — entry, renders `<CvLibraryScreen />`
- [features/cv-library/components/cv-library-screen.tsx](../features/cv-library/components/cv-library-screen.tsx) — full UI:
  - **Upload card**: name input + PDF/DOCX file picker; shows progress while parsing
  - **Versions list**: per-CV card with detected field tag, "X bullets · Y gaps remaining", an "Active" badge, "Make active" / Delete buttons
  - **Detail view**: bullets grouped under their `section_path`. Each bullet shows its 5 gaps as numbered yellow chips with a 3-mode form (text / url / file), Save and Skip buttons, and answered/skipped state styling. Existing artifacts show as ✓ chips above the form.
  - Progress counter "X of Y gaps filled" at the top.

### Navigation

- [shared/types/navigation.ts](../shared/types/navigation.ts) — added `'cv-library'` to `ViewName`
- [shared/config/navigation.ts](../shared/config/navigation.ts) — added a `{ label: 'CV Library', view: 'cv-library', href: '/cv-library' }` entry between CV Optimizer and Interview Prep

### Next.js proxies (thin pass-throughs to Fastify)

| File | Routes |
|---|---|
| [app/api/cv-library/versions/route.ts](../app/api/cv-library/versions/route.ts) | `GET`, `POST` (multipart) |
| [app/api/cv-library/versions/[id]/route.ts](../app/api/cv-library/versions/[id]/route.ts) | `DELETE` |
| [app/api/cv-library/versions/[id]/activate/route.ts](../app/api/cv-library/versions/[id]/activate/route.ts) | `POST` |
| [app/api/cv-library/versions/[id]/bullets/route.ts](../app/api/cv-library/versions/[id]/bullets/route.ts) | `GET` |
| [app/api/cv-library/gaps/[gapId]/artifacts/route.ts](../app/api/cv-library/gaps/[gapId]/artifacts/route.ts) | `POST` (multipart or JSON) |
| [app/api/cv-library/gaps/[gapId]/skip/route.ts](../app/api/cv-library/gaps/[gapId]/skip/route.ts) | `POST` |
| [app/api/cv-library/jit-clarification/route.ts](../app/api/cv-library/jit-clarification/route.ts) | `POST` |
| [app/api/interview/coach-answer/route.ts](../app/api/interview/coach-answer/route.ts) | `POST` |

### Backend client helpers

In [shared/api/backend-client.ts](../shared/api/backend-client.ts):

- `listCvVersionsWithBackend()`, `uploadCvFileWithBackend(formData)`
- `activateCvVersionWithBackend(id)`, `deleteCvVersionWithBackend(id)`
- `getCvBulletsWithBackend(id)`
- `addGapArtifactWithBackend(gapId, { text|url })`, `addGapArtifactFileWithBackend(gapId, formData)`
- `skipGapWithBackend(gapId)`, `jitClarificationWithBackend({ bulletId, question, answer })`
- `coachAnswerWithBackend({ question, answer, context, cvVersionId?, irsScore? })`

Plus exported types: `CvVersionSummary`, `BulletWithGaps`, `MissingEvidencePrompt`, `CoachAnswerResponse`.

### Interview prep changes

- [features/interview-prep/types.ts](../features/interview-prep/types.ts) — added `CoachResult`, `MissingEvidencePrompt`. Extended `InterviewMessage` with optional `coach?: CoachResult` and `questionAsked?: string` (the interviewer question this candidate message answered).
- [hooks/use-interview.ts](../hooks/use-interview.ts):
  - `sendMessage` now records `questionAsked` on each scored candidate message.
  - New `requestCoach(messageId)` — POSTs to `/api/interview/coach-answer` and stores the result on the message.
  - New `submitJitClarification(messageId, promptIndex, answer)` — POSTs to `/api/cv-library/jit-clarification`, then re-runs the coach so the resolved placeholder disappears.
  - Both are returned from the hook.
- [features/interview-prep/components/interview-prep-screen.tsx](../features/interview-prep/components/interview-prep-screen.tsx):
  - `InterviewStepView` now takes `onRequestCoach` and `onSubmitJit` props.
  - New `CoachPanel` component renders below each candidate message: a **See enhanced version** button that lazy-loads the coach call, and a collapsible card showing the critique + improved answer.
  - New `renderImproved(text)` highlights `[CANDIDATE TO FILL:...]` placeholders as yellow inline chips.
  - New `JitForm` renders one inline form per `missingEvidencePrompts` entry — type an answer and the JIT writeback fires.

## How to run it end-to-end

1. **Install** new deps if you haven't yet:
   ```
   npm install --workspace backend
   ```
2. **Apply** the migration in Supabase SQL Editor:
   ```
   supabase/migrations/002_cv_knowledge_base.sql
   ```
3. **Configure** [backend/.env](../backend/.env):
   ```
   SUPABASE_URL=https://<project>.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
   MVP_USER_ID=00000000-0000-0000-0000-000000000000
   ```
4. **Restart** backend (`npm run dev:backend`) and frontend (`npm run dev`).
5. Open the app, click **CV Library** in the top nav, upload a PDF/DOCX and name it. Wait for parsing (20–60s).
6. Fill in some gaps for one or two bullets — text is fine.
7. Mark that CV **active**.
8. Open **Interview Prep**, run a session, click **See enhanced version** under any answered question. Confirm the rewrite is grounded in the artifacts you supplied. Yellow placeholders should appear for anything still missing — fill one inline and watch it disappear on the next coach run.

## Verification checklist

- **Bullet extraction** preserves `section_path` and produces sensible bullet count.
- Each bullet has up to 5 gaps; gaps look field-appropriate.
- **Persistence**: refresh the CV detail page after filling some gaps → state survives.
- **Multi-CV**: upload two CVs, mark CV-A active, run a session → coach pulls CV-A's evidence. Switch to CV-B, run another session → coach uses CV-B.
- **Knowledge reuse**: a fact filled in one session shows up in a *new* session's enhanced answer for a related question, without re-asking.
- **JIT writeback**: trigger a `[CANDIDATE TO FILL]`, fill the inline form, check Supabase for a new `bullet_artifacts` row with `source_type='jit_clarification'` and the parent gap flipped to `answered`.
- **Cascade delete**: deleting a CV version removes its bullets/gaps/artifacts but leaves other CVs untouched.

## Out of scope for this MVP

- More than 5 gaps per initial extraction (JIT-clarification can add more later).
- Embedding-based retrieval — `getRelevantBulletsForQuestion` uses an LLM rank call. Swap to vector retrieval when CVs grow large.
- Editing bullet text or section paths after extraction — re-upload the CV instead.
- True PII redaction.
- A version picker in the interview-prep SetupStep — the coach silently uses the active CV. The existing `cvText` textarea still drives the live IRS scoring + final report unchanged.
- Cross-user knowledge sharing.
- Field-specific intake templates (Strategy 3 from the original plan) — current intake is uniform across tech/business/marketing. Field detection is stored in `cv_versions.detected_field` and biases the gap-generation prompt, but the UI doesn't yet swap templates.

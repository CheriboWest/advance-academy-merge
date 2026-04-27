# Interview Prep — Feature Workflow

End-to-end map of the Interview Prep feature: session lifecycle, LLM call sites, persistence, voice mode, and the prompt-caching strategy.

For the broader 4-layer architecture this feature sits inside, see [ARCHITECTURE.md](./ARCHITECTURE.md). For backend conventions, see [BACKEND.md](./BACKEND.md).

---

## What it does

A user uploads (or pastes) their CV and a job description, picks one of five interviewer personas (Skeptic, Mentor, Executive, Technical, Culture-fit), and runs a 5–6 turn mock interview. Every candidate answer is scored on the **IRS rubric** (Integrity, Relevance, Substance) in real time. After the final turn, a feedback engine produces 3 strengths + 3 improvements + a summary.

Voice mode is supported: the candidate's spoken answer is captured client-side and transcribed via Groq Whisper before being fed into the same text-based interviewer loop.

---

## The 4-layer request flow

Standard project shape (see [ARCHITECTURE.md](./ARCHITECTURE.md)):

```
features/interview-prep/components/interview-prep-screen.tsx
  → app/api/interview/route.ts                     (Next.js proxy, validates body)
  → backend/src/routes/interview.ts                (Fastify thin handler)
  → backend/src/services/interview.service.ts      (orchestration + LLM)
  → Anthropic SDK
```

Two route files exist at every layer — keep them straight when adding endpoints:

| Surface | Route file | Owns |
|---|---|---|
| Live interview turn loop | [`backend/src/routes/interview.ts`](../backend/src/routes/interview.ts) | `POST /api/interview` (start + message), `POST /api/evaluate`, `GET /api/interview/sessions[/:id]`, `POST /api/interview/transcribe` |
| Prep-session helpers | [`backend/src/routes/interview-prep.ts`](../backend/src/routes/interview-prep.ts) | `POST /api/interview-prep/extract-job-from-url` |

`POST /api/interview` is a single endpoint that branches on `body.action` (`'start'` vs `'message'`) — it mirrors the legacy client contract from before the Fastify migration. New endpoints should be separate routes.

---

## Session lifecycle

```
            ┌──────────────────────────────────────────────────────────┐
            │  Client builds InterviewContext { jobTitle, companyName, │
            │  jobDescription, cvText, extraLinks, companyUrl }        │
            └────────────────────┬─────────────────────────────────────┘
                                 │
           POST /api/interview { action: 'start', personaId, context }
                                 ▼
            ┌──────────────────────────────────────────────┐
            │ startInterviewSession()                      │
            │  - LLM call #1: opening question             │
            │  - dbStartSession + dbStoreQuestion          │
            │  → { sessionId, openingQuestion, dbSessionId}│
            └────────────────────┬─────────────────────────┘
                                 │
                          (loop 5–6×)
                                 │
           POST /api/interview { action: 'message', personaId,
                                 content, messageHistory, context, dbSessionId }
                                 ▼
            ┌──────────────────────────────────────────────┐
            │ sendInterviewMessage()                       │
            │  - LLM call #2: scoreAnswer (IRS rubric)     │
            │  - dbStoreQuestion + dbStoreAssessment       │
            │  - LLM call #3: interviewer reply            │
            │  → { reply, irsScore, isComplete }           │
            └────────────────────┬─────────────────────────┘
                                 │
                       (when isComplete = true)
                                 ▼
                POST /api/evaluate { session, dbSessionId }
                                 │
            ┌────────────────────▼─────────────────────────┐
            │ evaluateInterview()                          │
            │  - dbUpdateSessionStatus(evaluating)         │
            │  - LLM call #4: generateFeedbackReport       │
            │  - dbCompleteSession(report)                 │
            │  → { report }                                │
            └──────────────────────────────────────────────┘
```

`isLastTurn` triggers when `candidateTurnCount >= 5` ([interview.service.ts:121](../backend/src/services/interview.service.ts#L121)). On that turn the system prompt gets a "this is the final exchange" addendum so the LLM wraps up gracefully.

---

## The four LLM call sites

Every call uses the `interviewPrep` LLM feature config ([backend/src/config/llm.ts:7](../backend/src/config/llm.ts#L7)) — model is overridable via `LLM_MODEL_INTERVIEW_PREP`, API key via `LLM_API_KEY_INTERVIEW`. Default model is the project-wide default (currently `claude-sonnet-4-20250514` = Sonnet 4.0).

| # | Site | Function | Per-session frequency | What's repeated |
|---|---|---|---|---|
| 1 | Opening question | [`startInterviewSession`](../backend/src/services/interview.service.ts#L46) | 1× | persona prompt + JD + CV |
| 2 | Per-turn IRS score | [`scoreAnswer`](../backend/src/lib/interview-prep/irs-scoring.ts#L34) | 5–6× | IRS rubric prompt (~280 tok) + JD + CV |
| 3 | Per-turn interviewer reply | [`sendInterviewMessage`](../backend/src/services/interview.service.ts#L89) | 5–6× | persona prompt + JD + CV + growing history |
| 4 | Final feedback | [`generateFeedbackReport`](../backend/src/services/feedback-engine.service.ts#L32) | 1× | Feedback rubric prompt (~250 tok), full transcript |

The repeated content for sites 1 + 3 is the **same** static prefix:

```
persona.systemPrompt           // ~150–200 tokens (depends on persona)
+ "\n\n"
+ buildContextPreamble(ctx)    // JD + CV(sliced to 12K chars) ≈ 3000–5500 tokens
                               // = ~3500–5700 tokens of cacheable prefix
```

`buildContextPreamble` is rebuilt as a string each call ([interview.service.ts:22](../backend/src/services/interview.service.ts#L22-L44)) but the bytes are identical because `body.context` is byte-stable across turns from the client.

---

## Prompt caching strategy

**Goal:** avoid re-paying for the ~3500–5700 tokens of persona+JD+CV context that's sent unchanged on every interviewer turn.

**Applied to:** [`startInterviewSession`](../backend/src/services/interview.service.ts#L46) and [`sendInterviewMessage`](../backend/src/services/interview.service.ts#L89).

**Pattern (multi-turn, two breakpoints, 1-hour TTL):**

```ts
system: [
  { type: 'text', text: persona + contextPreamble, cache_control: {type:'ephemeral', ttl:'1h'} },
  // optional: trailing addendum (e.g., "this is the final exchange") — uncached
],
messages: [
  ...history,
  // last assistant message gets cache_control on its content block
],
```

| Breakpoint | What it caches | When it's read |
|---|---|---|
| #1 — system block | persona prompt + JD + CV | Every turn after the first (across `start` and all `message` calls in the same session) |
| #2 — last assistant message | Conversation history up to that point | Each new turn reads the previous turn's cumulative prefix |

**Why these specific choices:**

- **1-hour TTL** — Interview sessions can take 5–15 minutes (LLM ~2s + user thinking + typing). The 5-min default would expire mid-session for slow users. Costs 2× to write but reads at ~0.1×.
- **Split system into two text blocks** instead of accepting a cache miss on the final turn. The `[IMPORTANT: This is the final exchange]` addendum becomes a second uncached system block, leaving the cached static prefix byte-stable across all turns including the last.
- **Multi-turn message caching** (breakpoint #2) — Each new turn extends the conversation by one user + one assistant message. Without this breakpoint, the entire growing message history would be re-processed every turn.

**Verifying it's working:** every cached call logs to the backend console:

```
[interview-prep:start] cache_read=0    cache_write=4123 input=42  output=...
[interview-prep:turn]  cache_read=4123 cache_write=87   input=12  output=...
[interview-prep:turn]  cache_read=4210 cache_write=92   input=14  output=...
```

Turn 1 writes the cache (read=0). Turn 2+ should show `cache_read` ≈ the prior `cache_write` total. If `cache_read` stays at 0 across turns, a silent invalidator is in play — most likely `body.context` differs byte-for-byte between client requests (e.g., the client rebuilt `cvText` with whitespace differences, or appended a timestamp). Diff the rendered system prompt across two consecutive requests.

**Sonnet 4.0 caching limits to remember:**
- Min cacheable prefix: **1024 tokens** (our prefix is ~3500–5700, well above).
- Max **4 `cache_control` breakpoints per request** (we use 2).
- 20-block message lookback window for breakpoint #2 (a 6-turn session has ~12 message blocks, well under 20).
- Caches are **model-scoped** — if you migrate to Sonnet 4.6/4.7 the cache rebuilds on the first post-migration request.

**Why the IRS scorer (#2) and feedback engine (#4) are NOT cached:**

- `scoreAnswer` could in principle benefit (the JD+CV prefix is the same across the 5–6 calls in a session), but the JD+CV is currently in the **user message**, not the system block — caching would require restructuring to pull it into a cached system prefix. Possible future optimization.
- `generateFeedbackReport` is a single one-shot call per session and its system prompt is sub-1024 tokens (~250 tok). A `cache_control` marker would silently no-op (below the minimum prefix) or pay the 2× write premium for a cache that's never read.

---

## Persistence

Backed by Supabase Postgres ([backend/src/lib/interview-prep/db.ts](../backend/src/lib/interview-prep/db.ts)). Tables (see migrations [`001_create_tables.sql`](../supabase/migrations/001_create_tables.sql), [`006_auth_user_sync.sql`](../supabase/migrations/006_auth_user_sync.sql)):

| Table | Stores |
|---|---|
| `interview_sessions` | One row per session — userId, personaId, JD/CV context, status (`active` → `evaluating` → `completed`), final IRS, full feedback report JSON |
| `interview_questions` | Each interviewer question issued in the session |
| `interview_assessments` | One row per candidate answer — links question → answer text + IRS sub-scores |

Persistence is **write-through**: routes call `dbStoreQuestion` / `dbStoreAssessment` inline as the session runs, so the DB is the source of truth even if the client crashes mid-session. The client-side `sessionId` (`session_${Date.now()}_…`) and the DB `dbSessionId` are different identifiers — both are returned from `start` and the client must thread the `dbSessionId` back on every subsequent call.

---

## Voice mode

`POST /api/interview/transcribe` accepts a 25 MB-cap multipart audio upload (`webm` / `mp3` / `wav` / `m4a` / `ogg` / `mp4` / `mpeg` / `mpga`) and returns transcribed text. Implementation uses Groq Whisper via [`transcribeAudio()`](../backend/src/services/transcription.service.ts) (requires `GROQ_API_KEY`).

The route is registered inside a scoped Fastify plugin so `@fastify/multipart` only applies to that one endpoint ([interview.ts:70-118](../backend/src/routes/interview.ts#L70-L118)) — the rest of the interview routes stay JSON-only.

Once transcribed, the text is sent through the normal `POST /api/interview { action: 'message' }` flow — voice and text candidates take the same code path through `sendInterviewMessage`.

---

## Authentication

Standard project pattern. The Fastify `preHandler` hook in [`backend/src/main.ts`](../backend/src/main.ts) validates the bearer token and attaches `request.userId`. All Interview Prep routes use it; only `dbStartSession` reads `userId` to scope sessions to the authenticated user.

---

## Adding a new persona

1. Append to `PERSONAS` in [backend/src/lib/interview-prep/personas.ts](../backend/src/lib/interview-prep/personas.ts).
2. Add the new id to the `PersonaId` union in `backend/src/types/interview-prep.ts`.
3. The frontend persona-picker reads from this list directly — no FE-side allowlist to update.

Caching automatically applies to the new persona since the cache key is derived from the rendered system prompt bytes — no breakpoint config needed.

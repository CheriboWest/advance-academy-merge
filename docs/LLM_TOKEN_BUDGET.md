# LLM Token Budget — Interview Prep & CV Library

Reference for sizing `max_tokens`, understanding input-token footprints, and measuring real output ranges. Scope: Interview Prep and CV Library. Interview generation uses `LLM_MODEL_INTERVIEW_PREP`; IRS scoring can use `LLM_MODEL_INTERVIEW_SCORING` and falls back to the Interview Prep model.

Token conversion used throughout: **4 chars ≈ 1 token** for English text. Actual counts vary ±20%; run the measurement plan at the bottom to pin them down.

---

## 1. Prompt-caching status — ENABLED FOR LIVE INTERVIEWS

Interview opening and next-question calls cache the byte-stable persona + CV/JD prefix for one hour. Each next-question call also places a breakpoint on the last assistant turn so the growing conversation prefix can be reused.

- **IRS scoring:** the rubric + CV/JD context is now a cached one-hour system prefix; the current question and answer remain uncached. Cache minimums differ by model, so use the emitted `cacheReadTokens` / `cacheWriteTokens` telemetry to verify hits.
- **Final feedback:** remains uncached because it is one call per session.
- **CV Library and Coach Answer:** are unchanged and should be evaluated separately before adding cache writes.

The backend emits structured `interview-prep.start`, `.turn`, `.irs`, `.feedback`, and `.evaluate` telemetry with latency, token, prompt-size, and cache fields. Logs intentionally exclude prompt text.

Docs: https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching

---

## 2. Input composition per user action

Columns: **what goes in the call**, **where its size comes from**, **typical input tokens**, **what caps it**, and a **suggested `max_tokens` for output** (based on what the prompt actually asks the model to return).

### Interview Prep

| # | User action | What's in the input | Sources | Typ. input tok | Hard cap on input | Current `max_tokens` | Recommended `max_tokens` |
|---|---|---|---|---|---|---|---|
| IP-1 | Click **Start Interview** | Persona system prompt + context preamble (JD verbatim + CV sliced to **12,000 chars**) + 1 short user message ("begin the interview…") | [interview.service.ts:22-43](../backend/src/services/interview.service.ts#L22) `buildContextPreamble`; persona from [personas.ts](../backend/src/lib/interview-prep/personas.ts) | 2,500 – 5,500 | CV 12k chars ≈ 3,000 tok; JD free-form (no cap) | **256** | 256 is fine — opening question is ≤3 sentences |
| IP-2 | **IRS scoring** (runs concurrently with next-question generation) | Cached IRS system/context prefix + current question + answer | [irs-scoring.ts](../backend/src/lib/interview-prep/irs-scoring.ts) | 2,500 – 4,000 | CV 8k chars ≈ 2,000 tok | **384** | 384; output is fixed-shape JSON |
| IP-3 | **Generate next question** (same click as IP-2) | Persona + full context preamble (JD + CV 12k chars) + entire message history (grows per turn) + new candidate answer + optional "final turn" addendum | interview.service.ts:111-131 | Turn 1: ~4,000 · Turn 5: ~6,500 | Message history unbounded | **300** | 300 is fine — each question is 1–3 sentences |
| IP-4 | **End interview → feedback report** | Feedback system prompt (~400 tok) + JD + company + full transcript (all Q/A with IRS tags) + aggregate IRS | [feedback-engine.service.ts:37-54](../backend/src/services/feedback-engine.service.ts#L37) | 2,000 – 6,000 | Transcript grows with turn count | **1,024** | 1,024 is fine — output is 3 strengths + 3 improvements + 2-3 sentence summary. Measured typical: ~500–800 tok |
| IP-5 | **Voice mode submit** (optional) | Audio blob via Groq Whisper `whisper-large-v3-turbo` — not Claude. | [transcription.service.ts](../backend/src/services/transcription.service.ts) | N/A (audio) | 25 MB file | N/A | N/A — billed per second of audio |

### CV Library

| # | User action | What's in the input | Sources | Typ. input tok | Hard cap on input | Current `max_tokens` | Recommended `max_tokens` |
|---|---|---|---|---|---|---|---|
| CV-1 | **Upload CV (Phase 1 — parse bullets)** | Bullet-extraction prompt (~200 tok) + **full raw CV text unsliced** | [prompts.ts:3](../backend/src/lib/cv-knowledge/prompts.ts#L3) `buildBulletExtractionPrompt` | 1,500 – 8,000 (1–4 page CV) | **No slice** — dangerous for very long CVs (10+ pages). Should add a safety cap around 25k chars. | **4,096** | 4,096 is appropriate — output is a JSON array of 20–40 bullets (~30 tok each) ≈ 600–1,500 tok. Could tighten to 3,000. |
| CV-2 | **Phase 1 — similarity search per parsed bullet** (Voyage, not Claude) | Single bullet text (`input_type: 'query'`) | [voyage.ts:60](../backend/src/lib/voyage.ts#L60) `embedText` | ~15 tokens × **N bullets (1 call each)** | Bullet text ~30–60 tok | N/A | N/A — Voyage has no `max_tokens` |
| CV-3 | **Phase 2 — generate gaps** (1 Claude call per NEW bullet, looped) | Gap prompt (~200 tok) + field hint + section path + bullet text | [prompts.ts:27](../backend/src/lib/cv-knowledge/prompts.ts#L27) `buildGapPrompt` | ~300 per call | Bullet text only | **4,096** | **768** is plenty — output is exactly 5 gaps × (~30 tok question + ~40 tok rationale) ≈ 350–450 tok. Big savings on failed-fast behaviour. |
| CV-4 | **Phase 2 — batch embed new bullets** (Voyage) | N new bullet texts in one call (`input_type: 'document'`) | [voyage.ts:25](../backend/src/lib/voyage.ts#L25) `embedTexts` | ~20 tok × N, batched | — | N/A | N/A |
| CV-5 | **Submit an artifact** (text ≥80 chars, URL after Jina fetch, or file after parse) | Summary prompt (~300 tok) + gap question + artifact text **sliced to 15,000 chars** | [prompts.ts:60](../backend/src/lib/cv-knowledge/prompts.ts#L60) `buildArtifactSummaryPrompt` | 500 – 4,000 | Slice at 15k chars ≈ 3,750 tok | **4,096** | **1,024** — output is `{ overview, my_contribution, concrete_facts[5-10], metrics[5-10] }` ≈ 300–600 tok. |
| CV-6 | **Click "Merge" on a bullet** | Voyage only: embed the source bullet | voyage.ts | ~15 tok | — | N/A | N/A |
| CV-7 | **Confirm merge of 2 bullets** | Zero API calls — DB re-parent only | cv-knowledge.service.ts `mergeBullets` | 0 | — | — | — |
| CV-8 | **"See enhanced version" — step A: rank relevant bullets** (skipped if pool <5) | Ranking prompt (~150 tok) + interview question + **entire user bullet pool** ("- [id] (section) text" per line) | [prompts.ts:84](../backend/src/lib/cv-knowledge/prompts.ts#L84) `buildBulletRelevancePrompt` | 500 – 3,500 (grows linearly with pool) | No cap — at 200 bullets, ~8k tokens | **4,096** | **256** — output is `{ "bulletIds": ["...", "...", "..."] }` ≈ 50–120 tok. Current 4,096 is wildly overprovisioned. |
| CV-9 | **"See enhanced version" — step B: rewrite** | Coach system prompt (~400 tok, strict) + JD + company + **ALL user CV bullets** (line per bullet) + **top 1–3 evidence blocks** (bullet + its artifact summaries) + interview question + candidate's original answer | [prompts.ts:113](../backend/src/lib/cv-knowledge/prompts.ts#L113) `buildCoachAnswerPrompt` | 3,000 – 8,000 | Pool grows unbounded; evidence blocks capped at 3 bullets × ~4 artifacts | **2,048** | 2,048 OK — improved answer is typically 200–600 tok + critique + placeholders list. 1,536 would be tighter. |
| CV-10 | **Submit JIT clarification** (fill a yellow chip) | Same as CV-5 (artifact summary) for writeback + the frontend re-runs CV-8 + CV-9 | cv-knowledge.service.ts `recordJitClarification` → `addArtifactToGap` | 500 – 4,000 + (coach re-run) | — | 4,096 | Same as CV-5: 1,024 |
| CV-11 | **Click "Get AI Coach's Understanding"** | Coach-understanding system prompt (~500 tok) + **every bullet + every gap (tagged answered/skipped/open) + artifact excerpts truncated to 500 chars each** for the entire user pool | [coach-understanding.service.ts:60-80](../backend/src/services/coach-understanding.service.ts#L60) `buildUserPrompt` | 3,000 – 50,000+ | **No cap anywhere.** At 60 bullets × 5 gaps × 2 artifacts × 500 chars ≈ 75k tok. Real risk of 200k context overflow. | **4,096** | 4,096 is appropriate for the 5-section report but **add an input cap** — e.g. truncate at 80k tok with a "…older bullets truncated" note, or paginate by section_path |
| CV-12 | **One-shot backfill embeddings** (admin) | Up to 128 bullet texts, batched | cv-knowledge.service.ts `backfillEmbeddings` | ~20 tok × up to 128 | — | N/A | N/A |

### Suggested `max_tokens` changes — summary

Current total "output token budget we're paying to reserve" across a full interview + typical CV upload ≈ huge overprovisioning. Actual output usage is far smaller. Pricing isn't affected by unused output capacity, **but** overly-large `max_tokens` hides latency creep and lets the model ramble when JSON parsing later fails. Tighter caps = faster failures.

Biggest wins:
- CV-8 (rank bullets): **4,096 → 256** (16× tighter)
- CV-3 (gap gen): **4,096 → 768** (5× tighter)
- CV-5 / CV-10 (artifact summary): **4,096 → 1,024** (4× tighter)
- IP-2 (IRS): **384** (implemented)

---

## 3. Known missing input caps (to fix before a real user hits them)

| Action | Missing cap | What could break |
|---|---|---|
| CV-1 | Raw CV text is sent unsliced | A 30-page academic CV would inflate input past 20k tok, spike latency |
| CV-8 / CV-9 | Entire user bullet pool is inlined | A user with 200+ bullets blows up every coach click |
| CV-11 | Entire bullet pool + all gaps + all artifacts (500-char excerpt each) | At ~60 bullets this is already ~40k tok; 200 bullets ≈ Claude's 200k window |
| IP-3 | Full message history is sent each turn, uncapped | Not a real risk today (5-turn cap) but if turn count grows, this blows up |

For CV-11 specifically, consider switching to a map-reduce: one call per section_path group, then a final summarizer. Keeps each call bounded.

---

## 4. Plan to measure real output-token ranges

Goal: turn the "typical ~500–800 tok" estimates above into actual distributions you can size `max_tokens` against.

### 4.1 Add a one-time telemetry hook (10-line change)

In [backend/src/lib/llm-anthropic.ts](../backend/src/lib/llm-anthropic.ts), wrap `messages.create` with a helper that logs `response.usage` (which the SDK returns — Anthropic already gives you `input_tokens` and `output_tokens` for every call, plus `cache_creation_input_tokens` / `cache_read_input_tokens` once caching is turned on).

```ts
// sketch
export async function measuredCreate(anthropic, params, label: string) {
  const res = await anthropic.messages.create(params);
  console.log(JSON.stringify({
    label,
    model: params.model,
    max_tokens: params.max_tokens,
    input_tokens: res.usage.input_tokens,
    output_tokens: res.usage.output_tokens,
    stop_reason: res.stop_reason, // 'end_turn' vs 'max_tokens' tells you if you capped it
    ts: Date.now(),
  }));
  return res;
}
```

Call it with a unique `label` per action (`'ip.start'`, `'ip.irs'`, `'ip.next_q'`, `'ip.feedback'`, `'cv.extract'`, `'cv.gap'`, `'cv.summary'`, `'cv.rank'`, `'cv.coach'`, `'cv.understanding'`). Pipe the Fastify stdout to a file during the test run.

### 4.2 Scripted exercise — run each action 10× with realistic variance

| Action | Inputs to vary | Target runs |
|---|---|---|
| IP-1 Start | 3 CVs (0.5 pg, 2 pg, 4 pg) × 2 JDs (short, long) × 2 personas | 12 runs |
| IP-2 IRS | 2 questions × 4 answer qualities (empty, vague, strong, verbose) | 8 runs |
| IP-3 Next Q | Same setup as IP-1, played through to 5 turns | 12 sessions → 60 next-Q calls |
| IP-4 Feedback | Reuse the 12 sessions from above | 12 runs |
| CV-1 Parse | 4 CVs (1 pg, 2 pg, 4 pg, academic 10 pg) | 4 runs |
| CV-3 Gap | 20 bullets spanning tech / business / marketing / ambiguous | 20 runs |
| CV-5 Artifact | 4 artifact types (50-char text, 2-page PDF, short URL, 15k-char doc) | 8 runs |
| CV-8 Rank | Pools of size 5, 20, 60, 150 bullets | 4 runs |
| CV-9 Coach | Cross with CV-8 pool sizes × 3 question types | 12 runs |
| CV-11 Understanding | Pools of 5, 30, 60 bullets, varying answered-gap density | 6 runs |

That's ~150 LLM calls total. At Sonnet 4 rates, rough bill for the test pass ≈ **$1–3**. Script it with `curl` hitting the Fastify port or from a small `node` runner calling the services directly.

### 4.3 Analysis

For each `label`, compute:

- p50, p95, p99 of `output_tokens`
- `% of calls where stop_reason === 'max_tokens'` — if non-zero, your cap is clipping real outputs
- p50, p95 of `input_tokens` to validate the estimates in section 2

Rule of thumb when setting `max_tokens`: **p99 output × 1.5**, rounded up to the next nice number. Anything above that, the model is degenerate or prompt is broken — fail fast, don't pay for more tokens.

### 4.4 Validate caching in production

Re-run the Interview Prep portion. Expect `cache_read_input_tokens` to be ~3,000+ on turns 2–5 of a session (the persona + CV preamble). Compute effective cost:
- Cache write: `cache_creation_input_tokens` × $3.75/M (Sonnet 4 rate is 1.25× base for writes)
- Cache read: `cache_read_input_tokens` × $0.30/M (10% of base)
- Non-cached input: normal rate

Full cache pricing details: https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching#pricing

---

## 5. What to change first

Ordered by ROI:

1. **Measure the new parallel turn path** at p50/p95 and confirm interviewer and IRS cache hits.
2. **Evaluate `LLM_MODEL_INTERVIEW_SCORING` candidates** on a human-reviewed answer set before changing production.
3. **Add an input cap to CV-11** (Coach Understanding).
4. **Tighten remaining CV Library output limits** per section 2.

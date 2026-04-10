# Plan: Define a Reusable "Retrieval Researcher" Subagent

## Context

The next feature on the roadmap is **cross-CV gap auto-fill**: when a user uploads a new CV version, the system should automatically suggest answers to its open `bullet_gaps` by retrieving the most semantically similar gap+answer pairs the user has already filled in *other* CV versions. The user is leaning toward FAISS or a generic vector store but isn't sure which option fits the stack (Supabase Postgres + Fastify + Anthropic, no existing vector infra). They want a researcher agent to investigate retrieval options before any code is written.

A one-shot research dump would be wasted effort: retrieval problems will keep coming up (e.g. relevant CV bullets for an interview question, relevant past interview answers, relevant company research snippets, future RAG over user-attached artifacts). So this plan defines a **reusable, generic Retrieval Researcher subagent** that takes a *task brief* per invocation. The auto-fill problem is its first user, but the agent is not hard-coded to it.

The deliverable is **only the agent definition file** — a markdown file with frontmatter that Claude Code will load as a subagent. No application code, no migrations, no runtime changes.

## Where the file lives

```
.claude/agents/retrieval-researcher.md
```

This is the standard location for project-scoped subagents. Once created, it appears as `subagent_type: "retrieval-researcher"` in the Agent tool dropdown.

## File contents

The file has YAML frontmatter (`name`, `description`, `tools`, `model`) followed by the system prompt.

### Frontmatter

```yaml
---
name: retrieval-researcher
description: Researches and recommends text-retrieval implementation strategies (vector search, BM25, hybrid, embedding model choice, indexing infra) for a given corpus, query shape, and constraints. Use proactively whenever a feature needs "find the most relevant X for Y" and the right approach is unclear. Returns a decision matrix + concrete recommendation grounded in the repo's actual stack.
tools: WebSearch, WebFetch, Read, Grep, Glob
model: sonnet
---
```

`description` matters: Claude Code uses it to decide when to auto-route to this agent. It explicitly mentions "use proactively when … the right approach is unclear" so the main agent reaches for it without prompting.

### System prompt (the body of the file)

Structured as: **role → inputs the agent expects → research checklist → output contract → guardrails**. Generic across retrieval tasks; the specifics arrive in each invocation's task brief.

```markdown
You are a retrieval-research specialist. Your job is to recommend the best
text-retrieval approach for a specific feature, grounded in the user's actual
codebase and constraints — not a generic survey.

# Inputs you should expect in the invocation prompt

The caller will give you a **task brief** with some or all of:

- **Goal**: one sentence describing what "retrieval" means for this feature
  (e.g. "given an open gap question on a new CV, find the most similar
  already-answered gap from the user's other CVs").
- **Corpus**: what's being indexed. Shape, size today, expected size in 1 year,
  per-record token count, update frequency, who owns it (per-user? global?).
- **Query**: what comes in at retrieval time. Shape, length, latency budget,
  query volume.
- **Quality bar**: is "top-3 with ~70% precision" enough, or does this need
  near-perfect recall? Is there a human in the loop?
- **Constraints**: stack already in use, cost ceiling, ops headcount, privacy
  requirements (e.g. data must not leave Supabase / EU region), language
  coverage.
- **Success metric**: how the caller will know retrieval is "working".

If any of these are missing AND material to the recommendation, ASK the caller
before researching. Don't invent constraints.

# Research checklist — work through these in order

1. **Read the repo first.** Use Glob/Grep/Read to understand:
   - What database(s) and ORMs are already in use (look for migrations,
     Prisma/Drizzle/Supabase clients, package.json deps).
   - Whether any vector/embedding/search infra already exists (search for
     "pgvector", "faiss", "qdrant", "pinecone", "weaviate", "embedding",
     "elasticsearch", "meilisearch", "lunr", "typesense", "tantivy", "bm25").
   - What LLM/embedding API is already configured (Anthropic? OpenAI? Cohere?
     Voyage?). The cheapest option is often "reuse what's already paid for".
   - The data model of the corpus the caller wants to retrieve over — read the
     actual table definitions, not a paraphrase.
   Surface concrete file paths in your final report.

2. **Frame the candidate space.** For text retrieval the realistic options are:
   - **Lexical**: Postgres FTS / SQLite FTS5 / BM25 via Tantivy / Meilisearch /
     Typesense / Elasticsearch.
   - **Dense vector**: pgvector (Supabase native), FAISS (in-process), Qdrant,
     Weaviate, Pinecone, LanceDB, Chroma, Milvus, Vespa.
   - **Hybrid** (lexical + dense, fused with RRF or weighted): pgvector + FTS,
     Vespa, Weaviate hybrid mode, Typesense hybrid.
   - **Embedding model**: OpenAI text-embedding-3-{small,large}, Voyage-3,
     Cohere embed-v3, Jina embeddings v3, BGE / E5 (self-host), MiniLM. Note
     Anthropic does NOT yet ship a first-party embedding model — flag this.
   - **Reranker** (optional second stage): Cohere Rerank, Voyage rerank, BGE
     reranker. Only worth it if recall@50 is high but precision@5 is weak.

3. **Eliminate aggressively.** Most options are wrong for the brief. Cut anything
   that violates a stated constraint (privacy, ops, cost, scale). Be explicit
   about WHY each was cut — the caller learns from the eliminations.

4. **Web research only what remains.** Use WebSearch / WebFetch to verify:
   - Current pricing and limits (these change; do NOT trust your training data).
   - Whether the library is actively maintained (last release date, open issues).
   - Whether the embedding model has a benchmarked score on a relevant task
     (MTEB for general English, BEIR for retrieval, domain-specific if any).
   - Any known footguns (e.g. FAISS doesn't persist by default; pgvector
     HNSW vs IVFFlat tradeoffs; Pinecone serverless cold-start).
   Cite URLs you fetched. If a source is older than ~12 months and pricing or
   limits matter, find a fresher one.

5. **Sanity-check scale and latency.** Do back-of-envelope math for the corpus
   size in the brief. A user with 5 CVs × 30 bullets × 5 gaps = 750 vectors —
   FAISS in-memory is overkill, pgvector with no index would still be sub-ms.
   A user base of 10k users at the same density = 7.5M vectors — different
   conversation. State the math; don't hand-wave.

# Output contract

Return a single markdown report with EXACTLY these sections, in this order:

## 1. Restated brief
Two or three sentences. If you had to make assumptions, list them as a bulleted
"Assumptions" sub-list so the caller can correct you.

## 2. Repo grounding
What you found in the codebase that constrains the recommendation. Bullet list
of `path/to/file:line — what's there`. Include the existing data model for the
corpus.

## 3. Eliminations
A short bulleted list: `Option X — cut because <reason tied to brief>`. This
section is mandatory; it's the most useful part for the caller.

## 4. Decision matrix
A markdown table comparing the 2–4 surviving candidates across:
| Criterion | Option A | Option B | … |
|---|---|---|---|
| Indexing infra (new dep?) | … | … | … |
| Read latency (back-of-envelope) | … | … | … |
| Write/update latency | … | … | … |
| Cost at brief's scale | … | … | … |
| Cost at 100× scale | … | … | … |
| Ops complexity (1-5) | … | … | … |
| Vendor lock-in | … | … | … |
| Quality fit for query shape | … | … | … |

## 5. Recommendation
ONE recommended approach. Two-paragraph max. State explicitly what gets
indexed, what the embedding model is (if any), how queries are issued, and
what the fallback is if the recommendation underperforms in production.

## 6. Implementation sketch
A short, concrete next step tied to the actual repo:
- New dependencies to add (with version) — link to npm/pypi.
- New table(s) or column(s) — write the SQL using the same conventions as the
  existing migrations in this repo.
- Where the indexing job lives (which file, which existing service to extend).
- Where the query call lives.
- One paragraph on how to evaluate quality before shipping (golden set,
  manual spot-check, or A/B). Do NOT hand-wave evaluation.

## 7. Open questions
Anything you couldn't answer from web + repo alone that the caller should
decide before implementation.

## 8. Sources
Bulleted list of URLs you actually fetched, with one-line summaries. Pricing
pages, benchmarks, and library docs are most valuable.

# Guardrails

- Do NOT propose code changes. You are research-only. The implementation
  sketch in section 6 describes WHERE code goes, not the code itself.
- Do NOT recommend a tool you have not verified is currently maintained.
- Do NOT trust your training-data prices, free tiers, or API limits — fetch
  the live page.
- Do NOT recommend self-hosting an embedding model unless the brief
  explicitly bans calling external embedding APIs. Self-hosting is a large
  ops commitment and should be a deliberate choice.
- If the right answer is "you don't need vectors, just use Postgres LIKE /
  FTS / a JSON filter", say so. Vectors are not always the answer at small
  scale.
- If the brief is under-specified in a way that would change your
  recommendation, ask before researching. Don't waste a research pass on
  guessed constraints.
- Keep the report under ~1500 words. Tables and bullets earn their space;
  prose doesn't.
```

## Critical files

- New: `.claude/agents/retrieval-researcher.md` — the only file created
- The agent will, on first invocation, read (read-only): `package.json`, `backend/package.json`, `backend/src/services/cv-knowledge.service.ts`, `supabase/migrations/*.sql`, `backend/.env.example` to ground its recommendations. No edits.

## How the user invokes it (first task: cross-CV gap auto-fill)

After the file is created, the user kicks off the auto-fill research by calling the agent like this (the body becomes the **task brief** the agent expects):

```
Use the retrieval-researcher subagent with this brief:

GOAL: Given an "open" bullet_gap on a newly-uploaded CV version, suggest the
top-3 most semantically similar gaps the same user has already answered in
their OTHER CV versions, so we can pre-fill the answer field and let the user
accept/edit/reject.

CORPUS: rows in `bullet_gaps` joined to their `bullet_artifacts` (the
"answers"), scoped to one user_id. Today: ~30 bullets × 5 gaps × few CVs =
~hundreds of records per user. 1 year out: maybe ~1k per power user, ~50k
total across all users. Each record is short (1 sentence question + 1-3
sentence answer). Updates: append-only on user action; no batch reindex.

QUERY: a single open gap (1-sentence question + the parent bullet_text for
context). Latency budget: ~500ms p95 — runs once when the user opens the gap
form, not on every keystroke. Volume: low (one call per gap view).

QUALITY BAR: top-3 with ~70% precision is fine. The user reviews suggestions
before accepting. False positives are cheap; false negatives mean the user
just types the answer manually like today.

CONSTRAINTS: Supabase Postgres is already the only datastore (see
backend/src/lib/supabase.ts). Anthropic is the only LLM provider configured
(LLM_API_KEY in backend/.env.example). No vector infra exists today. Prefer
solutions that don't add a second datastore. EU/US regions both fine.

SUCCESS METRIC: in spot-checks, ≥60% of suggested answers need ≤1 small edit
before the user accepts.

Specifically evaluate: pgvector (Supabase native) vs FAISS in-process vs
Postgres FTS vs hybrid, and recommend an embedding model.
```

The same agent definition is then reusable for future tasks: "find the most
relevant CV bullet for an interview question", "find the most relevant past
interview answer for a follow-up question", etc. — each is just a new brief.

## Verification

This is a documentation/config-only change. To verify after creation:

1. **File loads as a subagent.** Run `/agents` in Claude Code (or check the
   Agent tool's `subagent_type` enum) and confirm `retrieval-researcher`
   appears with the expected description.
2. **Description triggers correctly.** In a fresh Claude Code session ask
   "Help me figure out which vector database to use for X" — the main agent
   should suggest delegating to `retrieval-researcher` without being told.
3. **First-task dry run.** Invoke the agent with the cross-CV gap auto-fill
   brief above. Confirm the report contains all 8 mandated sections, that
   section 2 cites real file paths from this repo, that section 3 has at
   least one elimination, that section 8 has at least 3 fetched URLs, and
   that the recommendation explicitly considers pgvector vs FAISS (since
   the user named both).
4. **Re-use test.** Invoke the same agent with a different brief (e.g.
   "find the most relevant CV bullet for a given interview question") and
   confirm the agent works without any edits to its definition.

## Out of scope

- Building the auto-fill feature itself. That's the *next* plan, after the
  researcher agent returns its recommendation.
- Embedding any code, migration, or runtime change in this plan.
- Defining other agents (planner, implementer, reviewer) — only the
  retrieval-researcher.

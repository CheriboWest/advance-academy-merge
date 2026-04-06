# `src/lib` — shared backend building blocks

## What belongs here

| Kind | Purpose | Examples |
|------|---------|----------|
| **Cross-feature LLM helpers** | One place for “how we talk to the model” for features that need the Anthropic SDK directly (large `max_tokens`, multi-turn). | `llm-anthropic.ts` |
| **Feature subfolders** | For LLM-heavy features: **`prompts.ts` only** (system strings + `build*UserPrompt` / `build*SystemPrompt` helpers). No HTTP, no orchestration, no `messages.create` calls. | `dream-company/prompts.ts`, `outreach/prompts.ts` |

## What does *not* belong here

- Request validation and orchestration of multiple steps for an API → **`src/services/*.service.ts`**
- HTTP wiring → **`src/routes/*.ts`**
- Shared types for API bodies → **`src/types/`** (or packages under `contracts/`)

## Layering (template)

1. **Route** imports **only** the matching **service**.
2. **Service** validates input, runs the workflow, imports from **`lib/`**, **`config/`**, **`types/`**, or **`llm.service.ts`** as needed.
3. **`lib/<feature>/prompts.ts`** — all copy/prompt construction for that feature. The matching **`services/<feature>.service.ts`** owns validation, `anthropic.messages.create` (or `llm.service`), parsing, and retries.

## LLM stacks (current)

- **`services/llm.service.ts`** — HTTP client (OpenAI-compatible chat + Anthropic Messages) with JSON extraction. Used by **CV optimizer** (and suitable for new features if token limits fit).
- **`lib/llm-anthropic.ts`** — Anthropic SDK + `assertLlmConfigured`. Used by **dream-company** and **outreach** where calls use higher `max_tokens` or the SDK API shape.

Unifying on a single client is possible later (e.g. extend `llm.service` with per-call `max_tokens`); until then, pick the stack that matches token needs.

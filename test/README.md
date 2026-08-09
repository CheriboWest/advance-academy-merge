# Test cases — Dream Company Finder & Outreach Generator

Manual QA test suite for **2 tools**: Dream Company Finder and Outreach Generator.

**Primary deliverable:** [`test-cases.xlsx`](./test-cases.xlsx) — one sheet per tool, fully detailed so the
test team can grade each field.

> **Assumption of this suite:** every input is **paste text**. The "AI reads a link / reads a CV file"
> path is deferred — see [Mandatory link/file](#mandatory-linkfile-cannot-be-replaced-by-text).

---

## How the workbook is organised

`test-cases.xlsx` has two sheets: **Dream Company** and **Outreach**.

Each row is one test case. Columns:

| Column | Meaning |
|---|---|
| Case ID | e.g. `DC-01`, `OUT-02` |
| Title | Short description |
| Type | Happy path / Edge / Validation / Stress / Adversarial / Failure-prone / Note |
| Difficulty | Easy / Medium / Hard |
| Endpoint | Backend API called |
| Form Input | Exactly what the user types/selects |
| Request Body (JSON) | Payload sent to backend (matches the real schema) |
| Expected HTTP | Expected status code |
| **Expected Output — Acceptance Criteria** | The **system's EXPECTED output**, broken down per field (numbered) |
| Known Fragility | Why the case might fail / what to watch |
| **[TEAM] columns (yellow)** | Testers fill: Actual HTTP, Actual Output, Per-criterion P/F, Overall Pass/Fail, Severity, Notes |

> ⚠️ **The "Expected Output" column is what the system SHOULD return** (acceptance criteria), to be
> compared against the tester's actual result. Because these are LLM outputs, **do not string-match
> exactly** — grade against the shape / constraints / semantics (e.g. "3 phases", "linkedInMessage ≤ 280 chars").

---

## Case mix (not just happy paths)

The suite intentionally includes hard / failure-prone cases:

- **Happy path** — baseline correctness.
- **Validation (negative)** — missing required fields, no output enabled → expect `400`.
- **Edge** — optional fields empty, minimal input, non-tech domain, multilingual.
- **Stress** — very long CV / JD (latency, timeout, JSON-parse robustness).
- **Adversarial / Security** — prompt injection inside `workExperience` / `jdText`, special chars / emoji.
- **Hard / hallucination risk** — career changer, inflated/contradictory claims, CV↔role mismatch (honesty).
- **Failure-prone** — Exa outage path for the roadmap, blocked-domain insight with empty text.

---

## How to run

All backend endpoints (except `/api/health`, `/api/system`) require auth:
`Authorization: Bearer <supabase_token>`.

Two options:
1. **Through the real UI** (recommended for QA): enter the Form Input, compare with the acceptance criteria.
2. **Call the backend directly** with curl (needs a token):

```bash
BASE=https://advanceacademytools-production.up.railway.app
TOKEN=<paste supabase bearer token>

curl -s "$BASE/api/dream-company/analyze" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '<paste the Request Body cell here>' | jq .
```

> Some cases (DC-02 roles, DC-03 roadmap) need `analysis` / `selectedRoles` that are outputs of the
> previous step. The Request Body cell ships a valid sample object so each case runs standalone; when
> testing the real flow, use the actual output of the previous step.

---

## Mandatory link/file (cannot be replaced by text)

### Dream Company Finder
| Function | Requires | Replaceable by paste text? |
|---|---|---|
| Profile form (degree, workExperience, skills, location, …) | text | ✅ Yes — the whole flow works from text |
| `POST /api/dream-company/parse-cv` (CV upload) | **PDF/DOCX FILE** | ❌ No — multipart file only. **But** it only auto-fills the form; skipping it still lets you use the full tool by typing → **not required**. |

➡️ **Dream Company has NO mandatory link/file.** `parse-cv` (file-only) is optional, deferred.

### Outreach Generator
| Function | Requires | Replaceable by paste text? |
|---|---|---|
| `POST /api/outreach/generate` | text | ✅ Yes — paste `cvText`, `jdText`, target fields |
| `jdText` (job description) | text **or** URL | ✅ Yes — paste `jdText` directly, no URL needed |
| `POST /api/outreach/validate-jd` | **URL** | ✅ Replaceable — skip it, paste `jdText` into generate |
| `POST /api/outreach/extract` | URL or file | ✅ Replaceable — paste the content |
| `manualContexts[]` | has a `content` field | ✅ Replaceable — API accepts `content` directly |
| `POST /api/outreach/enrich` (company "insights") → `insightSignals` | **Exa web search (URL)** | ❌ No — insights come from web search, you cannot paste them. **But** `insightSignals` is **optional** for `/generate`. |

➡️ The **only** Outreach step that **cannot** be replaced by text is **Enrichment / insight discovery**
(needs Exa). It is **optional** to the main output, so this paste-text suite **skips enrichment** and uses `insightSignals: []`.

---

## Production observations (Railway)

From the live service `AdvanceAcademyTools` (project `hearty-nourishment`):

- `POST /api/dream-company/analyze` → **200** but ~**28s**.
- `POST /api/dream-company/roles` → **200** but ~**40s** ⚠️ (close to the 60s frontend timeout — real risk on slow networks / long profiles).
- **No `/api/outreach/*` traffic** observed → Outreach is **barely tested** in production.
- `/api/cv-optimizer/analyze` returned **500** (a different tool, out of scope here).
- Could **not** read env-var names via the Railway AI agent (quota exhausted). → **Check manually** in the Railway dashboard: `LLM_API_KEY_OUTREACH` (shared by BOTH tools), `EXA_API_KEY`, `JINA_API_KEY`, `LLM_MODEL_*`. One wrong key breaks **both tools** at once.

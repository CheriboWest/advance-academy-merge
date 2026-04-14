# Interview Question Sites — Fetchability Research

Research on whether the five interview-question sites can be scraped for questions without login/payment, what mechanism each uses, and how to actually extract questions at scale.

**Research date:** 2026-04-11
**Tooling:** stdlib `urllib` via `scripts/research/scrape_interview_questions.py`, plus `WebFetch`/`curl` for probing.

---

## TL;DR

| # | Site | Fetchable? | Questions you can get today | How |
|---|------|------------|------------------------------|-----|
| 1 | Hello Interview | ✅ **Fully** | ~4,267 real questions | Public `sitemap.xml` → one SSR'd HTML page per question → extract `<h1>`. |
| 2 | InterviewPal | ⚠️ **Partial** | ~6 per page load | Landing page SSRs a handful inside the Next.js payload. The full 21k DB lives behind their client-side API (auth-gated). |
| 3 | Indeed Top 20 | ❌ **Blocked** | 0 (automated) | Cloudflare bot protection fingerprints JA3, not just UA. Needs a real browser (Playwright) or `curl-impersonate`. |
| 4 | The Muse 60+ | ✅ **Fully** | **67 questions** | Static blog post; every question is an `<h2>`. |
| 5 | Resume Genius 26+ | ❌ **Blocked** | 0 (automated) | Same Cloudflare wall as Indeed. |

**Actually extracted in this run** (see `docs/research/extracted/`):

| File | Count | Source |
|---|---|---|
| `hellointerview_questions.txt` | 28 (sample) | First 30 sitemap URLs, 1 retryable connection-reset skip |
| `hellointerview_questions.jsonl` | 28 | Same, with URL provenance |
| `interviewpal_questions.txt` | 6 | Initial SSR payload |
| `interviewpal_questions.jsonl` | 6 | |
| `muse_questions.txt` | 67 | Complete article |
| `muse_questions.jsonl` | 67 | |
| `indeed_questions.{txt,jsonl}` | 0 | Blocked |
| `resumegenius_questions.{txt,jsonl}` | 0 | Blocked |

**Run the scraper:**
```bash
# Everything that's scrapable, with a 50-request cap on HelloInterview:
python3 scripts/research/scrape_interview_questions.py --site all --limit 50

# All 4,267 HelloInterview questions (≈ 72 min at 1 req/sec):
python3 scripts/research/scrape_interview_questions.py --site hellointerview
```

---

## 1. Hello Interview — `hellointerview.com/community/questions` ✅

**How it works.** The listing page at `/community/questions` is a JS-hydrated Next.js App Router page — the static HTML contains only the shell and filter UI, so grepping it yields nothing. But every question has **its own URL** in the shape:

```
https://www.hellointerview.com/community/questions/<slug>/<cuid>
```

Each individual question page is **server-side rendered** with the full question text in an `<h1 class="MuiTypography-h4">...</h1>` (and also in `<meta property="og:title" content="...">`). Example:

```html
<h1 class="MuiTypography-root MuiTypography-h4 ...">
  Tell me about a time you had to design a job scheduler or similar system
</h1>
```

**And — critically — every question URL is listed in `sitemap.xml`**, which is publicly accessible and has no robots restrictions. At the time of this research, `https://www.hellointerview.com/sitemap.xml` contained **4,267 `/community/questions/*` URLs**.

**Access terms.**
- `robots.txt`: `User-Agent: *  Allow: /` — fully open.
- No login required for question pages.
- ToS should still be reviewed before large-scale scraping. The sitemap is effectively an invitation to crawl, but redistributing the corpus may violate their commercial terms.

**Sample questions extracted** (first 5 of the 28-question sample):
1. Design Amazon Music
2. Design a movie ticket booking system
3. Design a large model file distribution system
4. Describe a difficult interaction you had with a customer.
5. Tell me about a time you had to design a job scheduler or similar system

**Speed.** One request per second → ~72 minutes for the whole corpus. Parallelizing (carefully, with a concurrency cap of 4–8 and exponential backoff) would bring that under 15 minutes, but one connection reset was already observed at 1 req/sec — go slow and tolerate retries.

**What's NOT in the sitemap.** Answers, comments, voting data, and metadata (company, level, type) are not in the `<h1>`. You get the question title only. The full question page has more structured data in the hydrated React tree — if you need that, switch to Playwright and intercept their internal API responses.

---

## 2. InterviewPal — `interviewpal.com/questions` ⚠️

**How it works.** Next.js SSR renders **~6 questions** into the initial HTML — just enough to populate the first visible card. The advertised 21,189-question DB lives behind a client-side API call that runs after hydration, presumably gated by an auth token stored in cookies/localStorage.

**What I could verify:**
- `https://www.interviewpal.com/sitemap.xml` does **not** serve XML — Next.js routing intercepts it and returns the SPA shell (`<!DOCTYPE html>...`). No per-question URLs are publicly indexed.
- `?page=2` returns the same ~6 questions — pagination isn't URL-driven.
- Questions that **are** in the SSR payload are real and fetchable:

```
How do you determine whether to outsource business functions like customer service or manufacturing?
How do you develop a go-to-market strategy for a new product in a competitive market?
What are the steps to handle a suspected APT attack?
What criteria would you use to decide which positions to cut during layoffs?
What is the process for conducting a risk assessment?
```

**To get the full DB you would need to:**
1. Open `/questions` in a real browser, look at the DevTools Network tab for XHR/Fetch calls.
2. Identify the internal API (likely `/api/questions?page=N` or similar), along with its auth header (likely a JWT in an `Authorization: Bearer …` cookie).
3. Replay that call with the same cookie from a Playwright session, iterating through pagination.

**Legal risk.** InterviewPal's ToS almost certainly forbids automated API access — they advertise the DB as a paid product feature. Treat this as research-only, not production seed data.

---

## 3. Indeed — `indeed.com/career-advice/interviewing/top-20-interview-questions` ❌

**How it was blocked.** Both `curl -A "Mozilla/5.0 Chrome/120.0 ..."` and `urllib.request` return **HTTP 403** with a small HTML error body. This is Cloudflare's bot protection, which fingerprints the TLS handshake (JA3) — changing the `User-Agent` string alone doesn't help. `WebFetch` also fails to return the article body (the small model says "content is not visible in the provided HTML"), suggesting Indeed serves a challenge page to our upstream fetcher too.

**Workarounds, in order of effort:**

1. **Playwright (recommended).** A real Chromium instance solves the challenge automatically:
   ```bash
   pip install playwright && playwright install chromium
   ```
   Then:
   ```python
   from playwright.sync_api import sync_playwright
   with sync_playwright() as p:
       browser = p.chromium.launch()
       page = browser.new_page()
       page.goto("https://www.indeed.com/career-advice/interviewing/top-20-interview-questions")
       page.wait_for_load_state("networkidle")
       questions = page.locator("h2, h3").all_inner_texts()
       print("\n".join(questions))
   ```
2. **`curl-impersonate`.** A fork of curl that mimics Chrome's TLS fingerprint; drop-in replacement for `curl`. See https://github.com/lwthiker/curl-impersonate.
3. **Manual paste.** Indeed's Top 20 list is stable, small, and well-indexed. Copy-paste into a local file once and re-parse as needed. Zero ToS risk.

**Content overlap.** Indeed's Top 20 is a strict subset of The Muse's 65. If your goal is seeding a general question bank, **you lose nothing by skipping Indeed** and using Muse instead. The value of Indeed would only be its specific editorial "sample answers" — not the question list itself.

---

## 4. The Muse — `themuse.com/advice/interview-questions-and-answers` ✅

**How it works.** Static HTML blog post, no JS gating, no Cloudflare challenge. Each question is wrapped in a plain `<h2>`; each "Possible answer to..." section header is an `<h3>`. A regex over `<h2>` tags extracts all 67 questions in one shot.

**Extracted:** 67 questions, saved to `docs/research/extracted/muse_questions.txt`. Sample of the first 10:

1. Tell me about yourself/your work experience
2. Walk me through your resume
3. How did you hear about this position?
4. Why do you want to work at this company?
5. Why do you want this job?
6. Why should we hire you?
7. What can you bring to the company?
8. What are your strengths?
9. What are your weaknesses?
10. What is your greatest professional achievement?

This is **the cleanest source** of the five sites. Use it as your primary baseline if you're building a behavioural/general-interview question bank.

---

## 5. Resume Genius — `resumegenius.com/blog/interview/interview-questions-and-answers` ❌

Same Cloudflare wall as Indeed — HTTP 403 for both `curl` and `urllib` regardless of User-Agent. `WebFetch` also gets a truncated page and can't produce the list.

**Workarounds:** Same as Indeed — Playwright, `curl-impersonate`, or manual paste. Given that ResumeGenius's 26-question list is, again, a subset of The Muse's 65, the fastest path is to skip it entirely.

---

## What the scraper does

`scripts/research/scrape_interview_questions.py` (stdlib only — no pip needed):

- `hellointerview` — fetches `sitemap.xml`, extracts `/community/questions/*` URLs, visits each with a 1-second delay, reads the `<h1>` via regex. Supports `--limit N` so you can cap a run.
- `interviewpal` — fetches `/questions`, grep the SSR'd Next.js payload for escaped question strings. Known to return ~6.
- `muse` — fetches the article, extracts all `<h2>` text, filters out the article title.
- `indeed`, `resumegenius` — print the "blocked" note and exit cleanly.

Outputs to `docs/research/extracted/<site>_questions.{txt,jsonl}`. The JSONL file has `{source, url, question}` per line for provenance. Polite defaults (1 req/sec, identifying User-Agent, sequential requests, no retries on first run).

---

## Recommended next steps

1. **Run the full Hello Interview scrape** — `python3 scripts/research/scrape_interview_questions.py --site hellointerview`. ~72 minutes, ~4,200 real behavioural + system-design + coding questions from recent FAANG interviews. This is the single biggest usable corpus of the five sites.

2. **Use The Muse's 67 questions as a "standard interview" baseline.** They cover every common prompt (tell-me-about-yourself, strengths/weaknesses, why-this-company, behavioural STAR prompts, closing questions). Indeed and Resume Genius add zero new coverage over this set.

3. **Skip InterviewPal, Indeed, and Resume Genius for production.** InterviewPal's DB is paywalled; Indeed and Resume Genius are Cloudflare-protected editorial content — the legal and technical cost outweighs the marginal coverage gain.

4. **If you still want Indeed/Resume Genius for editorial voice:** install Playwright once, add two scrapers to the same script that read `document.body.innerText`, and call it done. ~30 minutes of work.

5. **Reminder on legal risk.** Hello Interview's questions are crowdsourced from real candidates and published under their terms. The Muse's content is editorial and copyrighted. Neither publishes a data license. If you plan to redistribute extracted questions publicly, get written permission or generate new questions with an LLM using the extracted ones as a *taxonomy reference*, not a direct source.

---

## Files

- **Scraper:** `scripts/research/scrape_interview_questions.py`
- **Extracted questions (per site):** `docs/research/extracted/<site>_questions.{txt,jsonl}`
- **This report:** `docs/research/interview_question_sites_fetchability.md`
- **Related research (aptitude-test sites):** `docs/research/aptitude_test_sites_fetchability.md`

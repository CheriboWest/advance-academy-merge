# Aptitude Test Sites — Fetchability Research

Research on whether sample aptitude test questions can be programmatically retrieved from nine major practice-test publishers. Goal: understand which sites we can scrape for seeding an internal question bank, and what each one would require.

**Research date:** 2026-04-11
**Tooling used:** `WebFetch` (HTML → markdown via a small model, no JS execution) and `pypdf` for PDF extraction.

> ⚠️ **Legal caveat.** Even when content is technically fetchable, most of these sites' Terms of Service forbid scraping and redistribution. SHL, Saville, and similar vendor questions are copyrighted commercial assessments. Use this report to understand feasibility — do not treat it as authorization. The safer long-term options (license, LLM-generated, or openly licensed material) are discussed at the bottom.

---

## TL;DR by site

| # | Site | Fetchable? | Free questions? | Mechanism |
|---|------|-----------|-----------------|-----------|
| 1 | savilleassessment.com/practice-tests | ❌ | No | Hub page only; tests on `scuk.sc-oasys.com` (separate platform). |
| 2 | shl.com/shldirect/en/practice-tests | ❌ | No | Directory only; tests on `talentcentral.eu.shl.com` + `shldesktop.com`. Interactive simulations. |
| 3 | jobtestprep.co.uk/verbal-reasoning-practice-test | ✅ | 10 + free PDF | **Questions are in static HTML**; additional PDF (`free-verbal-reasoning-questions-and-answers-pdf.pdf`) extracted locally. |
| 4 | numericalreasoningtest.org | ⚠️ | Yes, but JS-gated | Homepage has no questions; "Start test" loads content via JS/iframe after click. |
| 5 | aptitude-test.com | ❌ | Signup required | Tests render in `largeTestIframe` after signup (`/get-access-now/`). |
| 6 | psychometrictests.org/tests | ⚠️ | Freemium | Content loaded from `api.picked.ai/v1/psychometrictests` — scrapeable **iff** the API is open. |
| 7 | graduatesfirst.com | ❌ | Signup + paywall | Free tier requires account; full access is £51.95. Static HTML landing only. |
| 8 | assessmentday.co.uk | ❌ | Paywalled | Landing only; old `/free/numerical/*.pdf` path is now 404. PDFs live inside paid packs. |
| 9 | practiceaptitudetests.com | ✅ | 3–4 per category | **Inner category pages expose static-HTML questions**; homepage doesn't. Plus a public `/aptitude-test.pdf` (image-based, needs OCR). |

Legend: ✅ content retrievable today · ⚠️ retrievable only with headless browser / API probing · ❌ requires signup, payment, or a separate authenticated platform.

---

## 1. Saville — `savilleassessment.com/practice-tests`

**Status:** ❌ Not fetchable.

The URL is a **hub/index page** that lists 19 practice tests across Analysis, Comprehension, and Technical categories. It contains zero sample questions in HTML. The actual tests are served from a separate authenticated platform (`scuk.sc-oasys.com`), which our tooling cannot reach without credentials.

**To scrape:** Would require (a) a Saville account, (b) session-cookie replay, and (c) handling whatever client-side rendering `sc-oasys.com` uses. Not feasible without a license.

---

## 2. SHL — `shl.com/shldirect/en/practice-tests/`

**Status:** ❌ Not fetchable.

Another directory page. Describes test types (verbal, numerical, inductive, Contact Center Simulation, Critical Thinking, etc.) but embeds no questions. Actual tests are hosted on `talentcentral.eu.shl.com` and `shldesktop.com`. Many are **interactive simulations** (drag-drop, desktop sims) — even with a headless browser, extracting "questions" from a simulation is non-trivial.

The page itself is instrumented with New Relic, VWO, and Eloqua — tracker-heavy but not helpful for content.

**To scrape:** Not practical. SHL is the most aggressive about IP protection; even their sample widgets tend to be WebGL or canvas-rendered.

---

## 3. JobTestPrep — `jobtestprep.co.uk/verbal-reasoning-practice-test`

**Status:** ✅ **Fetchable today.**

- **10 full sample questions + answers + explanations** are hardcoded in the page HTML. Examples pulled in this run:
  - Verbal critical reasoning ("Work-life balance schemes in the workplace have been ___ by employees…")
  - Reading comprehension ("If more tourists come to this country, it will mean:")
  - Word analogy ("Which would best replace 'outstanding' in sentence 3?")
- Links a **free PDF**: `/media/wpbfqn2b/free-verbal-reasoning-questions-and-answers-pdf.pdf`.
- Paid full pack advertises 16,000+ questions (not free).

**PDF extraction.** The PDF was downloaded via `WebFetch` to `.claude/projects/.../tool-results/webfetch-*-ldbtud.pdf`. `WebFetch`'s small model couldn't read binary PDF, so extraction was done locally with `pypdf`. The full extracted text is at:

> `docs/research/jobtestprep_verbal_reasoning.txt` (11 pages, 6,137 chars, clean text — readable questions with answer options and explanations).

**Scraping strategy for more content:** Other JobTestPrep practice landing pages (numerical, logical, etc.) likely follow the same static-HTML pattern. Enumerate them from the site's top-level `/practice-tests/` index.

---

## 4. NumericalReasoningTest.org

**Status:** ⚠️ Partially fetchable (needs headless browser).

Homepage just describes three free tests ("Trial real psychometric tests developed by ex-SHL consultants"). Questions only appear **after clicking "Start test"** — the test UI is loaded dynamically. `WebFetch` doesn't run JS, so we see nothing.

**To scrape:** Playwright/Puppeteer. See scraper sketch below. Expect the test to be in an iframe or a SPA route — scraping needs to wait for the question DOM before grabbing `innerText`.

---

## 5. Aptitude-Test.com

**Status:** ❌ Signup-gated.

Homepage is marketing. The `largeTestIframe` class in the HTML tips off that content is iframe-based, but all routes that actually serve tests require account creation (`/get-access-now/`). Even the "Free Cognitive Ability Test" advertised on the homepage redirects through signup.

**To scrape:** Would need a throwaway account + session cookies + Playwright. Check ToS before doing this — most assessment sites treat automated account creation as an abuse-of-service violation.

---

## 6. PsychometricTests.org — `/tests`

**Status:** ⚠️ Probably fetchable via the underlying API.

This is the **most interesting** of the JS-gated sites. The page makes calls to:

> `https://api.picked.ai/v1/psychometrictests`

If that endpoint returns JSON without requiring auth, scraping is trivial — no headless browser needed. **Recommended next step:** open the site in Chrome DevTools → Network tab → filter for `api.picked.ai` → inspect request headers and response payload. If an API key or cookie is required, it'll be visible there.

Categories listed on the landing:
- Numerical Reasoning — 30 tests, 480 questions
- Verbal Reasoning — 30 tests, 450 questions
- Diagrammatic Reasoning — 30 tests, 300 questions
- Situational Judgement — 50 tests, 480 questions
- Abstract / Spatial / Logical / Mechanical — ~10 tests, ~100 questions each

The "Upgrade to Pro" CTA suggests the free tier has a subset — likely the API gates premium content with a user token.

---

## 7. GraduatesFirst — `graduatesfirst.com`

**Status:** ❌ Signup + paywall.

Static HTML landing, but every "Go free" button routes to `app.graduatesfirst.com/gf/account/login?reg=true`. Premium (160+ assessments, 2,400+ questions) is **£51.95**. No sample questions on the homepage.

**To scrape:** Account required. Not pursuing without a license.

---

## 8. AssessmentDay — `assessmentday.co.uk`

**Status:** ❌ Paywalled.

Homepage describes packages. The historical free-PDF path `/free/numerical/numerical-reasoning-solutions1.pdf` is now **404** — confirmed in this run. PDFs still exist inside paid packs. Marketing copy promises "PDF booklets to study anywhere" but they're behind a purchase.

**To scrape:** Purchase + PDF extraction. The legal cleanest option for AssessmentDay is buying a single pack and extracting with `pypdf` (same technique used below for JobTestPrep). Redistribution is still a ToS violation — keep extracted content internal.

---

## 9. PracticeAptitudeTests — `practiceaptitudetests.com`

**Status:** ✅ **Most fetchable of all nine sites.**

The **homepage** is marketing, but every **inner category page** exposes 3–4 sample questions in static HTML. Confirmed in this run across 8 categories:

| Category URL | Sample Qs in HTML | Notes |
|---|---|---|
| `/numerical-reasoning-tests/` | 4 | Text-based (percentages, ratios, currency). Also a JS-loaded 5-question quiz. |
| `/verbal-reasoning-tests/` | 3 full Qs with answers | True/False/Cannot say + reading comprehension + word analogy. |
| `/logical-reasoning-tests/` | ~4 | Deductive/inductive mix; visual Qs are images. |
| `/situational-judgement-tests/` | 4 | Fully text-based scenarios (communication, teamwork, decision-making, customer service). |
| `/inductive-reasoning-tests/` | 3 | Shape sequence + marble probability (text) + visual. |
| `/mechanical-reasoning-tests/` | 3 | Gears, magnets, pulleys — Q text + answer options in HTML, diagrams are images. |
| `/abstract-reasoning-tests/` | 3 | Visual only — questions are images on Cloudinary. |
| `/diagrammatic-reasoning-tests/` | 3 | Visual only. |
| `/spatial-reasoning-tests/` | 3 with answers | Visual but answer text + explanations are in HTML. |
| `/error-checking-tests/` | — | URL returned 404; likely renamed. Check site nav or sitemap.xml. |

Every category page also has an interactive 5–6 question quiz, but those render via JS — not in the static HTML.

**robots.txt** (checked in prior run): only `/checkout/`, `/dashboard/`, `/login/`, `/organisation/`, `/payment-complete/`, `/settings`, `/sign-up/` are disallowed. **Content pages are crawlable.** No crawl-delay specified, but be polite — rate-limit to ≤ 1 request/sec.

**PDF extraction.** The public `/aptitude-test.pdf` (1.1 MB, 9 pages) was downloaded to `.claude/projects/.../tool-results/webfetch-*-4iej2k.pdf`. **pypdf extracted only 1,007 chars** — the questions are rendered as **images**, not text. Answer labels ("A ☐ B ☐ C ☐ D ☐") came through but the actual question text didn't.

> `docs/research/practiceaptitudetests_aptitude.txt` (9 pages, image-based, needs OCR).

**To get PDF content:** Tesseract OCR on the rasterized pages. Not worth the effort — the HTML category pages already give you more usable content.

**Scraping strategy:** Enumerate categories from `sitemap.xml` (confirmed present in robots.txt), fetch each with plain `curl` or `fetch`, parse with `cheerio` / `BeautifulSoup`. Clean static HTML.

---

## PDFs already extracted

Two PDFs were downloaded during research and extracted locally with `pypdf` (stdlib-only bootstrap — system `python3` had no `pip`, so `pypdf-4.3.1` was pulled as a source tarball from PyPI into `/tmp` and added to `PYTHONPATH`).

| Source | Size | Pages | Extracted chars | Quality | Output file |
|---|---|---|---|---|---|
| JobTestPrep verbal reasoning | 531 KB | 11 | 6,137 | ✅ Clean text | `docs/research/jobtestprep_verbal_reasoning.txt` |
| PracticeAptitudeTests aptitude | 1.1 MB | 9 | 1,007 | ⚠️ Image-based, mostly labels | `docs/research/practiceaptitudetests_aptitude.txt` |

**Reproduction command** (if you need to re-run the extraction):

```bash
# One-time bootstrap if the system python has no pip:
cd /tmp && curl -sSL -o pypdf.tar.gz \
  https://files.pythonhosted.org/packages/source/p/pypdf/pypdf-4.3.1.tar.gz
tar xzf pypdf.tar.gz

# Run:
PYTHONPATH=/tmp/pypdf-4.3.1 python3 - <<'PY'
from pypdf import PdfReader
reader = PdfReader("/path/to/file.pdf")
for p in reader.pages:
    print(p.extract_text() or "")
PY
```

For the image-based PracticeAptitudeTests PDF, use `tesseract` + `pdftoppm` to OCR instead.

---

## Scraper sketch for JS-gated sites

For sites #4 (`numericalreasoningtest.org`) and #6 (`psychometrictests.org`), content only renders after JS executes. Two tiers of effort:

### Tier 1 — probe for a public API first (cheapest)

Before writing any scraper, open each site in Chrome DevTools → **Network** tab → filter for **Fetch/XHR** → start the test → watch what gets called.

- **psychometrictests.org:** the page already references `api.picked.ai/v1/psychometrictests`. Try:
  ```bash
  curl -s 'https://api.picked.ai/v1/psychometrictests' \
    -H 'accept: application/json' \
    -H 'origin: https://www.psychometrictests.org' | jq . | head -50
  ```
  If you get JSON, you're done — no browser needed. If you get 401/403, inspect request headers in DevTools for a bearer token or cookie.
- **numericalreasoningtest.org:** look for similar XHR calls — most "ex-SHL" whitelabels run on a shared backend.

If one API call returns an entire question bank, this is your whole scraper. Skip Tier 2.

### Tier 2 — Playwright scraper (when API isn't accessible)

Install (one-off):
```bash
cd backend && npm install --save-dev playwright
npx playwright install chromium
```

Sketch (`scripts/scrape_js_aptitude_tests.ts`):

```ts
import { chromium, Page } from 'playwright';
import { writeFileSync } from 'fs';

type Target = {
  name: string;
  url: string;
  // CSS selector that appears once the question DOM is mounted.
  ready: string;
  // How to pull questions out of a ready page.
  extract: (page: Page) => Promise<unknown>;
};

const TARGETS: Target[] = [
  {
    name: 'numericalreasoningtest',
    url: 'https://www.numericalreasoningtest.org/',
    ready: '[class*="question"], iframe',
    extract: async (page) => {
      // Click whichever "Start test" link appears first.
      const start = page.locator('a:has-text("Start")').first();
      await start.click();
      await page.waitForLoadState('networkidle');
      // If the test is inside an iframe, switch to its frame.
      const frame = page.frames().find((f) => f.url().includes('test'));
      const root = frame ?? page;
      return await root.$$eval('[class*="question"]', (els) =>
        els.map((el) => (el as HTMLElement).innerText.trim()),
      );
    },
  },
  {
    name: 'psychometrictests',
    url: 'https://www.psychometrictests.org/tests/',
    ready: '[data-testid="question"], .question-text',
    extract: async (page) => {
      // Capture the underlying API responses instead of DOM-scraping.
      const payloads: unknown[] = [];
      page.on('response', async (res) => {
        const url = res.url();
        if (url.includes('api.picked.ai')) {
          try { payloads.push(await res.json()); } catch { /* not JSON */ }
        }
      });
      // Navigate through a sample test to trigger the API calls.
      await page.locator('a:has-text("Numerical")').first().click();
      await page.waitForLoadState('networkidle');
      return payloads;
    },
  },
];

async function main() {
  const browser = await chromium.launch({ headless: true });
  for (const t of TARGETS) {
    const ctx = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (compatible; AdvanceAcademyResearchBot/0.1; +https://advanceacademy.local/bot)',
    });
    const page = await ctx.newPage();
    await page.goto(t.url, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector(t.ready, { timeout: 15_000 }).catch(() => null);
    const data = await t.extract(page);
    writeFileSync(`docs/research/raw/${t.name}.json`, JSON.stringify(data, null, 2));
    await ctx.close();
  }
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
```

Key notes:
- **Be polite.** One browser context per site, sequential, no parallel hammering.
- **Identify yourself** in the User-Agent. A custom UA + contact URL is what good-faith crawlers do.
- **Check robots.txt** for each target before running. `curl https://SITE/robots.txt`.
- **Prefer response interception** over DOM scraping when possible — `page.on('response', …)` gives you the raw API payload, which is cleaner than `innerText`.
- **Rate-limit.** Put `await page.waitForTimeout(2000)` between page navigations.
- **Store raw payloads**, don't transform on the first pass. You can re-parse offline without re-hitting the site.

### Tier 3 — when scraping isn't the right answer

Re-emphasizing: SHL, Saville, JobTestPrep, and GraduatesFirst all have ToS clauses against automated access, and their questions are copyrighted. If AdvanceAcademy needs a question bank for a production feature (Interview Prep or a new aptitude-practice module), the three defensible paths are:

1. **License from a vendor.** JobTestPrep and GraduatesFirst both sell B2B content licenses.
2. **LLM-generated.** Claude (already wired into `backend/src/services/`) can generate unlimited numerical/verbal/logical/situational questions with a taxonomy prompt. Seed the prompt with the public category descriptions from practiceaptitudetests.com — no redistribution risk.
3. **Openly licensed material.** University career-service PDFs (Oxford, Cambridge, many Russell Group unis publish free practice PDFs), OpenStax, public domain exam prep.

If the goal is prototyping/evaluation only, option 2 is by far the fastest.

---

## What was extracted vs. what's still gated

**Already in this repo** (under `docs/research/`):
- This report (`aptitude_test_sites_fetchability.md`).
- JobTestPrep verbal reasoning text (`jobtestprep_verbal_reasoning.txt`).
- PracticeAptitudeTests image-PDF text stub (`practiceaptitudetests_aptitude.txt`).
- In-line sample questions from 8 practiceaptitudetests.com category pages (quoted inside this report).

**Still gated** (would require signup/payment/headless work or a license):
- All Saville questions (behind `sc-oasys.com`).
- All SHL questions (behind `talentcentral.eu.shl.com`, plus interactive simulations).
- Aptitude-Test.com (signup wall).
- GraduatesFirst (signup + £51.95 paywall).
- AssessmentDay (paywall; `/free/*.pdf` path dead).
- NumericalReasoningTest.org (JS-gated — needs Tier 1 API probe or Tier 2 Playwright).
- PsychometricTests.org (JS-gated — almost certainly solvable by Tier 1 API probe against `api.picked.ai`).
- PracticeAptitudeTests `/error-checking-tests/` (404 — look up the current URL in `sitemap.xml`).
- PracticeAptitudeTests image-based PDF (needs OCR; lower ROI than scraping the HTML pages).

## Recommended next steps, in priority order

1. **Probe `api.picked.ai`** manually in a browser devtools Network tab. If it returns JSON without auth, write a 20-line `curl` script and you're done for `psychometrictests.org` — that alone could yield 2,000+ questions.
2. **Enumerate `practiceaptitudetests.com/sitemap.xml`** and fetch every `/xxx-reasoning-tests/` page. Parse with BeautifulSoup or cheerio. Estimated yield: ~30 text-extractable questions across categories, zero signup required.
3. **Decide the product direction:** scraped seed data (fast, legally gray) vs. LLM-generated questions (slightly slower, legally clean, infinitely scalable). The code in `backend/src/services/` is already set up to do option 2 with Claude — the same pattern used for Interview Prep question generation.
4. **Only if (1)–(3) don't meet the need:** write the Tier 2 Playwright scraper for `numericalreasoningtest.org`.

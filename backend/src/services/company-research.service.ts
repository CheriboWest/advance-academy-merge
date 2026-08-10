/**
 * Company research (sprint Coaching Tool, ticket T3).
 *
 * Replaces the half hour a coach spends googling a company before a session.
 * Reads the web, then has Sonnet write a brief in which **every claim cites the
 * page it came from**.
 *
 * The whole design is shaped by one failure: a brief that reads authoritatively
 * about a funding round, a headcount or a pivot that never happened. The coach
 * repeats it to the student in good faith, the student repeats it in the
 * interview, and the tool has actively made things worse. So:
 *
 *  - the prompt forbids outside knowledge and makes an empty section correct;
 *  - the SERVER then drops any claim whose `sourceUrl` is not a page we actually
 *    fetched. A rule the model can quietly break is not a rule;
 *  - when little is found the brief says so (`sparse` + `missingInfo`) instead of
 *    padding. A thin brief the coach can see is thin beats a confident empty one.
 *
 * Three sources, each independently optional — one being down degrades the brief
 * rather than failing the request:
 *   Exa            web search with page contents
 *   Jina Reader    the company's own site and any URLs the coach adds
 *   Companies House  hard UK register facts (no key => skipped, non-UK => absent)
 */

import type {
  CompanyBrief,
  CompanyFact,
  CompanyRegistryFacts,
  ResearchSource,
} from '@advance-academy/contracts/coaching';
import { getExaClient, withExaRetry } from '../lib/exa-client.js';
import {
  getCompanyProfile,
  isCompaniesHouseConfigured,
  searchCompanies,
} from '../lib/companies-house.js';
import { newCostBucket, type CostBucket } from '../lib/cost-tracker.js';
import { firstTextBlock, parseLlmJson } from '../lib/coaching/json.js';
import {
  assertLlmConfigured,
  createAnthropicClient,
  getFeatureModel,
  withRetry,
} from '../lib/llm-anthropic.js';
import { extractTextFromUrl } from './outreach-extractor.service.js';
import {
  COMPANY_BRIEF_SYSTEM,
  buildCompanyBriefUser,
  type SourceDocument,
} from '../lib/coaching/prompts.js';

const EXA_OPTIONS = { useAutoprompt: true, type: 'fast', numResults: 6 } as const;

/** One synthesis call over a handful of pages. Generous, but the pages are clipped. */
const SYNTHESIS_MAX_TOKENS = 4096;
const SYNTHESIS_TIMEOUT_MS = 90_000;

/** Below this much fetched text, there is nothing worth briefing on. */
const SPARSE_MIN_CHARS = 1500;
/** Below this many usable pages, treat the picture as thin however long they are. */
const SPARSE_MIN_SOURCES = 2;
/** A page shorter than this is navigation chrome or a cookie wall, not content. */
const MIN_USEFUL_PAGE_CHARS = 200;

export interface CompanyResearchInput {
  companyName: string;
  /** The company's own site, when the student supplied one. */
  companyUrl?: string;
  /** Steers which findings matter. Never cited as a source. */
  jdText?: string;
  /** Extra pages the coach attached in the Context Desk. */
  extraUrls?: string[];
}

// ── Pure helpers (unit-tested in company-research.service.test.ts) ───────────

/** Compare URLs by origin+path, so a trailing slash or `?utm_source` still matches. */
export function normaliseUrl(url: string): string {
  try {
    const u = new URL(url.trim());
    const path = u.pathname.replace(/\/+$/, '');
    return `${u.protocol}//${u.host.toLowerCase()}${path}`.toLowerCase();
  } catch {
    return url.trim().toLowerCase().replace(/\/+$/, '');
  }
}

/**
 * Drop every claim that does not cite a page we actually fetched.
 *
 * This is the guard that does the real work. The prompt asks the model to cite
 * honestly; this makes it impossible not to. A hallucinated claim almost always
 * arrives with a hallucinated or absent URL, and both are removed here.
 *
 * Claims are also rewritten to carry the source's canonical URL rather than
 * whatever spelling the model echoed back, so the UI can link them directly.
 */
export function enforceCitations(
  facts: unknown,
  allowedUrls: string[],
): { kept: CompanyFact[]; dropped: number } {
  if (!Array.isArray(facts)) return { kept: [], dropped: 0 };

  const canonical = new Map(allowedUrls.map((u) => [normaliseUrl(u), u]));
  const kept: CompanyFact[] = [];
  let dropped = 0;

  for (const raw of facts) {
    const claim = typeof raw?.claim === 'string' ? raw.claim.trim() : '';
    const cited = typeof raw?.sourceUrl === 'string' ? raw.sourceUrl.trim() : '';
    const match = cited ? canonical.get(normaliseUrl(cited)) : undefined;

    if (!claim || !match) {
      dropped++;
      continue;
    }
    kept.push({ claim, sourceUrl: match });
  }

  return { kept, dropped };
}

/** Keep only strings, trimmed and capped — the model's free-text fields. */
export function cleanStringList(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(0, max);
}

/**
 * Decide whether the brief is too thin to rely on, and say why in words a coach
 * can act on. These reasons are what the Context Desk shows them (ticket T3.5).
 */
export function assessSparse(args: {
  sources: ResearchSource[];
  totalChars: number;
  registry: CompanyRegistryFacts | null;
  citedClaimCount: number;
  hadCompanyUrl: boolean;
}): { sparse: boolean; reasons: string[] } {
  const { sources, totalChars, registry, citedClaimCount, hadCompanyUrl } = args;
  const reasons: string[] = [];

  if (sources.length === 0) {
    reasons.push('No page about this company could be read at all.');
  } else if (sources.length < SPARSE_MIN_SOURCES) {
    reasons.push(`Only ${sources.length} usable page was found.`);
  }

  if (totalChars < SPARSE_MIN_CHARS) {
    reasons.push('The pages found were too short to brief from.');
  }

  if (!hadCompanyUrl && !sources.some((s) => s.provider === 'jina')) {
    reasons.push('No company website was supplied, so nothing was read first-hand.');
  }

  if (!registry) {
    reasons.push(
      isCompaniesHouseConfigured()
        ? 'Not found on the UK register — either not a UK company, or registered under a different name.'
        : 'Companies House is not configured, so no registry facts were checked.',
    );
  }

  if (citedClaimCount === 0) {
    reasons.push('Nothing could be stated with a source behind it.');
  }

  // Registry-only knowledge is not a briefing. The claim count is what decides
  // it: plenty of text that yielded nothing citable is still a sparse result.
  const sparse =
    citedClaimCount === 0 ||
    sources.length < SPARSE_MIN_SOURCES ||
    totalChars < SPARSE_MIN_CHARS;

  return { sparse, reasons };
}

// ── Source gathering ────────────────────────────────────────────────────────

interface GatheredSource extends ResearchSource {
  text: string;
}

/**
 * Search the web for the company. Returns [] on any failure — a dead Exa key
 * must degrade the brief, not fail the coaching session that asked for it.
 */
async function gatherFromExa(
  input: CompanyResearchInput,
  cost: CostBucket,
): Promise<GatheredSource[]> {
  const queries = [
    `${input.companyName} company overview what they do`,
    `${input.companyName} news funding launch hiring`,
  ];

  try {
    const exa = getExaClient();
    // Each query maps into our own shape INSIDE its try, so a failed query
    // returns a plain GatheredSource[]. Returning a hand-made stand-in for
    // Exa's response instead would union two incompatible types and leave the
    // results untyped — which is exactly what broke the production build.
    const perQuery = await Promise.all(
      queries.map(async (q): Promise<GatheredSource[]> => {
        try {
          const response = await withExaRetry(() => exa.searchAndContents(q, EXA_OPTIONS));
          return (response.results ?? []).map(
            (r: { title: string | null; url: string; text?: string }) => ({
              url: r.url,
              title: r.title ?? null,
              provider: 'exa' as const,
              text: (r.text ?? '').trim(),
            }),
          );
        } catch (err) {
          console.error(`[company-research] Exa query failed (${q}):`, err);
          return [];
        }
      }),
    );
    cost.exa('exa.company.research', queries.length);

    return perQuery.flat();
  } catch (err) {
    // getExaClient() throws when the key is missing — a config problem, not a
    // reason to fail the whole brief.
    console.error('[company-research] Exa unavailable:', err);
    return [];
  }
}

/** Read the company's own site plus anything the coach attached. */
async function gatherFromJina(input: CompanyResearchInput): Promise<GatheredSource[]> {
  const urls = [input.companyUrl, ...(input.extraUrls ?? [])]
    .map((u) => u?.trim())
    .filter((u): u is string => Boolean(u));
  if (urls.length === 0) return [];

  const settled = await Promise.all(
    urls.map(async (url): Promise<GatheredSource | null> => {
      try {
        const text = await extractTextFromUrl(url);
        return { url, title: null, provider: 'jina', text: text.trim() };
      } catch (err) {
        console.error(`[company-research] could not read ${url}:`, err);
        return null;
      }
    }),
  );
  return settled.filter((s): s is GatheredSource => s !== null);
}

/**
 * Hard facts from the UK register: legal name, status, incorporation date.
 *
 * Matched by exact name only. A fuzzy match here would be worse than no match —
 * briefing a coach on the wrong legal entity is precisely the confident-and-wrong
 * failure the rest of this file exists to prevent.
 */
async function gatherRegistryFacts(companyName: string): Promise<CompanyRegistryFacts | null> {
  if (!isCompaniesHouseConfigured()) return null;

  try {
    const hits = await searchCompanies(companyName, 5);
    const wanted = companyName.trim().toLowerCase();
    const exact = hits.find((h) => h.title.trim().toLowerCase() === wanted);
    // Also accept the register's habit of appending a suffix, e.g. "MONZO BANK
    // LIMITED" for "Monzo Bank" — but only when the name is otherwise identical.
    const suffixed = hits.find((h) => {
      const t = h.title.trim().toLowerCase();
      return t.startsWith(wanted) && /^(limited|ltd|plc|llp)\.?$/.test(t.slice(wanted.length).trim());
    });

    const chosen = exact ?? suffixed;
    if (!chosen) return null;

    return await getCompanyProfile(chosen.companyNumber);
  } catch (err) {
    console.error('[company-research] Companies House lookup failed:', err);
    return null;
  }
}

/**
 * Drop chrome, duplicates and empties, newest-relevant first.
 *
 * Jina pages come first deliberately: the company's own words outrank a
 * third-party summary of them, and the model weights earlier sources more.
 */
function selectSources(gathered: GatheredSource[], limit: number): GatheredSource[] {
  const seen = new Set<string>();
  const ranked = [...gathered].sort((a, b) => {
    if (a.provider !== b.provider) return a.provider === 'jina' ? -1 : 1;
    return b.text.length - a.text.length;
  });

  const out: GatheredSource[] = [];
  for (const s of ranked) {
    if (!s.url || s.text.length < MIN_USEFUL_PAGE_CHARS) continue;
    const key = normaliseUrl(s.url);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= limit) break;
  }
  return out;
}

// ── Synthesis ───────────────────────────────────────────────────────────────

interface RawBrief {
  overview?: unknown;
  products?: unknown;
  recentActivity?: unknown;
  recent_activity?: unknown;
  culture?: unknown;
  interviewAngles?: unknown;
  missingInfo?: unknown;
}

async function synthesise(
  input: CompanyResearchInput,
  sources: SourceDocument[],
  cost: CostBucket,
): Promise<RawBrief> {
  assertLlmConfigured('coaching');
  const anthropic = createAnthropicClient('coaching', { timeoutMs: SYNTHESIS_TIMEOUT_MS });
  const model = getFeatureModel('coaching');

  const response = await withRetry(() =>
    anthropic.messages.create({
      model,
      max_tokens: SYNTHESIS_MAX_TOKENS,
      system: COMPANY_BRIEF_SYSTEM,
      messages: [
        {
          role: 'user',
          content: buildCompanyBriefUser({
            companyName: input.companyName,
            jdText: input.jdText,
            sources,
          }),
        },
      ],
    }),
  );

  cost.llm('coaching.companyBrief', model, response.usage);

  if (response.stop_reason === 'max_tokens') {
    throw Object.assign(
      new Error('The company brief was cut off. Please try again.'),
      { statusCode: 502, step: 'company-research-synthesis' },
    );
  }

  const text = firstTextBlock(response.content);
  if (!text) {
    throw Object.assign(new Error('The company brief came back empty.'), {
      statusCode: 502,
      step: 'company-research-synthesis',
    });
  }

  return parseLlmJson<RawBrief>(text, 'company brief', 'company-research-synthesis');
}

// ── Entry point ─────────────────────────────────────────────────────────────

/**
 * Research one company and return a cited brief.
 *
 * Throws only when synthesis itself fails. Every source is optional: no Exa key,
 * an unreachable website and a non-UK company together produce a `sparse` brief
 * that names what is missing — which is a useful answer, not an error.
 */
export async function researchCompany(input: CompanyResearchInput): Promise<CompanyBrief> {
  const companyName = input.companyName?.trim();
  if (!companyName) {
    throw Object.assign(new Error('A company name is required.'), { statusCode: 400 });
  }

  const cost = newCostBucket('coaching.companyResearch');

  // All three in parallel: they share no state and the slowest sets the pace.
  const [exaSources, jinaSources, registry] = await Promise.all([
    gatherFromExa(input, cost),
    gatherFromJina(input),
    gatherRegistryFacts(companyName),
  ]);

  const selected = selectSources([...jinaSources, ...exaSources], 8);
  const totalChars = selected.reduce((sum, s) => sum + s.text.length, 0);
  const sources: ResearchSource[] = selected.map(({ url, title, provider }) => ({
    url,
    title,
    provider,
  }));

  // Nothing to synthesise from — say so rather than paying for a call that can
  // only invent. Note this is a normal return, not a throw.
  if (selected.length === 0) {
    cost.flush();
    const { reasons } = assessSparse({
      sources,
      totalChars,
      registry,
      citedClaimCount: 0,
      hadCompanyUrl: Boolean(input.companyUrl?.trim()),
    });
    return {
      companyName,
      sparse: true,
      sparseReasons: reasons,
      overview: [],
      products: [],
      recentActivity: [],
      culture: [],
      interviewAngles: [],
      registry,
      sources,
      missingInfo: [
        "The company's website URL",
        'Any page describing what they do — an about page, a product page, a recent article',
      ],
      generatedAt: new Date().toISOString(),
    };
  }

  const raw = await synthesise(
    input,
    selected.map(({ url, title, text }) => ({ url, title, text })),
    cost,
  );
  cost.flush();

  const allowed = selected.map((s) => s.url);
  const overview = enforceCitations(raw.overview, allowed);
  const products = enforceCitations(raw.products, allowed);
  const recentActivity = enforceCitations(raw.recentActivity ?? raw.recent_activity, allowed);
  const culture = enforceCitations(raw.culture, allowed);

  const droppedTotal =
    overview.dropped + products.dropped + recentActivity.dropped + culture.dropped;
  if (droppedTotal > 0) {
    // Worth watching: a steady stream here means the prompt is losing its grip
    // on the citation rule and the model is drifting toward its own knowledge.
    console.warn(
      `[company-research] dropped ${droppedTotal} uncited claim(s) for "${companyName}"`,
    );
  }

  const citedClaimCount =
    overview.kept.length + products.kept.length + recentActivity.kept.length + culture.kept.length;

  const { sparse, reasons } = assessSparse({
    sources,
    totalChars,
    registry,
    citedClaimCount,
    hadCompanyUrl: Boolean(input.companyUrl?.trim()),
  });

  return {
    companyName,
    sparse,
    sparseReasons: reasons,
    overview: overview.kept,
    products: products.kept,
    recentActivity: recentActivity.kept,
    culture: culture.kept,
    interviewAngles: cleanStringList(raw.interviewAngles, 6),
    registry,
    sources,
    missingInfo: cleanStringList(raw.missingInfo, 5),
    generatedAt: new Date().toISOString(),
  };
}

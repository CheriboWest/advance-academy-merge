/**
 * Reference CV service — role-family reference library used to few-shot the CV
 * Optimizer's main analysis prompt with patterns distilled from successful CVs.
 *
 * NO RAG, NO embeddings, NO vector DB. Retrieval is deterministic keyword +
 * seniority scoring over a small on-disk library:
 *
 *   backend/reference-cvs/<family>/<id>.json
 *   family ∈ { sales, accounting, analytics, operations, marketing, design }
 *
 * getReferenceExamples() returns up to 3 references ordered by relevance using
 * the priority: same role → same seniority → same industry family → adjacent
 * role. When no role/family matches, a generic ATS reference is returned so the
 * prompt always has a safe, useful exemplar.
 *
 * Only the four pattern fields (summary / experience / achievement / ATS) are
 * ever surfaced to the LLM via formatReferencePatterns(). The library files
 * themselves already exclude goodFragments, skillsPatterns, and raw CV text.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Normalised seniority buckets used for both the user CV and each reference. */
export type Seniority = 'entry' | 'mid' | 'senior';

/** Role family — mirrors the reference-cvs/ subfolders. */
export type RoleFamily = 'sales' | 'accounting' | 'analytics' | 'operations' | 'marketing' | 'design';

/** Distilled successful-CV reference. Extra fields are allowed but ignored. */
export interface ReferenceCv {
  id?: string;
  role?: string;
  seniority?: string;
  industry?: string;
  summaryPatterns?: string[];
  experiencePatterns?: string[];
  achievementPatterns?: string[];
  atsPatterns?: string[];
  [key: string]: unknown;
}

/** Reference enriched with derived retrieval metadata (computed at load time). */
interface LoadedReference extends ReferenceCv {
  family: RoleFamily;
  seniorityClass: Seniority;
  roleTokens: string[];
}

const MAX_REFERENCES = 3;

// `backend/reference-cvs/` sits two levels above this module in BOTH dev
// (src/services/*.ts via tsx) and prod (dist/services/*.js via node) — the
// build preserves the src/ → dist/ shape (rootDir ./src, outDir ./dist) and
// reference-cvs lives outside src/, so the relative path is stable.
const REFERENCE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'reference-cvs');

const FAMILIES: readonly RoleFamily[] = ['sales', 'accounting', 'analytics', 'operations', 'marketing', 'design'];

/**
 * Ordered target-role → family classifier. First family with a keyword
 * substring hit wins, so MORE SPECIFIC families must be listed before broader
 * ones (e.g. "revenue operations" → analytics must beat the generic
 * "operations"; "account manager" → sales must beat "accountant"/"accounts").
 */
const FAMILY_KEYWORDS: ReadonlyArray<readonly [RoleFamily, readonly string[]]> = [
  ['sales', ['business development', 'account manager', 'account executive', 'sales executive', 'sales manager', 'sales representative', 'sdr', 'bdr', 'commercial support', 'sales']],
  ['design', ['service designer', 'product designer', 'ux designer', 'ui designer', 'service design', 'product design', 'ux/ui', 'ui/ux', 'interaction designer', 'ux researcher', 'designer']],
  ['marketing', ['paid social', 'paid media', 'performance marketing', 'digital marketing', 'growth marketing', 'marketing manager', 'marketing specialist', 'marketing executive', 'content marketing', 'social media', 'seo', 'ppc', 'brand', 'marketing']],
  ['accounting', ['tax accountant', 'accountant', 'accounts assistant', 'accounts payable', 'accounts receivable', 'accounting', 'finance assistant', 'finance analyst', 'financial analyst', 'reporting analyst', 'sourcing analyst', 'bookkeep', 'audit', 'financial', 'finance', 'tax']],
  ['analytics', ['data analyst', 'data analytics', 'business intelligence', 'bi analyst', 'business analyst', 'market analyst', 'data scientist', 'data governance', 'revenue operations', 'insights analyst', 'analytics']],
  ['operations', ['customer operations', 'customer support', 'customer service', 'customer success', 'operations analyst', 'operations coordinator', 'operations manager', 'compliance', 'claims', 'administration', 'student services', 'kyc', 'aml', 'risk', 'admin', 'operations']],
];

// Tokens too generic to signal "same role" — stripped before role-overlap
// scoring so matches key on domain words (tax, paid, social, designer, …).
const ROLE_STOPWORDS = new Set([
  'and', 'the', 'of', 'a', 'an', 'senior', 'junior', 'mid', 'level', 'entry', 'graduate',
  'intern', 'internship', 'trainee', 'associate', 'executive', 'specialist', 'professional',
  'analyst', 'manager', 'assistant', 'coordinator', 'support', 'experienced', 'lead', 'team',
  'years', 'experience', 'strategy', 'systems', 'craft', 'focused', 'with',
]);

/**
 * Generic ATS-friendly reference used when no family matches. Keeps the
 * few-shot section useful for any role without pretending to be a domain
 * example.
 */
const GENERIC_ATS_REFERENCE: ReferenceCv = {
  id: 'generic-ats-baseline',
  role: 'Generic ATS-Optimised CV',
  seniority: 'Any',
  summaryPatterns: [
    'One concise paragraph stating role focus, years of experience, and core value proposition',
    'Names the target role and the most relevant, verifiable skills up front',
    'Avoids vague adjectives; leads with concrete domain and tooling experience',
  ],
  experiencePatterns: [
    'Start every bullet with a strong past-tense action verb',
    'Follow the impact formula: action + what you did + measurable outcome or scope + tools used',
    'Group related bullets under clear, bold functional headers where it aids scanning',
    'Keep bullets concise (ideally one line) and free of pronouns and filler',
  ],
  achievementPatterns: [
    'Quantify outcomes with real numbers (%, £/$, volume, time saved) wherever they exist',
    'Tie each achievement to a business or user outcome, not just the task performed',
    'Prefer specific, verifiable results over generic responsibility statements',
  ],
  atsPatterns: [
    'Standard reverse-chronological layout with clear section headers (Summary, Skills, Experience, Education)',
    'A dedicated, categorised skills section using exact keyword spellings from the target role',
    'Plain-text formatting: consistent date formats, no tables, columns, or graphics that break ATS parsing',
  ],
};

// ─── Seniority inference ────────────────────────────────────────────────────

function extractYears(text: string): number | null {
  // Match "5+ years", "3 years", "7 yrs" — take the largest figure present.
  let max: number | null = null;
  for (const m of text.matchAll(/(\d{1,2})\s*\+?\s*(?:years?|yrs?)/g)) {
    const n = Number(m[1]);
    if (Number.isFinite(n)) max = max === null ? n : Math.max(max, n);
  }
  return max;
}

/**
 * Infer a seniority bucket from free text (user CV or a seniority label).
 *   Intern / Graduate / Student / Trainee → entry
 *   1–4 years                             → mid
 *   5+ years / Senior / Lead / Manager    → senior
 * Strong seniority titles win first, then explicit years, then entry titles.
 */
export function inferSeniority(text: string | undefined): Seniority {
  const t = (text ?? '').toLowerCase();
  if (!t.trim()) return 'mid';

  if (/\b(senior|principal|lead|head of|vp|vice president|director|manager)\b/.test(t)) return 'senior';

  const years = extractYears(t);
  if (years !== null) {
    if (years >= 5) return 'senior';
    if (years >= 1) return 'mid';
    return 'entry';
  }

  if (/\b(intern|internship|graduate|student|trainee|entry[- ]?level|placement)\b/.test(t)) return 'entry';

  return 'mid';
}

// ─── Family + role tokenisation ─────────────────────────────────────────────

function classifyFamily(targetRole: string): RoleFamily | null {
  const role = (targetRole ?? '').toLowerCase();
  if (!role.trim()) return null;
  for (const [family, keywords] of FAMILY_KEYWORDS) {
    if (keywords.some((kw) => role.includes(kw))) return family;
  }
  return null;
}

function roleTokens(role: string | undefined): string[] {
  // Distinct domain tokens only — dedupe so a title repeating a word (e.g.
  // "Data Governance & Data Platform") does not inflate role-overlap scores.
  const tokens = (role ?? '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((tok) => tok.length > 0 && !ROLE_STOPWORDS.has(tok));
  return [...new Set(tokens)];
}

// ─── Library loading (lazy singleton) ───────────────────────────────────────

let library: LoadedReference[] | null = null;

function loadLibrary(): LoadedReference[] {
  if (library) return library;

  const loaded: LoadedReference[] = [];
  for (const family of FAMILIES) {
    const dir = join(REFERENCE_DIR, family);
    let files: string[];
    try {
      files = readdirSync(dir).filter((f) => f.endsWith('.json'));
    } catch {
      continue; // family folder missing — skip, never throw
    }

    for (const file of files) {
      try {
        const ref = JSON.parse(readFileSync(join(dir, file), 'utf8')) as ReferenceCv;
        loaded.push({
          ...ref,
          family,
          seniorityClass: inferSeniority(ref.seniority),
          roleTokens: roleTokens(ref.role),
        });
      } catch (error) {
        console.error(`[reference-cv] failed to load ${family}/${file}:`, error instanceof Error ? error.message : error);
      }
    }
  }

  library = loaded;
  return library;
}

// ─── Retrieval ──────────────────────────────────────────────────────────────

/**
 * Relevance score encoding the retrieval priority as a weighted sum, so ordering
 * is: same role ≫ same seniority ≫ same family (adjacent role). Candidates are
 * already gated to the target family, so every candidate is at least an adjacent
 * role within the same industry family.
 */
function score(ref: LoadedReference, targetTokens: Set<string>, userSeniority: Seniority): number {
  const roleOverlap = ref.roleTokens.reduce((n, tok) => (targetTokens.has(tok) ? n + 1 : n), 0);
  const seniorityMatch = ref.seniorityClass === userSeniority ? 1 : 0;
  return roleOverlap * 1000 + seniorityMatch * 100 + 10; // +10 base: same-family / adjacent role
}

/**
 * Resolve up to 3 references for a target role, ordered by relevance. Falls back
 * to a single generic ATS reference when the role maps to no family (or the
 * matched family has no loaded files). Never throws.
 *
 * @param targetRole  The role the CV is being optimised for.
 * @param userCv      Optional CV text; drives seniority inference when present.
 */
export function getReferenceExamples(targetRole: string, userCv?: string): ReferenceCv[] {
  const family = classifyFamily(targetRole);
  if (!family) return [GENERIC_ATS_REFERENCE];

  const candidates = loadLibrary().filter((ref) => ref.family === family);
  if (candidates.length === 0) return [GENERIC_ATS_REFERENCE];

  // Seniority comes from the CV when available, otherwise from the role title.
  const userSeniority = inferSeniority(userCv && userCv.trim() ? userCv : targetRole);
  const targetTokens = new Set(roleTokens(targetRole));

  return candidates
    .map((ref) => ({ ref, s: score(ref, targetTokens, userSeniority) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, MAX_REFERENCES)
    .map((entry) => entry.ref);
}

/**
 * Render references into the prompt's "REFERENCE PATTERNS FROM SUCCESSFUL CVS"
 * block. Only the four pattern fields are emitted — never goodFragments,
 * skillsPatterns, raw CV text, or identifying metadata beyond a short label — so
 * the model uses them as style/structure guidance rather than content to copy.
 */
export function formatReferencePatterns(refs: ReferenceCv[]): string {
  const sections: Array<[string, keyof ReferenceCv]> = [
    ['Summary patterns', 'summaryPatterns'],
    ['Experience patterns', 'experiencePatterns'],
    ['Achievement patterns', 'achievementPatterns'],
    ['ATS patterns', 'atsPatterns'],
  ];

  const blocks = refs
    .filter((ref): ref is ReferenceCv => Boolean(ref))
    .map((ref, index) => {
      const heading = `Reference ${index + 1}${ref.role ? ` — ${ref.role}` : ''}${ref.seniority ? ` (${ref.seniority})` : ''}:`;

      const body = sections
        .map(([label, key]) => {
          const items = Array.isArray(ref[key]) ? (ref[key] as string[]) : [];
          if (items.length === 0) return '';
          return [`${label}:`, ...items.map((item) => `- ${item}`)].join('\n');
        })
        .filter((part) => part.length > 0)
        .join('\n');

      return `${heading}\n${body}`;
    })
    .filter((block) => block.trim().length > 0);

  return blocks.length > 0 ? blocks.join('\n\n') : '(No reference patterns available.)';
}

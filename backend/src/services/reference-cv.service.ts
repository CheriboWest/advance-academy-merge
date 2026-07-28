/**
 * Reference CV service — supplies a small, hardcoded library of "successful CV"
 * pattern references used to few-shot the CV Optimizer's main analysis prompt.
 *
 * This is deliberately simple and self-contained: a keyword → filename map, plus
 * lazy JSON loading from `backend/reference-cvs/`. There is NO retrieval, NO
 * embeddings, and NO vector DB — the mapping is a plain ordered list. When no
 * role matches, a generic ATS reference is returned so the prompt always has a
 * useful, safe exemplar.
 *
 * Only the pattern fields (summary / experience / achievement / ATS) are ever
 * surfaced to the LLM via formatReferencePatterns(); the raw `goodFragments`,
 * `skillsPatterns`, and identifying metadata are intentionally NOT sent in v1 so
 * the model treats the references as style guidance, never as content to copy.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Distilled successful-CV reference. Extra fields are allowed but ignored. */
export interface ReferenceCv {
  id?: string;
  role?: string;
  seniority?: string;
  summaryPatterns?: string[];
  experiencePatterns?: string[];
  achievementPatterns?: string[];
  atsPatterns?: string[];
  [key: string]: unknown;
}

// `backend/reference-cvs/` sits two levels above this module in BOTH dev
// (src/services/*.ts via tsx) and prod (dist/services/*.js via node) — the
// build preserves the src/ → dist/ directory shape (rootDir ./src, outDir
// ./dist), and reference-cvs lives outside src/, so the relative path is stable.
const REFERENCE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'reference-cvs');

/**
 * Ordered role → reference-file mapping. Matching is first-hit on lowercased
 * substring, so MORE SPECIFIC entries must come first (e.g. "bi analyst" before
 * the generic "data analyst"; "performance marketing" before "marketing").
 */
const ROLE_MAP: ReadonlyArray<{ keywords: string[]; file: string }> = [
  { keywords: ['business intelligence', 'power bi', 'bi analyst', 'bi developer', 'reporting analyst'], file: 'bi-data-analyst-mid.json' },
  { keywords: ['data analyst', 'data analytics', 'business analyst', 'data scientist'], file: 'data-analyst-mid.json' },
  { keywords: ['performance marketing', 'paid social', 'paid media', 'paid ads', 'ppc', 'growth marketing'], file: 'performance-marketing-senior.json' },
  { keywords: ['digital marketing', 'marketing manager', 'marketing specialist', 'marketing executive', 'marketing'], file: 'digital-marketing-senior.json' },
  { keywords: ['service designer', 'service design'], file: 'service-designer-mid.json' },
  { keywords: ['product designer', 'ux designer', 'ui designer', 'ui/ux', 'ux/ui', 'product design'], file: 'product-designer-mid.json' },
  { keywords: ['compliance', 'risk', 'kyc', 'aml', 'operations analyst', 'operations & administration', 'operations coordinator'], file: 'operations-compliance-mid.json' },
  { keywords: ['customer operations', 'customer support', 'customer service', 'customer success', 'student services', 'claims handler'], file: 'customer-operations-mid.json' },
];

/**
 * Generic ATS-friendly reference used when no role in ROLE_MAP matches. Keeps
 * the prompt's few-shot section useful for any role without pretending to be a
 * domain example.
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

// Lazy cache of parsed reference files, keyed by filename. A file that fails to
// load (missing / malformed) caches `null` so we never re-read it and never
// throw into the analysis pipeline.
const cache = new Map<string, ReferenceCv | null>();

function loadReference(file: string): ReferenceCv | null {
  if (cache.has(file)) return cache.get(file) ?? null;

  let parsed: ReferenceCv | null = null;
  try {
    parsed = JSON.parse(readFileSync(join(REFERENCE_DIR, file), 'utf8')) as ReferenceCv;
  } catch (error) {
    console.error(`[reference-cv] failed to load ${file}:`, error instanceof Error ? error.message : error);
    parsed = null;
  }

  cache.set(file, parsed);
  return parsed;
}

/**
 * Resolve reference examples for a target role. Returns the single best-matching
 * reference (as a one-item array), or the generic ATS reference when nothing
 * matches or the matched file fails to load. Never throws.
 */
export function getReferenceExamples(targetRole: string): ReferenceCv[] {
  const role = (targetRole ?? '').toLowerCase();

  if (role.trim().length > 0) {
    for (const { keywords, file } of ROLE_MAP) {
      if (keywords.some((kw) => role.includes(kw))) {
        const ref = loadReference(file);
        if (ref) return [ref];
        break; // matched a role but the file is unavailable — fall through to generic
      }
    }
  }

  return [GENERIC_ATS_REFERENCE];
}

/**
 * Render references into the prompt's "REFERENCE PATTERNS FROM SUCCESSFUL CVS"
 * block. Only the four pattern fields are emitted — never goodFragments, raw CV
 * text, or identifying metadata — so the model uses them as style/structure
 * guidance rather than content to copy.
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

  return blocks.length > 0
    ? blocks.join('\n\n')
    : '(No reference patterns available.)';
}

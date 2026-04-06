/**
 * Rewrite service — produces an optimised CV using three parallel Claude calls
 * plus a validation pass to ensure missing keywords are injected.
 */
import { assertLlmConfigured, createAnthropicClient, getFeatureModel } from '../lib/llm-anthropic.js';
import type { ScoringResult } from '../lib/rubric.js';
import type { ParsedCV, ExperienceEntry } from '../types/cv-optimizer.js';
import type { EvaluationResult } from './evaluationService.js';

// ─── Exported interfaces ───────────────────────────────────────────────────────

export interface RewrittenExperience {
  role: string;
  company: string;
  dates: string;
  bullets: string[];  // rewritten using STAR/XYZ formula
}

export interface ChangeLog {
  section: string;    // e.g. "Experience — Acme Corp"
  original: string;   // original bullet or text
  rewritten: string;  // rewritten version
  reason: string;     // which weakness or missing keyword this addresses
}

export interface OptimisedCV {
  summary: string;
  experience: RewrittenExperience[];
  skills: string[];
  changeLog: ChangeLog[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function stripJsonFences(raw: string): string {
  return raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
}

function topMissingKeywords(missingKeywords: string[], n = 5): string[] {
  return missingKeywords.slice(0, n);
}

function buildChangeLog(
  parsedCV: ParsedCV,
  rewrittenExperience: RewrittenExperience[],
  originalSummary: string,
  rewrittenSummary: string,
  evaluation: EvaluationResult,
  missingKeywords: string[],
): ChangeLog[] {
  const log: ChangeLog[] = [];

  if (originalSummary.trim() !== rewrittenSummary.trim()) {
    log.push({
      section: 'Summary',
      original: originalSummary,
      rewritten: rewrittenSummary,
      reason: missingKeywords.slice(0, 3).length > 0
        ? `Inject missing keywords: ${missingKeywords.slice(0, 3).join(', ')}`
        : 'Strengthen opening statement',
    });
  }

  for (const original of parsedCV.experience) {
    const rewritten = rewrittenExperience.find(
      (r) => r.role === original.role && r.company === original.company,
    );
    if (!rewritten) continue;

    const maxBullets = Math.max(original.bullets.length, rewritten.bullets.length);
    for (let i = 0; i < maxBullets; i++) {
      const orig = original.bullets[i] ?? '';
      const rewrit = rewritten.bullets[i] ?? '';
      if (orig !== rewrit && orig && rewrit) {
        const relatedWeakness = evaluation.topWeaknesses.find((w) =>
          orig.toLowerCase().includes(w.area.toLowerCase().split(' ')[0]),
        );
        log.push({
          section: `Experience — ${original.company}`,
          original: orig,
          rewritten: rewrit,
          reason: relatedWeakness
            ? `Addresses weakness: ${relatedWeakness.area}`
            : 'Strengthen impact and metrics (STAR/XYZ)',
        });
      }
    }
  }

  return log;
}

// ─── Individual call wrappers ─────────────────────────────────────────────────

async function rewriteSummary(
  parsedCV: ParsedCV,
  missingKeywords: string[],
  anthropic: ReturnType<typeof createAnthropicClient>,
  model: string,
): Promise<string> {
  const top5 = topMissingKeywords(missingKeywords);

  const systemPrompt = [
    'Rewrite this professional summary to be compelling, specific, and directly aligned with the target role.',
    'Rules: 3–4 sentences maximum. Open with the candidate\'s strongest relevant credential.',
    top5.length > 0
      ? `Naturally include these missing keywords: ${top5.join(', ')}.`
      : '',
    'Do not invent facts. Do not use phrases like "passionate about" or "results-driven".',
    'Return ONLY the rewritten summary as a plain string. No JSON, no markdown.',
  ].filter(Boolean).join(' ');

  const response = await anthropic.messages.create({
    model,
    max_tokens: 512,
    system: systemPrompt,
    messages: [{ role: 'user', content: `ORIGINAL SUMMARY:\n${parsedCV.summary}` }],
  });

  const block = response.content[0];
  if (block.type !== 'text') {
    throw new Error('Rewrite service (summary): Claude response was not a text block.');
  }

  return block.text.trim();
}

async function rewriteExperience(
  parsedCV: ParsedCV,
  missingKeywords: string[],
  evaluation: EvaluationResult,
  anthropic: ReturnType<typeof createAnthropicClient>,
  model: string,
): Promise<RewrittenExperience[]> {
  const weaknessList = evaluation.topWeaknesses
    .map((w) => `- ${w.area}: ${w.suggestion}`)
    .join('\n');

  const systemPrompt = [
    'Rewrite the experience bullets using the STAR/XYZ formula:',
    '[Strong action verb] + [what you did / scope] + [measurable result or outcome].',
    'Rules:',
    '- Every bullet must start with a strong active verb (no "was responsible for", "helped", "assisted")',
    '- Every bullet should contain at least one metric — if the original has none, restructure to imply scale or scope',
    missingKeywords.length > 0
      ? `- Naturally inject these missing keywords where genuinely relevant: ${missingKeywords.join(', ')}`
      : '',
    '- Do not invent specific numbers that were not in the original',
    '- Preserve all company names, job titles, and dates exactly',
    `- Fix every weakness flagged here:\n${weaknessList}`,
    'Return ONLY valid JSON: array of objects with shape { role, company, dates, bullets[] }.',
  ].filter(Boolean).join('\n');

  const experienceText = parsedCV.experience
    .map(
      (e) =>
        `Role: ${e.role}\nCompany: ${e.company}\nDates: ${e.dates}\nBullets:\n${e.bullets.map((b) => `  - ${b}`).join('\n')}`,
    )
    .join('\n\n');

  const response = await anthropic.messages.create({
    model,
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: 'user', content: `EXPERIENCE ENTRIES:\n\n${experienceText}` }],
  });

  const block = response.content[0];
  if (block.type !== 'text') {
    throw new Error('Rewrite service (experience): Claude response was not a text block.');
  }

  const parsed = JSON.parse(stripJsonFences(block.text)) as unknown;

  if (!Array.isArray(parsed)) {
    throw new Error('Rewrite service (experience): response is not an array.');
  }

  return parsed as RewrittenExperience[];
}

async function rewriteSkills(
  parsedCV: ParsedCV,
  missingKeywords: string[],
  anthropic: ReturnType<typeof createAnthropicClient>,
  model: string,
): Promise<string[]> {
  const systemPrompt = [
    'Reorganise and expand this skills section.',
    'Rules:',
    '- Group by category: Technical Skills, Tools & Platforms, Soft Skills',
    '- Promote matched keywords to the top of each group',
    missingKeywords.length > 0
      ? `- Add any missing keywords from this list that the candidate plausibly has based on their experience: ${missingKeywords.join(', ')}`
      : '',
    '- Do not add skills that have zero evidence in the experience section',
    'Return ONLY valid JSON: a flat string array in priority order.',
  ].filter(Boolean).join('\n');

  const response = await anthropic.messages.create({
    model,
    max_tokens: 1024,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: `CURRENT SKILLS:\n${parsedCV.skills.join(', ')}\n\nEXPERIENCE CONTEXT:\n${parsedCV.experience.map((e) => e.bullets.join(' ')).join('\n')}`,
      },
    ],
  });

  const block = response.content[0];
  if (block.type !== 'text') {
    throw new Error('Rewrite service (skills): Claude response was not a text block.');
  }

  const parsed = JSON.parse(stripJsonFences(block.text)) as unknown;

  if (!Array.isArray(parsed)) {
    throw new Error('Rewrite service (skills): response is not an array.');
  }

  return parsed as string[];
}

interface KeywordRevision {
  original: string;
  revised: string;
  keyword: string;
}

async function injectMissingKeywords(
  missing: string[],
  experience: RewrittenExperience[],
  anthropic: ReturnType<typeof createAnthropicClient>,
  model: string,
): Promise<RewrittenExperience[]> {
  if (missing.length === 0) return experience;

  const allBullets = experience.flatMap((e) =>
    e.bullets.map((b) => ({ role: e.role, company: e.company, bullet: b })),
  );

  const systemPrompt = [
    `The following high-priority keywords did not appear in the rewritten CV: ${missing.join(', ')}.`,
    'Revise the single most relevant experience bullet to include each one naturally.',
    'Return ONLY valid JSON: array of { original: string, revised: string, keyword: string }.',
  ].join(' ');

  const userPrompt = `AVAILABLE BULLETS:\n${allBullets.map((b) => `  - ${b.bullet}`).join('\n')}`;

  const response = await anthropic.messages.create({
    model,
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const block = response.content[0];
  if (block.type !== 'text') return experience;

  let revisions: KeywordRevision[];
  try {
    revisions = JSON.parse(stripJsonFences(block.text)) as KeywordRevision[];
  } catch {
    return experience;
  }

  // Apply revisions to the experience array
  const updated = experience.map((entry): RewrittenExperience => ({
    ...entry,
    bullets: entry.bullets.map((bullet) => {
      const revision = revisions.find((r) => r.original === bullet);
      return revision ? revision.revised : bullet;
    }),
  }));

  return updated;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function rewriteCV(
  parsedCV: ParsedCV,
  scoringResult: ScoringResult,
  evaluation: EvaluationResult,
): Promise<OptimisedCV> {
  assertLlmConfigured('cvOptimizer');

  const anthropic = createAnthropicClient();
  const model = getFeatureModel('cvOptimizer');
  const { missingKeywords } = scoringResult;

  // ── Three parallel rewrite calls ─────────────────────────────────────────
  let summary: string;
  let experience: RewrittenExperience[];
  let skills: string[];

  try {
    [summary, experience, skills] = await Promise.all([
      rewriteSummary(parsedCV, missingKeywords, anthropic, model),
      rewriteExperience(parsedCV, missingKeywords, evaluation, anthropic, model),
      rewriteSkills(parsedCV, missingKeywords, anthropic, model),
    ]);
  } catch (error) {
    throw new Error(
      `Rewrite service (parallel rewrite) failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // ── Post-process: verify top 5 missing keywords are present ─────────────
  const top5Missing = topMissingKeywords(missingKeywords);
  const rewrittenText = [summary, ...experience.flatMap((e) => e.bullets), ...skills]
    .join(' ')
    .toLowerCase();

  const stillMissing = top5Missing.filter((kw) => !rewrittenText.includes(kw.toLowerCase()));

  if (stillMissing.length > 0) {
    try {
      experience = await injectMissingKeywords(stillMissing, experience, anthropic, model);
    } catch (error) {
      // Non-fatal — log and continue without injection
      console.warn('Rewrite service: keyword injection pass failed.', error);
    }
  }

  // ── Build change log (programmatic, no LLM) ──────────────────────────────
  const changeLog = buildChangeLog(
    parsedCV,
    experience,
    parsedCV.summary,
    summary,
    evaluation,
    missingKeywords,
  );

  return { summary, experience, skills, changeLog };
}

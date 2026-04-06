/**
 * Scoring service — semantic embeddings + Claude rubric evaluation.
 * Returns a ScoringResult with a composite final score.
 */
import { embedBatch } from '../lib/embeddings.js';
import { averageSimilarity } from '../lib/cosine.js';
import { ScoringRubric, type RubricScore, type ScoringResult } from '../lib/rubric.js';
import { assertLlmConfigured, createAnthropicClient, getFeatureModel } from '../lib/llm-anthropic.js';
import type { ParsedCV, ParsedJD } from '../types/cv-optimizer.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function stripJsonFences(raw: string): string {
  return raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
}

function flattenCvChunks(cv: ParsedCV): string[] {
  const chunks: string[] = [];

  if (cv.summary.trim()) chunks.push(cv.summary.trim());
  if (cv.skills.length > 0) chunks.push(cv.skills.join(', '));

  for (const entry of cv.experience) {
    const roleText = [entry.role, entry.company, ...entry.bullets].join(' ');
    if (roleText.trim()) chunks.push(roleText.trim());
  }

  return chunks;
}

function flattenJdChunks(jd: ParsedJD): string[] {
  const chunks: string[] = [];

  for (const skill of jd.requiredSkills) {
    if (skill.trim()) chunks.push(skill.trim());
  }

  const requirements = [
    ...jd.requiredSkills,
    ...jd.niceToHave,
    ...jd.bodyKeywords,
  ].join(' ');

  if (requirements.trim()) chunks.push(requirements.trim());

  return chunks;
}

function extractKeywords(cv: ParsedCV, jd: ParsedJD): { matched: string[]; missing: string[] } {
  const cvTextLower = cv.fullText.toLowerCase();
  const candidates = [...jd.titleKeywords, ...jd.requiredSkills];

  const matched: string[] = [];
  const missing: string[] = [];

  for (const keyword of candidates) {
    if (cvTextLower.includes(keyword.toLowerCase())) {
      matched.push(keyword);
    } else {
      missing.push(keyword);
    }
  }

  // Deduplicate, title keywords first in missing (higher priority)
  const titleSet = new Set(jd.titleKeywords.map((k) => k.toLowerCase()));
  missing.sort((a, b) => {
    const aTitle = titleSet.has(a.toLowerCase()) ? 0 : 1;
    const bTitle = titleSet.has(b.toLowerCase()) ? 0 : 1;
    return aTitle - bTitle;
  });

  return {
    matched: [...new Set(matched)],
    missing: [...new Set(missing)],
  };
}

function validateRubricScores(raw: unknown): RubricScore[] {
  if (!Array.isArray(raw)) {
    throw new Error('Scoring service: Claude rubric response is not an array.');
  }

  const expectedDimensions = new Set(ScoringRubric.map((r) => r.dimension));
  const scores: RubricScore[] = [];

  for (const item of raw) {
    if (
      typeof item !== 'object' ||
      item === null ||
      typeof (item as Record<string, unknown>).dimension !== 'string' ||
      typeof (item as Record<string, unknown>).score !== 'number' ||
      typeof (item as Record<string, unknown>).reasoning !== 'string'
    ) {
      throw new Error('Scoring service: rubric item missing required fields (dimension, score, reasoning).');
    }

    const score = (item as RubricScore).score;
    if (!Number.isInteger(score) || score < 1 || score > 10) {
      throw new Error(`Scoring service: score for "${(item as RubricScore).dimension}" must be an integer 1–10, got ${score}.`);
    }

    scores.push(item as RubricScore);
  }

  const returnedDimensions = new Set(scores.map((s) => s.dimension));
  for (const dim of expectedDimensions) {
    if (!returnedDimensions.has(dim)) {
      throw new Error(`Scoring service: Claude did not return a score for dimension "${dim}".`);
    }
  }

  return scores;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function scoreCV(parsedCV: ParsedCV, parsedJD: ParsedJD): Promise<ScoringResult> {
  assertLlmConfigured('cvOptimizer');

  // ── Part A: Semantic scoring via embeddings ──────────────────────────────
  const cvChunks = flattenCvChunks(parsedCV);
  const jdChunks = flattenJdChunks(parsedJD);

  let semanticScore = 0;

  try {
    const [cvVectors, jdVectors] = await Promise.all([
      embedBatch(cvChunks),
      embedBatch(jdChunks),
    ]);
    semanticScore = averageSimilarity(cvVectors, jdVectors);
  } catch (error) {
    // Embeddings are optional — degrade gracefully if the key is not configured
    console.warn('Scoring service: embeddings unavailable, semantic score set to 0.', error);
    semanticScore = 0;
  }

  // ── Part B: Keyword matching (gap reporting only) ────────────────────────
  const { matched: matchedKeywords, missing: missingKeywords } = extractKeywords(parsedCV, parsedJD);

  // ── Part C: Claude rubric scoring ────────────────────────────────────────
  const anthropic = createAnthropicClient();
  const model = getFeatureModel('cvOptimizer');

  const rubricText = ScoringRubric.map(
    (r) => `Dimension: ${r.dimension}\nDescription: ${r.description}\nScale: ${r.scale}`,
  ).join('\n\n');

  const systemPrompt = [
    'You are an expert CV evaluator. You will be given a CV and a Job Description.',
    'You must score the CV against the JD across exactly 4 dimensions using the provided rubric.',
    'Return ONLY a valid JSON array. No markdown, no explanation, no preamble.',
    'Each item must match exactly: { "dimension": string, "score": number, "reasoning": string }',
    'Scores must be integers from 1 to 10. Reasoning must be one sentence maximum.',
    'Do not be generous — score what is actually present in the CV, not what could be inferred.',
  ].join(' ');

  const userPrompt = [
    '=== CV ===',
    parsedCV.fullText,
    '',
    '=== JOB DESCRIPTION ===',
    parsedJD.fullText,
    '',
    '=== SCORING RUBRIC ===',
    rubricText,
    '',
    'Return the JSON array of 4 rubric scores now.',
  ].join('\n');

  let rubricScores: RubricScore[];

  try {
    const response = await anthropic.messages.create({
      model,
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const block = response.content[0];
    if (block.type !== 'text') {
      throw new Error('Scoring service: Claude rubric response was not a text block.');
    }

    const parsed = JSON.parse(stripJsonFences(block.text)) as unknown;
    rubricScores = validateRubricScores(parsed);
  } catch (error) {
    throw new Error(
      `Scoring service (rubric step) failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // ── Calculate composite scores ────────────────────────────────────────────
  const weightedRubricScore = Math.round(
    ScoringRubric.reduce((sum, rubric) => {
      const match = rubricScores.find((s) => s.dimension === rubric.dimension);
      return sum + ((match?.score ?? 0) / 10) * rubric.weight * 100;
    }, 0),
  );

  const finalScore = Math.round(semanticScore * 0.4 + weightedRubricScore * 0.6);

  return {
    semanticScore,
    rubricScores,
    weightedRubricScore,
    finalScore,
    matchedKeywords,
    missingKeywords,
  };
}

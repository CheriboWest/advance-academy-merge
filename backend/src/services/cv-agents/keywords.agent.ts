/**
 * Keywords agent — owns `keywordHighlights`.
 *
 * Part of the dormant CV Optimizer agent architecture (step 3). Wraps the
 * CV_KEYWORDS_PROMPT module and runJsonTask(), returning only its owned slice.
 * No todayInstruction(): keyword extraction does not judge date realism. Not
 * wired into buildLlmAnalysis(); nothing calls this yet.
 *
 * NOTE: this JD keyword extraction intentionally overlaps the ATS pipeline's
 * extractAtsKeywords() — deduplication is out of scope for this refactor.
 */
import { assertLlmConfigured, createAnthropicClient, getFeatureModel } from '../../lib/llm-anthropic.js';
import { runJsonTask } from '../../lib/run-json-task.js';
import { CV_KEYWORDS_PROMPT } from '../../prompts/cv-keywords.prompt.js';
import type { KeywordHighlight } from '@advance-academy/contracts/cv-optimizer';

export interface KeywordsInput {
  targetRole: string;
  cvText: string;
  jobDescription?: string;
}

export interface KeywordsOut {
  keywordHighlights: KeywordHighlight[];
}

export async function extractKeywords(input: KeywordsInput): Promise<KeywordsOut> {
  assertLlmConfigured('cvOptimizer');
  const anthropic = createAnthropicClient('cvOptimizer');
  // TODO: route to Haiku/Sonnet via centralized MODELS config.
  const model = getFeatureModel('cvOptimizer');

  const user = [
    `TARGET ROLE: ${input.targetRole}`,
    '',
    '=== CV ===',
    input.cvText,
    '',
    input.jobDescription?.trim()
      ? `=== JOB DESCRIPTION ===\n${input.jobDescription.trim()}`
      : '(No job description provided — evaluate the CV against the target role only.)',
  ].join('\n');

  const raw = await runJsonTask<Partial<KeywordsOut>>({
    anthropic,
    model,
    system: CV_KEYWORDS_PROMPT,
    user,
    maxTokens: 2048,
    label: 'cv-keywords',
  });

  return {
    keywordHighlights: raw.keywordHighlights ?? [],
  };
}

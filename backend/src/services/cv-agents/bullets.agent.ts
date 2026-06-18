/**
 * Bullets agent — owns `bulletEvaluations` and `rewriteSuggestions`.
 *
 * Part of the dormant CV Optimizer agent architecture (step 3). Wraps the
 * CV_BULLETS_PROMPT module and runJsonTask(), returning only its owned slice.
 * Does not use the JD — bullet impact is judged against the CV only. Highest
 * maxTokens of the four agents (largest output). Not wired into
 * buildLlmAnalysis(); nothing calls this yet.
 */
import { assertLlmConfigured, createAnthropicClient, getFeatureModel } from '../../lib/llm-anthropic.js';
import { runJsonTask } from '../../lib/run-json-task.js';
import { CV_BULLETS_PROMPT } from '../../prompts/cv-bullets.prompt.js';
import { todayInstruction } from './today-instruction.js';
import type { BulletEvaluation, RewriteSuggestion } from '@advance-academy/contracts/cv-optimizer';

export interface BulletsInput {
  targetRole: string;
  cvText: string;
}

export interface BulletsOut {
  bulletEvaluations: BulletEvaluation[];
  rewriteSuggestions: RewriteSuggestion[];
}

export async function analyzeBullets(input: BulletsInput): Promise<BulletsOut> {
  assertLlmConfigured('cvOptimizer');
  const anthropic = createAnthropicClient('cvOptimizer');
  // TODO: route to Haiku/Sonnet via centralized MODELS config.
  const model = getFeatureModel('cvOptimizer');

  const user = [
    `TARGET ROLE: ${input.targetRole}`,
    '',
    '=== CV ===',
    input.cvText,
  ].join('\n');

  const raw = await runJsonTask<Partial<BulletsOut>>({
    anthropic,
    model,
    system: `${todayInstruction()}\n\n${CV_BULLETS_PROMPT}`,
    user,
    maxTokens: 16384,
    label: 'cv-bullets',
  });

  return {
    bulletEvaluations: raw.bulletEvaluations ?? [],
    rewriteSuggestions: raw.rewriteSuggestions ?? [],
  };
}

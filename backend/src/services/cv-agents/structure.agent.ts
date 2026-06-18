/**
 * Structure agent — owns `sections` and `formatCheck`.
 *
 * Part of the dormant CV Optimizer agent architecture (step 3). Wraps the
 * CV_STRUCTURE_PROMPT module and runJsonTask(), returning only its owned slice.
 * It is unaware of AnalyzeCvResult as a whole and does no business validation —
 * the caller's normalizeResult handles that. Not wired into buildLlmAnalysis();
 * nothing calls this yet.
 */
import { assertLlmConfigured, createAnthropicClient, getFeatureModel } from '../../lib/llm-anthropic.js';
import { runJsonTask } from '../../lib/run-json-task.js';
import { CV_STRUCTURE_PROMPT } from '../../prompts/cv-structure.prompt.js';
import { todayInstruction } from './today-instruction.js';
import { normalizeStructure } from './normalizers.js';
import type { AnalyzeCvResult, FormatCheck } from '@advance-academy/contracts/cv-optimizer';

export interface StructureInput {
  targetRole: string;
  cvText: string;
  jobDescription?: string;
}

export interface StructureOut {
  sections: AnalyzeCvResult['sections'];
  formatCheck: FormatCheck;
}

export async function analyzeStructure(input: StructureInput): Promise<StructureOut> {
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

  const raw = await runJsonTask<Partial<StructureOut>>({
    anthropic,
    model,
    system: `${todayInstruction()}\n\n${CV_STRUCTURE_PROMPT}`,
    user,
    maxTokens: 2048,
    label: 'cv-structure',
  });

  return normalizeStructure(raw);
}

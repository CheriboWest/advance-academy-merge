/**
 * Centralized model routing for the CV Optimizer V2 branches.
 *
 * All V2 branches currently route to Haiku for latency: the lightweight agents
 * (structure/keywords/alignment) plus bullets and the ATS pipeline. bullets was
 * moved off Sonnet after profiling showed it dominated the fan-out (~41s); ats
 * became the next bottleneck once bullets sped up. If bullets quality regresses,
 * override just that branch via LLM_MODEL_CV_BULLETS.
 *
 * Local to cv-agents — does NOT touch config/llm.ts. Only the V2 path consumes
 * this. The live monolith (buildLlmAnalysis) is unaffected.
 *
 * Override precedence (per call, lazy — read at call time):
 *   1. LLM_MODEL_CV_<BRANCH>  (e.g. LLM_MODEL_CV_BULLETS) — per-branch override
 *   2. LLM_MODEL_CV_HAIKU or DEFAULT_HAIKU_MODEL
 */
export type CvAgent = 'structure' | 'keywords' | 'bullets' | 'alignment' | 'ats';

const DEFAULT_HAIKU_MODEL = 'claude-haiku-4-5';

function envValue(key: string): string | undefined {
  const v = process.env[key]?.trim();
  return v && v.length > 0 ? v : undefined;
}

/** Resolve the model for a CV V2 branch. */
export function cvAgentModel(agent: CvAgent): string {
  return envValue(`LLM_MODEL_CV_${agent.toUpperCase()}`)
    ?? envValue('LLM_MODEL_CV_HAIKU')
    ?? DEFAULT_HAIKU_MODEL;
}

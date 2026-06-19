/**
 * Centralized model routing for the dormant CV Optimizer agents.
 *
 * Local to cv-agents — does NOT touch config/llm.ts. Lightweight agents
 * (structure, keywords, alignment) route to Haiku; the reasoning-heavy bullets
 * agent stays on the configured cvOptimizer (Sonnet-tier) model. Resolution is
 * lazy so env/test overrides apply at call time.
 *
 * Only the four V2-only agents consume this. buildAtsCheck and
 * generateActionPlan are shared with the live monolith and are intentionally
 * NOT routed here.
 *
 * Override precedence (per call):
 *   1. LLM_MODEL_CV_<AGENT>  (e.g. LLM_MODEL_CV_STRUCTURE) — per-agent override
 *   2. tier default:
 *        - lightweight → LLM_MODEL_CV_HAIKU or DEFAULT_HAIKU_MODEL
 *        - bullets     → getFeatureModel('cvOptimizer')
 */
import { getFeatureModel } from '../../lib/llm-anthropic.js';

export type CvAgent = 'structure' | 'keywords' | 'bullets' | 'alignment';

const DEFAULT_HAIKU_MODEL = 'claude-haiku-4-5';

function envValue(key: string): string | undefined {
  const v = process.env[key]?.trim();
  return v && v.length > 0 ? v : undefined;
}

/** Haiku-tier model for lightweight agents (env-overridable via LLM_MODEL_CV_HAIKU). */
function haikuModel(): string {
  return envValue('LLM_MODEL_CV_HAIKU') ?? DEFAULT_HAIKU_MODEL;
}

/** Sonnet-tier model for reasoning-heavy agents — reuses the configured cvOptimizer model. */
function sonnetModel(): string {
  return getFeatureModel('cvOptimizer');
}

/** Resolve the model for a CV agent. Lazy — reads config/env at call time. */
export function cvAgentModel(agent: CvAgent): string {
  const perAgent = envValue(`LLM_MODEL_CV_${agent.toUpperCase()}`);
  if (perAgent) return perAgent;
  return agent === 'bullets' ? sonnetModel() : haikuModel();
}

export type LlmProvider = 'anthropic' | 'openai';

export type LlmFeature =
  | 'default'
  | 'cvOptimizer'
  | 'outreach'
  | 'dreamCompany'
  | 'interviewPrep'
  | 'interviewScoring'
  | 'coaching';

export interface LlmFeatureConfig {
  enabled: boolean;
  provider: LlmProvider;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  hasApiKey: boolean;
  anthropicApiVersion: string;
}

const DEFAULT_PROVIDER: LlmProvider = 'anthropic';
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_ANTHROPIC_BASE_URL = 'https://api.anthropic.com/v1';
const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-4-20250514';
const DEFAULT_OPENAI_MODEL = 'gpt-4.1-mini';
const DEFAULT_ANTHROPIC_API_VERSION = '2023-06-01';

function readRequiredString(value: string | undefined, fallback: string) {
  const trimmed = value?.trim();

  return trimmed && trimmed.length > 0 ? trimmed : fallback;
}

function readTimeout(value: string | undefined) {
  const parsed = Number(value);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
}

function getProvider(): LlmProvider {
  const provider = process.env.LLM_PROVIDER?.trim().toLowerCase();

  if (provider === undefined || provider === '') {
    return DEFAULT_PROVIDER;
  }

  if (provider === 'anthropic') {
    return provider;
  }

  if (provider === 'openai') {
    return provider;
  }

  throw new Error(`Unsupported LLM_PROVIDER "${provider}". Supported providers: anthropic, openai.`);
}

function getDefaultBaseUrl(provider: LlmProvider) {
  return provider === 'anthropic' ? DEFAULT_ANTHROPIC_BASE_URL : DEFAULT_OPENAI_BASE_URL;
}

function getDefaultModel(provider: LlmProvider) {
  return provider === 'anthropic' ? DEFAULT_ANTHROPIC_MODEL : DEFAULT_OPENAI_MODEL;
}

function getFeatureModels(provider: LlmProvider): Record<LlmFeature, string> {
  const defaultModel = readRequiredString(process.env.LLM_MODEL_DEFAULT, getDefaultModel(provider));

  return {
    default: defaultModel,
    cvOptimizer: readRequiredString(process.env.LLM_MODEL_CV_OPTIMIZER, defaultModel),
    outreach: readRequiredString(process.env.LLM_MODEL_OUTREACH, defaultModel),
    dreamCompany: readRequiredString(process.env.LLM_MODEL_DREAM_COMPANY, defaultModel),
    interviewPrep: readRequiredString(process.env.LLM_MODEL_INTERVIEW_PREP, defaultModel),
    interviewScoring: readRequiredString(
      process.env.LLM_MODEL_INTERVIEW_SCORING,
      readRequiredString(process.env.LLM_MODEL_INTERVIEW_PREP, defaultModel),
    ),
    // Falls back to LLM_MODEL_DEFAULT, deliberately NOT to LLM_MODEL_DREAM_COMPANY.
    // Dream Company was moved to Haiku for cost after a quality comparison, and
    // chaining onto it would have silently made coaching a Haiku feature too.
    // Coaching output is read by a coach, edited, and then handed to a student
    // before a real interview — the one place a cheaper model is a false economy.
    // Set LLM_MODEL_COACHING to override.
    coaching: readRequiredString(process.env.LLM_MODEL_COACHING, defaultModel),
  };
}

function getFeatureApiKey(feature: LlmFeature): string {
  const fallback = process.env.LLM_API_KEY?.trim() ?? '';
  const pick = (value: string | undefined) => {
    const trimmed = value?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : fallback;
  };

  switch (feature) {
    case 'outreach':
    case 'dreamCompany':
    // Coaching shares the Outreach key: it runs the same kind of workload
    // (web-grounded research + synthesis) against the same quota.
    case 'coaching':
      return pick(process.env.LLM_API_KEY_OUTREACH);
    case 'cvOptimizer':
      return pick(process.env.LLM_API_KEY_CV);
    case 'interviewPrep':
    case 'interviewScoring':
      return pick(process.env.LLM_API_KEY_INTERVIEW);
    case 'default':
    default:
      return fallback;
  }
}

export function getLlmConfig(feature: LlmFeature = 'default'): LlmFeatureConfig {
  const provider = getProvider();
  const baseUrl = readRequiredString(process.env.LLM_BASE_URL, getDefaultBaseUrl(provider));
  const timeoutMs = readTimeout(process.env.LLM_TIMEOUT_MS);
  const apiKey = getFeatureApiKey(feature);
  const anthropicApiVersion = readRequiredString(process.env.LLM_ANTHROPIC_API_VERSION, DEFAULT_ANTHROPIC_API_VERSION);
  const featureModels = getFeatureModels(provider);

  return {
    enabled: apiKey.length > 0,
    provider,
    baseUrl,
    model: featureModels[feature],
    timeoutMs,
    hasApiKey: apiKey.length > 0,
    anthropicApiVersion,
  };
}

export function getLlmApiKey(feature: LlmFeature = 'default') {
  return getFeatureApiKey(feature);
}

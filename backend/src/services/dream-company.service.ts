/**
 * Dream Company — service called from routes only.
 * Uses lib/dream-company/prompts (all prompt builders) and lib/llm-anthropic (Anthropic SDK).
 */
import mammoth from 'mammoth';
import type {
  DreamCompanyInput,
  ProfileAnalysis,
  TargetRole,
  CareerRoadmap,
  ExaJobListing,
  RoadmapResponse,
} from '../types/dream-company.js';
import {
  buildCareerRoadmapPrompt,
  buildDreamCompanyCvParseInstructions,
  buildDreamCompanyCvParsePrompt,
  buildProfileAnalysisPrompt,
  buildTargetRolesPrompt,
} from '../lib/dream-company/prompts.js';
import { assertLlmConfigured, createAnthropicClient, getFeatureModel, withRetry } from '../lib/llm-anthropic.js';
import { getExaClient, withExaRetry } from '../lib/exa-client.js';
import { newCostBucket, type CostBucket } from '../lib/cost-tracker.js';

const EXA_OPTIONS = {
  useAutoprompt: true,
  type: "fast",
  numResults: 20,
} as const;

/**
 * Per-step SDK timeouts (ms), env-overridable. Defaults are aligned with the proxy budgets in
 * shared/api/backend-client.ts (analyze 30s, roles 60s, roadmap 180s, parse-cv 120s) so the
 * backend aborts in step with the client instead of hanging on the SDK's 10-minute default.
 * A single global timeout would kill the slow roles/roadmap steps on the happy path.
 */
function stepTimeoutMs(envVar: string, fallbackMs: number): number {
  const parsed = Number(process.env[envVar]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackMs;
}

const DREAM_TIMEOUTS = {
  analyze: () => stepTimeoutMs('LLM_TIMEOUT_DREAM_ANALYZE_MS', 30_000),
  roles: () => stepTimeoutMs('LLM_TIMEOUT_DREAM_ROLES_MS', 60_000),
  roadmap: () => stepTimeoutMs('LLM_TIMEOUT_DREAM_ROADMAP_MS', 120_000),
  parseCv: () => stepTimeoutMs('LLM_TIMEOUT_DREAM_PARSECV_MS', 90_000),
};

// maxRetries: 0 because withRetry() already handles 429 backoff — layering the SDK's own
// retries on top would multiply the effective timeout wall-time and defeat the bounded abort.
function dreamClient(timeoutMs: number) {
  return createAnthropicClient('dreamCompany', { timeoutMs, maxRetries: 0 });
}

function cleanJsonResponse(text: string): string {
  return text
    .replace(/^```(?:json)?\s*\n?/, '')
    .replace(/\n?\s*```$/, '')
    .trim();
}

function extractText(response: { content: Array<{ type: string; text?: string }> }): string {
  const block = response.content[0];
  if (block?.type === 'text' && typeof block.text === 'string') {
    return cleanJsonResponse(block.text);
  }
  return '';
}

/**
 * Parse an LLM JSON response for one Dream Company step.
 * Distinguishes a truncated response (hit max_tokens → retryable 502) from genuinely
 * malformed JSON (→ 500 with step), so the user never gets a raw parse error or a
 * confusing 500 when the model simply ran out of output budget.
 */
function parseStepResponse<T>(
  response: { stop_reason?: string | null; content: Array<{ type: string; text?: string }> },
  step: string,
): T {
  if (response.stop_reason === 'max_tokens') {
    console.error(`[dream-company] ${step} hit max_tokens — response truncated.`);
    throw Object.assign(
      new Error('The AI response was too long and got cut off. Please try again.'),
      { statusCode: 502, step },
    );
  }
  try {
    return JSON.parse(extractText(response)) as T;
  } catch {
    throw Object.assign(new Error('Failed to parse LLM response'), { step });
  }
}

export function validateDreamCompanyProfile(profile: DreamCompanyInput | undefined): string[] {
  const missing: string[] = [];
  if (!profile?.degree) missing.push('degree');
  if (!profile?.workExperience) missing.push('workExperience');
  if (!profile?.skills) missing.push('skills');
  if (!profile?.location) missing.push('location');
  return missing;
}

export async function generateProfileAnalysis(
  profile: DreamCompanyInput,
): Promise<ProfileAnalysis> {
  assertLlmConfigured('dreamCompany');
  const anthropic = dreamClient(DREAM_TIMEOUTS.analyze());
  const model = getFeatureModel('dreamCompany');
  const cost = newCostBucket('dreamCompany.analyze');

  const response = await withRetry(() => anthropic.messages.create({
    model,
    max_tokens: 4096,
    system: 'You are a career intelligence engine. Return only valid JSON.',
    messages: [{ role: 'user', content: buildProfileAnalysisPrompt(profile) }],
  }));
  cost.llm('analyze', model, response.usage);
  cost.flush();

  return parseStepResponse<ProfileAnalysis>(response, 'profileAnalysis');
}

export async function generateTargetRoles(
  profile: DreamCompanyInput,
  analysis: ProfileAnalysis,
): Promise<TargetRole[]> {
  assertLlmConfigured('dreamCompany');
  const anthropic = dreamClient(DREAM_TIMEOUTS.roles());
  const model = getFeatureModel('dreamCompany');
  const cost = newCostBucket('dreamCompany.roles');

  const response = await withRetry(() => anthropic.messages.create({
    model,
    // 10 roles ≈ ~1200 output tokens (measured: 20 roles ≈ 2384). 4096 leaves a wide safety
    // margin; M1.2's stop_reason=max_tokens guard turns any truncation into a clean 502.
    max_tokens: 4096,
    system: 'You are a career intelligence engine. Return only valid JSON.',
    messages: [{ role: 'user', content: buildTargetRolesPrompt(profile, analysis) }],
  }));
  cost.llm('roles', model, response.usage);
  cost.flush();

  return parseStepResponse<TargetRole[]>(response, 'targetRoles');
}

export async function generateRoadmapWithJobs(
  profile: DreamCompanyInput,
  analysis: ProfileAnalysis,
  selectedRoles: TargetRole[],
): Promise<RoadmapResponse> {
  assertLlmConfigured('dreamCompany');
  const anthropic = dreamClient(DREAM_TIMEOUTS.roadmap());
  const model = getFeatureModel('dreamCompany');
  const cost = newCostBucket('dreamCompany.roadmap');

  // Fetch the Exa job listings FIRST so the roadmap prompt can reference real, current
  // openings. Running the search and the LLM call in parallel meant the prompt was always
  // built with an empty job list (AAT-9). Still exactly one Exa search — no extra calls.
  const { jobs, error: jobsError } = await searchJobsForRoles(selectedRoles, profile, cost);

  const roadmapResponse = await withRetry(() => anthropic.messages.create({
    model,
    max_tokens: 4096,
    system: 'You are a career intelligence engine. Return only valid JSON.',
    messages: [{ role: 'user', content: buildCareerRoadmapPrompt(profile, analysis, selectedRoles, jobs) }],
  }));
  cost.llm('roadmap', model, roadmapResponse.usage);
  cost.flush();

  const roadmap = parseStepResponse<CareerRoadmap>(roadmapResponse, 'careerRoadmap');

  return { jobs, roadmap, jobsError };
}

async function searchJobsForRoles(
  selectedRoles: TargetRole[],
  profile: DreamCompanyInput,
  costBucket?: CostBucket,
): Promise<{ jobs: ExaJobListing[]; error: string | null }> {
  try {
    const exa = getExaClient();
    const roleTitles = selectedRoles.map((r) => r.title).join(' OR ');
    const query = `${roleTitles} hiring ${profile.location}`;
    const searchResponse = await withExaRetry(() => exa.searchAndContents(query, EXA_OPTIONS));
    costBucket?.exa('exa.search.jobs', 1);

    const jobs = searchResponse.results.map((result: { title: string | null; url: string; text?: string; publishedDate?: string }) => ({
      title: result.title ?? result.url,
      url: result.url,
      snippet: (result.text ?? '').slice(0, 200),
      publishedDate: result.publishedDate ?? undefined,
    }));
    // A genuine zero-result search is NOT an error — error stays null (AAT-10).
    return { jobs, error: null };
  } catch (err) {
    // Exa outage / bad key / timeout: log it and surface a distinct failure state
    // instead of masquerading as "no jobs found".
    const message = err instanceof Error ? err.message : String(err);
    console.error('[dream-company] Exa job search failed:', message);
    return { jobs: [], error: 'Could not load live job listings — the job search service is unavailable. Your roadmap below is still valid.' };
  }
}

export async function parseDreamCompanyCv(buffer: Buffer, fileNameLower: string): Promise<Record<string, unknown>> {
  const isPdf = fileNameLower.endsWith('.pdf');
  const isDocx = fileNameLower.endsWith('.docx');

  if (!isPdf && !isDocx) {
    throw Object.assign(new Error('Only PDF and DOCX files are supported'), { statusCode: 400 });
  }

  assertLlmConfigured('dreamCompany');
  const anthropic = dreamClient(DREAM_TIMEOUTS.parseCv());
  const model = getFeatureModel('dreamCompany');
  const cost = newCostBucket('dreamCompany.parseCv');

  let response;

  if (isPdf) {
    response = await withRetry(() => anthropic.messages.create({
      model,
      max_tokens: 2048,
      system: 'You are a CV parser. Extract career information and return only valid JSON.',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'application/pdf',
                data: buffer.toString('base64'),
              },
            },
            {
              type: 'text',
              text: buildDreamCompanyCvParseInstructions(),
            },
          ],
        },
      ],
    }));
  } else {
    const result = await mammoth.extractRawText({ buffer });
    const extractedText = result.value;

    if (!extractedText.trim()) {
      throw Object.assign(new Error('Could not extract text from the uploaded file'), { statusCode: 422 });
    }

    response = await withRetry(() => anthropic.messages.create({
      model,
      max_tokens: 2048,
      system: 'You are a CV parser. Extract career information and return only valid JSON.',
      messages: [
        {
          role: 'user',
          content: buildDreamCompanyCvParsePrompt(extractedText),
        },
      ],
    }));
  }
  cost.llm(isPdf ? 'parseCv.pdf' : 'parseCv.docx', model, response.usage);
  cost.flush();

  // Truncated output (CV too long for max_tokens) — surface a friendly 422 instead of
  // crashing on partial JSON. max_tokens here is only 2048, so long CVs can hit this.
  if (response.stop_reason === 'max_tokens') {
    console.error('[dream-company] parseCv hit max_tokens — CV likely too long, response truncated.');
    throw Object.assign(
      new Error('This CV is too long to read reliably. Please shorten it and try again.'),
      { statusCode: 422 },
    );
  }

  const block = response.content[0];
  if (block?.type !== 'text') {
    console.error('[dream-company] parseCv: no text block in LLM response.');
    throw Object.assign(
      new Error('Could not read this CV. Please try a different file.'),
      { statusCode: 422 },
    );
  }

  try {
    return JSON.parse(cleanJsonResponse(block.text)) as Record<string, unknown>;
  } catch {
    console.error('[dream-company] parseCv: LLM returned invalid JSON.');
    throw Object.assign(
      new Error('Could not read this CV. Please try a different file or format.'),
      { statusCode: 422 },
    );
  }
}

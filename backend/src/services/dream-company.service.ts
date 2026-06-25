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
  const anthropic = createAnthropicClient('dreamCompany');
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

  try {
    return JSON.parse(extractText(response));
  } catch {
    throw Object.assign(new Error('Failed to parse LLM response'), { step: 'profileAnalysis' });
  }
}

export async function generateTargetRoles(
  profile: DreamCompanyInput,
  analysis: ProfileAnalysis,
): Promise<TargetRole[]> {
  assertLlmConfigured('dreamCompany');
  const anthropic = createAnthropicClient('dreamCompany');
  const model = getFeatureModel('dreamCompany');
  const cost = newCostBucket('dreamCompany.roles');

  const response = await withRetry(() => anthropic.messages.create({
    model,
    max_tokens: 8192,
    system: 'You are a career intelligence engine. Return only valid JSON.',
    messages: [{ role: 'user', content: buildTargetRolesPrompt(profile, analysis) }],
  }));
  cost.llm('roles', model, response.usage);
  cost.flush();

  try {
    return JSON.parse(extractText(response));
  } catch {
    throw Object.assign(new Error('Failed to parse LLM response'), { step: 'targetRoles' });
  }
}

export async function generateRoadmapWithJobs(
  profile: DreamCompanyInput,
  analysis: ProfileAnalysis,
  selectedRoles: TargetRole[],
): Promise<RoadmapResponse> {
  assertLlmConfigured('dreamCompany');
  const anthropic = createAnthropicClient('dreamCompany');
  const model = getFeatureModel('dreamCompany');
  const cost = newCostBucket('dreamCompany.roadmap');

  // Fetch the Exa job listings FIRST so the roadmap prompt can reference real, current
  // openings. Running the search and the LLM call in parallel meant the prompt was always
  // built with an empty job list (AAT-9). Still exactly one Exa search — no extra calls.
  const jobs = await searchJobsForRoles(selectedRoles, profile, cost);

  const roadmapResponse = await withRetry(() => anthropic.messages.create({
    model,
    max_tokens: 4096,
    system: 'You are a career intelligence engine. Return only valid JSON.',
    messages: [{ role: 'user', content: buildCareerRoadmapPrompt(profile, analysis, selectedRoles, jobs) }],
  }));
  cost.llm('roadmap', model, roadmapResponse.usage);
  cost.flush();

  let roadmap: CareerRoadmap;
  try {
    roadmap = JSON.parse(extractText(roadmapResponse));
  } catch {
    throw Object.assign(new Error('Failed to parse LLM response'), { step: 'careerRoadmap' });
  }

  return { jobs, roadmap };
}

async function searchJobsForRoles(
  selectedRoles: TargetRole[],
  profile: DreamCompanyInput,
  costBucket?: CostBucket,
): Promise<ExaJobListing[]> {
  try {
    const exa = getExaClient();
    const roleTitles = selectedRoles.map((r) => r.title).join(' OR ');
    const query = `${roleTitles} hiring ${profile.location}`;
    const searchResponse = await withExaRetry(() => exa.searchAndContents(query, EXA_OPTIONS));
    costBucket?.exa('exa.search.jobs', 1);

    return searchResponse.results.map((result: { title: string | null; url: string; text?: string; publishedDate?: string }) => ({
      title: result.title ?? result.url,
      url: result.url,
      snippet: (result.text ?? '').slice(0, 200),
      publishedDate: result.publishedDate ?? undefined,
    }));
  } catch {
    return [];
  }
}

export async function parseDreamCompanyCv(buffer: Buffer, fileNameLower: string): Promise<Record<string, unknown>> {
  const isPdf = fileNameLower.endsWith('.pdf');
  const isDocx = fileNameLower.endsWith('.docx');

  if (!isPdf && !isDocx) {
    throw Object.assign(new Error('Only PDF and DOCX files are supported'), { statusCode: 400 });
  }

  assertLlmConfigured('dreamCompany');
  const anthropic = createAnthropicClient('dreamCompany');
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

  const block = response.content[0];
  if (block.type !== 'text') {
    throw new Error('Failed to parse CV');
  }

  return JSON.parse(cleanJsonResponse(block.text)) as Record<string, unknown>;
}

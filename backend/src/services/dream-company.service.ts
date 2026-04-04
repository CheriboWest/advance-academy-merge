import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import type {
  DreamCompanyInput,
  ProfileAnalysis,
  CompanyMatrix,
  TargetRole,
  CareerRoadmap,
  DreamCompanyResult,
} from '../types/dream-company.js';
import {
  buildProfileAnalysisPrompt,
  buildCompanyMatrixPrompt,
  buildTargetRolesPrompt,
  buildCareerRoadmapPrompt,
} from '../lib/dream-company/prompts.js';
import { assertLlmConfigured, createAnthropicClient, getFeatureModel } from '../lib/llm-anthropic.js';

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

export async function generateDreamCompanyReport(
  profile: DreamCompanyInput,
): Promise<DreamCompanyResult> {
  assertLlmConfigured('dreamCompany');
  const anthropic = createAnthropicClient();
  const model = getFeatureModel('dreamCompany');
  const systemMessage = 'You are a career intelligence engine. Return only valid JSON.';

  const analysisResponse = await anthropic.messages.create({
    model,
    max_tokens: 4096,
    system: systemMessage,
    messages: [{ role: 'user', content: buildProfileAnalysisPrompt(profile) }],
  });

  let analysis: ProfileAnalysis;
  try {
    analysis = JSON.parse(extractText(analysisResponse));
  } catch {
    throw Object.assign(new Error('Failed to parse LLM response'), { step: 'profileAnalysis' });
  }

  const matrixResponse = await anthropic.messages.create({
    model,
    max_tokens: 4096,
    system: systemMessage,
    messages: [{ role: 'user', content: buildCompanyMatrixPrompt(profile, analysis) }],
  });

  let matrix: CompanyMatrix;
  try {
    matrix = JSON.parse(extractText(matrixResponse));
  } catch {
    throw Object.assign(new Error('Failed to parse LLM response'), { step: 'companyMatrix' });
  }

  const rolesResponse = await anthropic.messages.create({
    model,
    max_tokens: 4096,
    system: systemMessage,
    messages: [{ role: 'user', content: buildTargetRolesPrompt(profile, analysis) }],
  });

  let roles: TargetRole[];
  try {
    roles = JSON.parse(extractText(rolesResponse));
  } catch {
    throw Object.assign(new Error('Failed to parse LLM response'), { step: 'targetRoles' });
  }

  const roadmapResponse = await anthropic.messages.create({
    model,
    max_tokens: 4096,
    system: systemMessage,
    messages: [{ role: 'user', content: buildCareerRoadmapPrompt(profile, analysis) }],
  });

  let roadmap: CareerRoadmap;
  try {
    roadmap = JSON.parse(extractText(roadmapResponse));
  } catch {
    throw Object.assign(new Error('Failed to parse LLM response'), { step: 'careerRoadmap' });
  }

  return {
    profile,
    analysis,
    matrix,
    roles,
    roadmap,
    generatedAt: new Date().toISOString(),
  };
}

const CV_PARSE_PROMPT = `Extract structured career information from the following CV text and map it to the specified fields.

CV TEXT:
{CV_TEXT}

YOUR TASK:
Parse the CV and extract the following fields:
- degree: highest education degree (e.g., "Bachelor of Computer Science")
- workExperience: summary of work experience as a single string describing roles and companies
- skills: comma-separated list of technical and soft skills mentioned
- interests: professional interests or areas of focus mentioned
- targetSalary: any salary expectations mentioned, or empty string if not found
- location: candidate's location or preferred work location

Also determine:
- currentLevel: the candidate's current career level — one of: intern, junior, mid, senior, lead, manager, director, executive
- confidence: an object with confidence levels for each extracted field:
  { "degree": "high"|"medium"|"low", "workExperience": "high"|"medium"|"low", "skills": "high"|"medium"|"low", "location": "high"|"medium"|"low" }

Use empty string "" for any field that cannot be determined from the CV.

Return ONLY a valid JSON object matching this schema:
{
  "degree": "string",
  "workExperience": "string",
  "skills": "string",
  "interests": "string",
  "targetSalary": "string",
  "location": "string",
  "currentLevel": "intern"|"junior"|"mid"|"senior"|"lead"|"manager"|"director"|"executive",
  "confidence": {
    "degree": "high"|"medium"|"low",
    "workExperience": "high"|"medium"|"low",
    "skills": "high"|"medium"|"low",
    "location": "high"|"medium"|"low"
  }
}

Return ONLY a valid JSON object. No explanation, no markdown, no code blocks.`;

export async function parseDreamCompanyCv(buffer: Buffer, fileNameLower: string): Promise<Record<string, unknown>> {
  const isPdf = fileNameLower.endsWith('.pdf');
  const isDocx = fileNameLower.endsWith('.docx');

  if (!isPdf && !isDocx) {
    throw Object.assign(new Error('Only PDF and DOCX files are supported'), { statusCode: 400 });
  }

  let extractedText: string;

  if (isPdf) {
    const pdfData = await pdfParse(buffer);
    extractedText = pdfData.text;
  } else {
    const result = await mammoth.extractRawText({ buffer });
    extractedText = result.value;
  }

  if (!extractedText.trim()) {
    throw Object.assign(new Error('Could not extract text from the uploaded file'), { statusCode: 422 });
  }

  assertLlmConfigured('dreamCompany');
  const anthropic = createAnthropicClient();
  const model = getFeatureModel('dreamCompany');

  const response = await anthropic.messages.create({
    model,
    max_tokens: 2048,
    system: 'You are a CV parser. Extract career information and return only valid JSON.',
    messages: [
      {
        role: 'user',
        content: CV_PARSE_PROMPT.replace('{CV_TEXT}', extractedText),
      },
    ],
  });

  const block = response.content[0];
  if (block.type !== 'text') {
    throw new Error('Failed to parse CV');
  }

  return JSON.parse(cleanJsonResponse(block.text)) as Record<string, unknown>;
}

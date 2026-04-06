/**
 * Outreach — service called from routes only.
 * Prompts: lib/outreach/prompts.ts. LLM: lib/llm-anthropic (Anthropic SDK).
 */
import {
  OUTREACH_EMAIL_JSON_RETRY_SYSTEM,
  OUTREACH_LINKEDIN_COMPRESSION_SYSTEM,
  OUTREACH_PROFILE_FACT_SYSTEM,
  OUTREACH_RECRUITER_PITCH_COMPRESSION_SYSTEM,
  OUTREACH_RECRUITER_PITCH_SYSTEM,
  OUTREACH_TONE_SYSTEM,
  buildEmailJsonRetryUserPrompt,
  buildEmailSystemPrompt,
  buildEmailUserPrompt,
  buildLinkedInCompressionUserPrompt,
  buildLinkedInSystemPrompt,
  buildLinkedInUserPrompt,
  buildProfileFactExtractionUserPrompt,
  buildRecruiterPitchCompressionUserPrompt,
  buildRecruiterPitchUserPrompt,
  buildToneAnalysisUserPrompt,
} from '../lib/outreach/prompts.js';
import { assertLlmConfigured, createAnthropicClient, getFeatureModel } from '../lib/llm-anthropic.js';
import type {
  DesiredRole,
  EmailOutput,
  LinkedInProfileRaw,
  OutreachRequest,
  OutreachResult,
  ProfileSignal,
  RecruiterData,
  RecruiterPitchOutput,
  RoleData,
  TargetData,
} from '../types/outreach.js';

type OutreachLlmContext = {
  anthropic: ReturnType<typeof createAnthropicClient>;
  model: string;
};

function firstTextContent(response: { content: Array<{ type: string; text?: string }> }): string {
  const block = response.content[0];
  return block?.type === 'text' && typeof block.text === 'string' ? block.text : '';
}

function parseEmailResponse(raw: string): EmailOutput | null {
  const curiosityMatch = raw.match(/\[Curiosity\]:\s*(.+)/i);
  const specificMatch = raw.match(/\[Specific\]:\s*(.+)/i);
  const directMatch = raw.match(/\[Direct\]:\s*(.+)/i);
  const bodyMatch = raw.match(/EMAIL BODY:\s*([\s\S]+)/i);

  if (!curiosityMatch || !specificMatch || !directMatch || !bodyMatch) {
    return null;
  }

  return {
    subjectLines: {
      curiosity: curiosityMatch[1].trim(),
      specific: specificMatch[1].trim(),
      direct: directMatch[1].trim(),
    },
    body: bodyMatch[1].trim(),
  };
}

function computeFitWarning(topSkills: string[], activeRoles?: string[]): string | undefined {
  if (!activeRoles || activeRoles.length === 0) {
    return undefined;
  }

  const skillWords = new Set(topSkills.flatMap((s) => s.toLowerCase().split(/\s+/)));
  const roleWords = activeRoles.flatMap((r) => r.toLowerCase().split(/\s+/));
  const totalRoleWords = roleWords.length;

  if (totalRoleWords === 0) {
    return undefined;
  }

  const matchedCount = roleWords.filter((w) => skillWords.has(w)).length;
  const score = (matchedCount / totalRoleWords) * 100;

  if (score < 40) {
    return 'Low fit score — review before sending';
  }

  return undefined;
}

async function extractProfileSignals(
  ctx: OutreachLlmContext,
  rawProfile: LinkedInProfileRaw,
): Promise<ProfileSignal> {
  const factResponse = await ctx.anthropic.messages.create({
    model: ctx.model,
    max_tokens: 1000,
    system: OUTREACH_PROFILE_FACT_SYSTEM,
    messages: [
      {
        role: 'user',
        content: buildProfileFactExtractionUserPrompt(rawProfile),
      },
    ],
  });

  const factText = firstTextContent(factResponse);

  let factData: {
    currentTitle: string;
    background: string;
    differentiators: string[];
    proofPoints: string[];
    topSkills: string[];
    industries: string[];
    yearsExperience: number;
    employmentStatus: string;
    availability: string;
  };

  try {
    factData = JSON.parse(factText);
  } catch {
    throw new Error(
      `Failed to parse fact extraction response as JSON. Raw response: ${factText.slice(0, 200)}`,
    );
  }

  const writingSample = [rawProfile.about, ...(rawProfile.posts ?? [])].join('\n\n');

  const toneResponse = await ctx.anthropic.messages.create({
    model: ctx.model,
    max_tokens: 1000,
    system: OUTREACH_TONE_SYSTEM,
    messages: [
      {
        role: 'user',
        content: buildToneAnalysisUserPrompt(writingSample),
      },
    ],
  });

  const toneText = firstTextContent(toneResponse);

  let toneData: {
    tone: ProfileSignal['tone'];
    vocabularyStyle: ProfileSignal['vocabularyStyle'];
    preferredFraming: ProfileSignal['preferredFraming'];
  };

  try {
    toneData = JSON.parse(toneText);
  } catch {
    throw new Error(
      `Failed to parse tone analysis response as JSON. Raw response: ${toneText.slice(0, 200)}`,
    );
  }

  return {
    name: rawProfile.headline,
    currentTitle: factData.currentTitle,
    background: factData.background,
    differentiators: factData.differentiators,
    proofPoints: factData.proofPoints,
    topSkills: factData.topSkills,
    industries: factData.industries,
    yearsExperience: factData.yearsExperience,
    employmentStatus: factData.employmentStatus,
    availability: factData.availability,
    tone: toneData.tone,
    vocabularyStyle: toneData.vocabularyStyle,
    preferredFraming: toneData.preferredFraming,
  };
}

async function generateLinkedInMessage(
  ctx: OutreachLlmContext,
  senderSignal: ProfileSignal,
  targetData: TargetData,
  roleData: RoleData,
): Promise<string> {
  const response = await ctx.anthropic.messages.create({
    model: ctx.model,
    max_tokens: 400,
    system: buildLinkedInSystemPrompt(senderSignal),
    messages: [
      {
        role: 'user',
        content: buildLinkedInUserPrompt(senderSignal, targetData, roleData),
      },
    ],
  });

  let message = firstTextContent(response);

  if (message.length > 300) {
    const compressionResponse = await ctx.anthropic.messages.create({
      model: ctx.model,
      max_tokens: 400,
      system: OUTREACH_LINKEDIN_COMPRESSION_SYSTEM,
      messages: [
        {
          role: 'user',
          content: buildLinkedInCompressionUserPrompt(message),
        },
      ],
    });

    message = firstTextContent(compressionResponse) || message;
  }

  return message.trim();
}

async function generateEmailBody(
  ctx: OutreachLlmContext,
  senderSignal: ProfileSignal,
  targetData: TargetData,
  roleData: RoleData,
): Promise<EmailOutput> {
  const response = await ctx.anthropic.messages.create({
    model: ctx.model,
    max_tokens: 1000,
    system: buildEmailSystemPrompt(senderSignal),
    messages: [
      {
        role: 'user',
        content: buildEmailUserPrompt(senderSignal, targetData, roleData),
      },
    ],
  });

  const rawText = firstTextContent(response);

  const parsed = parseEmailResponse(rawText);

  if (parsed) {
    return parsed;
  }

  const retryResponse = await ctx.anthropic.messages.create({
    model: ctx.model,
    max_tokens: 1000,
    system: OUTREACH_EMAIL_JSON_RETRY_SYSTEM,
    messages: [
      {
        role: 'user',
        content: buildEmailJsonRetryUserPrompt(rawText),
      },
    ],
  });

  const retryText = firstTextContent(retryResponse);

  try {
    return JSON.parse(retryText) as EmailOutput;
  } catch {
    throw new Error(
      `Failed to parse email response after retry. Raw response: ${retryText.slice(0, 200)}`,
    );
  }
}

async function generateRecruiterPitchBody(
  ctx: OutreachLlmContext,
  senderSignal: ProfileSignal,
  recruiterData: RecruiterData,
  desiredRole: DesiredRole,
): Promise<RecruiterPitchOutput> {
  const warning = computeFitWarning(senderSignal.topSkills, recruiterData.activeRoles);

  const response = await ctx.anthropic.messages.create({
    model: ctx.model,
    max_tokens: 400,
    system: OUTREACH_RECRUITER_PITCH_SYSTEM,
    messages: [
      {
        role: 'user',
        content: buildRecruiterPitchUserPrompt(senderSignal, recruiterData, desiredRole),
      },
    ],
  });

  let pitch = firstTextContent(response);

  const wordCount = pitch.split(/\s+/).length;
  if (wordCount > 100) {
    const compressionResponse = await ctx.anthropic.messages.create({
      model: ctx.model,
      max_tokens: 400,
      system: OUTREACH_RECRUITER_PITCH_COMPRESSION_SYSTEM,
      messages: [
        {
          role: 'user',
          content: buildRecruiterPitchCompressionUserPrompt(pitch),
        },
      ],
    });

    pitch = firstTextContent(compressionResponse) || pitch;
  }

  return {
    pitch: pitch.trim(),
    warning,
  };
}

export async function generateOutreach(request: OutreachRequest): Promise<OutreachResult> {
  assertLlmConfigured('outreach');
  const ctx: OutreachLlmContext = {
    anthropic: createAnthropicClient(),
    model: getFeatureModel('outreach'),
  };

  const senderSignal = await extractProfileSignals(ctx, request.rawProfile);

  const [linkedInMessage, email, recruiterPitch] = await Promise.all([
    generateLinkedInMessage(ctx, senderSignal, request.targetData, request.roleData),
    generateEmailBody(ctx, senderSignal, request.targetData, request.roleData),
    generateRecruiterPitchBody(ctx, senderSignal, request.recruiterData, request.desiredRole),
  ]);

  return {
    senderSignal,
    linkedInMessage,
    email,
    recruiterPitch,
  };
}

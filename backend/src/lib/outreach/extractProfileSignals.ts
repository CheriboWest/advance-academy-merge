import type { LinkedInProfileRaw, ProfileSignal } from '../../types/outreach.js';
import { assertLlmConfigured, createAnthropicClient, getFeatureModel } from '../llm-anthropic.js';

export async function extractProfileSignals(
  rawProfile: LinkedInProfileRaw,
): Promise<ProfileSignal> {
  assertLlmConfigured('outreach');
  const anthropic = createAnthropicClient();
  const model = getFeatureModel('outreach');

  const factResponse = await anthropic.messages.create({
    model,
    max_tokens: 1000,
    system:
      'You are a profile analyst. Extract structured facts from this LinkedIn profile. Respond with valid JSON only. No markdown. No explanation.',
    messages: [
      {
        role: 'user',
        content: `Analyze this LinkedIn profile and return a JSON object with these exact fields:
- "currentTitle" (string): their current job title
- "background" (string): 1-2 sentence professional background summary
- "differentiators" (string[]): what makes them stand out
- "proofPoints" (string[]): measurable achievements or credentials
- "topSkills" (string[]): top 5-7 skills
- "industries" (string[]): industries they've worked in
- "yearsExperience" (number): estimated total years of professional experience
- "employmentStatus" (string): employed, unemployed, freelance, etc.
- "availability" (string): immediate, open to opportunities, not looking, etc.

Profile data:
${JSON.stringify(rawProfile, null, 2)}`,
      },
    ],
  });

  const factText =
    factResponse.content[0].type === 'text' ? factResponse.content[0].text : '';

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

  const toneResponse = await anthropic.messages.create({
    model,
    max_tokens: 1000,
    system:
      'You are a writing tone analyst. Analyze the tone and writing style of this text. Respond with valid JSON only. No markdown. No explanation.',
    messages: [
      {
        role: 'user',
        content: `Analyze the tone and writing style of this text and return a JSON object with these exact fields:
- "tone" (one of: "direct", "warm", "analytical", "storytelling", "conversational")
- "vocabularyStyle" (one of: "formal", "casual", "technical", "hybrid")
- "preferredFraming" (one of: "data-driven", "narrative", "outcome-focused")

Text:
${writingSample}`,
      },
    ],
  });

  const toneText =
    toneResponse.content[0].type === 'text' ? toneResponse.content[0].text : '';

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

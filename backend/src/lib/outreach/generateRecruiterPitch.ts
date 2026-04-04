import type {
  ProfileSignal,
  RecruiterData,
  DesiredRole,
  RecruiterPitchOutput,
} from '../../types/outreach.js';
import { assertLlmConfigured, createAnthropicClient, getFeatureModel } from '../llm-anthropic.js';

function computeFitWarning(
  topSkills: string[],
  activeRoles?: string[],
): string | undefined {
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

export async function generateRecruiterPitch(
  senderSignal: ProfileSignal,
  recruiterData: RecruiterData,
  desiredRole: DesiredRole,
): Promise<RecruiterPitchOutput> {
  assertLlmConfigured('outreach');
  const anthropic = createAnthropicClient();
  const model = getFeatureModel('outreach');

  const warning = computeFitWarning(senderSignal.topSkills, recruiterData.activeRoles);

  const response = await anthropic.messages.create({
    model,
    max_tokens: 400,
    system: `You are an expert recruiter outreach copywriter. Generate a pitch message to send to a recruiter. Rules:
- 80-100 words hard limit
- Structure: role target opener → 2-3 bullet fit snapshot → availability line → single CTA
- Use numbers over adjectives ("5 years" not "extensive experience")
- No storytelling, no "I came across your profile"
- Tone: direct, confident, efficient
- Return ONLY the pitch text. No explanation, no quotes, no labels.`,
    messages: [
      {
        role: 'user',
        content: `Write a recruiter pitch message from this candidate to this recruiter.

CANDIDATE:
- Name: ${senderSignal.name}
- Title: ${senderSignal.currentTitle}
- Background: ${senderSignal.background}
- Top skills: ${senderSignal.topSkills.join(', ')}
- Proof points: ${senderSignal.proofPoints.join(', ')}
- Years experience: ${senderSignal.yearsExperience}
- Availability: ${senderSignal.availability}

RECRUITER:
- Name: ${recruiterData.name}
- Type: ${recruiterData.type}
- Specialization: ${recruiterData.specialization}
${recruiterData.activeRoles ? `- Active roles: ${recruiterData.activeRoles.join(', ')}` : ''}

DESIRED ROLE:
- Title: ${desiredRole.title}
- Location: ${desiredRole.location}
${desiredRole.salaryExpectation ? `- Salary expectation: ${desiredRole.salaryExpectation}` : ''}`,
      },
    ],
  });

  let pitch = response.content[0].type === 'text' ? response.content[0].text : '';

  const wordCount = pitch.split(/\s+/).length;
  if (wordCount > 100) {
    const compressionResponse = await anthropic.messages.create({
      model,
      max_tokens: 400,
      system:
        'You compress text to fit within word limits while keeping all key facts. Return ONLY the compressed text. No explanation.',
      messages: [
        {
          role: 'user',
          content: `Compress this recruiter pitch to under 100 words while keeping all key facts and numbers:\n\n${pitch}`,
        },
      ],
    });

    pitch =
      compressionResponse.content[0].type === 'text'
        ? compressionResponse.content[0].text
        : pitch;
  }

  return {
    pitch: pitch.trim(),
    warning,
  };
}

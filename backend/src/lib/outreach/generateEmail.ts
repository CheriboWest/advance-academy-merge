import type { ProfileSignal, TargetData, RoleData, EmailOutput } from '../../types/outreach.js';
import { assertLlmConfigured, createAnthropicClient, getFeatureModel } from '../llm-anthropic.js';

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

export async function generateEmail(
  senderSignal: ProfileSignal,
  targetData: TargetData,
  roleData: RoleData,
): Promise<EmailOutput> {
  assertLlmConfigured('outreach');
  const anthropic = createAnthropicClient();
  const model = getFeatureModel('outreach');

  const response = await anthropic.messages.create({
    model,
    max_tokens: 1000,
    system: `You are an expert cold email copywriter for job seekers. Generate a cold outreach email with this exact output structure:

SUBJECT LINES:
[Curiosity]: ...
[Specific]: ...
[Direct]: ...

EMAIL BODY:
...

Rules:
- Each subject line must be under 50 characters
- Email body must be 150-200 words
- Body structure: hook → bridge → proof point (include a number) → value statement → low-friction CTA → confident sign-off
- Never use buzzwords: synergy, passionate, leverage, dynamic, results-driven
- Never use "I am writing to express my interest"
- Tone: ${senderSignal.tone}
- Framing: ${senderSignal.preferredFraming}
- Return ONLY the structured output above. No extra explanation.`,
    messages: [
      {
        role: 'user',
        content: `Write a cold outreach email from this sender to this recipient about this role.

SENDER:
- Name: ${senderSignal.name}
- Title: ${senderSignal.currentTitle}
- Background: ${senderSignal.background}
- Differentiators: ${senderSignal.differentiators.join(', ')}
- Proof points: ${senderSignal.proofPoints.join(', ')}
- Top skills: ${senderSignal.topSkills.join(', ')}

RECIPIENT:
- Name: ${targetData.name}
- Role: ${targetData.role}
- Company: ${targetData.company}
- Industry: ${targetData.industry}
${targetData.recentActivity ? `- Recent activity: ${targetData.recentActivity}` : ''}
- Why this company: ${targetData.whyThisCompany}
${targetData.companySignal ? `- Company signal: ${targetData.companySignal}` : ''}
${targetData.hiringManager ? `- Hiring manager: ${targetData.hiringManager} (${targetData.hiringManagerRole})` : ''}

TARGET ROLE:
- Title: ${roleData.title}
- Department: ${roleData.department}
- Key requirements: ${roleData.keyRequirements.join(', ')}
- Implied pain: ${roleData.impliedPain}`,
      },
    ],
  });

  const rawText = response.content[0].type === 'text' ? response.content[0].text : '';

  const parsed = parseEmailResponse(rawText);

  if (parsed) {
    return parsed;
  }

  const retryResponse = await anthropic.messages.create({
    model,
    max_tokens: 1000,
    system:
      'Convert the following email draft into strict JSON. Respond with valid JSON only. No markdown. No explanation.',
    messages: [
      {
        role: 'user',
        content: `Convert this email content into a JSON object with this exact shape:
{
  "subjectLines": {
    "curiosity": "...",
    "specific": "...",
    "direct": "..."
  },
  "body": "..."
}

Content to convert:
${rawText}`,
      },
    ],
  });

  const retryText =
    retryResponse.content[0].type === 'text' ? retryResponse.content[0].text : '';

  try {
    return JSON.parse(retryText) as EmailOutput;
  } catch {
    throw new Error(
      `Failed to parse email response after retry. Raw response: ${retryText.slice(0, 200)}`,
    );
  }
}

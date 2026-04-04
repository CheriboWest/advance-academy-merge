import Anthropic from '@anthropic-ai/sdk';
import type { ProfileSignal, TargetData, RoleData } from '@/types/outreach';

const anthropic = new Anthropic();
const MODEL = 'claude-sonnet-4-20250514';

export async function generateLinkedInMessage(
  senderSignal: ProfileSignal,
  targetData: TargetData,
  roleData: RoleData,
): Promise<string> {
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 400,
    system: `You are an expert LinkedIn outreach copywriter. Generate a LinkedIn connection message that follows these rules strictly:
- Maximum 300 characters
- Never start with "I" or "Hi my name is"
- Never use generic phrases: "I came across your profile", "I'd love to connect", "I'm passionate about"
- Lead with the recipient — their company, role, or recent activity
- Structure: one hook + one value statement + one soft CTA
- Tone: ${senderSignal.tone}
- Vocabulary style: ${senderSignal.vocabularyStyle}
- Return ONLY the message text. No explanation, no quotes, no labels.`,
    messages: [
      {
        role: 'user',
        content: `Write a LinkedIn connection message from this sender to this recipient.

SENDER:
- Name: ${senderSignal.name}
- Title: ${senderSignal.currentTitle}
- Background: ${senderSignal.background}
- Key differentiators: ${senderSignal.differentiators.join(', ')}
- Top skills: ${senderSignal.topSkills.join(', ')}

RECIPIENT:
- Name: ${targetData.name}
- Role: ${targetData.role}
- Company: ${targetData.company}
- Industry: ${targetData.industry}
${targetData.recentActivity ? `- Recent activity: ${targetData.recentActivity}` : ''}
- Why this company: ${targetData.whyThisCompany}
${targetData.companySignal ? `- Company signal: ${targetData.companySignal}` : ''}

TARGET ROLE:
- Title: ${roleData.title}
- Department: ${roleData.department}
- Key requirements: ${roleData.keyRequirements.join(', ')}
- Implied pain: ${roleData.impliedPain}`,
      },
    ],
  });

  let message =
    response.content[0].type === 'text' ? response.content[0].text : '';

  // Post-processing: compress if over 300 characters
  if (message.length > 300) {
    const compressionResponse = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 400,
      system:
        'You compress text to fit within character limits while preserving meaning. Return ONLY the compressed text. No explanation.',
      messages: [
        {
          role: 'user',
          content: `Compress this LinkedIn message to under 300 characters while preserving its meaning and tone:\n\n${message}`,
        },
      ],
    });

    message =
      compressionResponse.content[0].type === 'text'
        ? compressionResponse.content[0].text
        : message;
  }

  return message.trim();
}

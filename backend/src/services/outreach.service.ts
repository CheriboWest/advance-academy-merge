import { assertLlmConfigured, createAnthropicClient, getFeatureModel } from '../lib/llm-anthropic.js';
import { OUTREACH_SYSTEM_PROMPT, buildOutreachUserPrompt } from '../lib/outreach/prompts.js';
import type { OutreachRequest, OutreachResult } from '../types/outreach.js';

function firstTextContent(response: { content: Array<{ type: string; text?: string }> }): string {
  const block = response.content[0];
  return block?.type === 'text' && typeof block.text === 'string' ? block.text : '';
}

export async function generateOutreach(request: OutreachRequest): Promise<OutreachResult> {
  assertLlmConfigured('outreach');
  const anthropic = createAnthropicClient();
  const model = getFeatureModel('outreach');

  const response = await anthropic.messages.create({
    model,
    max_tokens: 1500,
    system: OUTREACH_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: buildOutreachUserPrompt(request),
      },
    ],
  });

  const rawText = firstTextContent(response);

  // Extract JSON block in case there is trailing markdown or text
  let jsonString = rawText.trim();
  const match = jsonString.match(/\{[\s\S]*\}/);
  if (match) {
    jsonString = match[0];
  }

  let parsed: any;
  try {
    parsed = JSON.parse(jsonString);
  } catch (err) {
    throw new Error(`Failed to parse outreach response as JSON. Raw: ${rawText.slice(0, 200)}`);
  }

  return {
    intent: request.intent,
    linkedInMessage: parsed.linkedInMessage || '',
    email: {
      subject: parsed.email?.subject || '',
      body: parsed.email?.body || '',
    },
  };
}

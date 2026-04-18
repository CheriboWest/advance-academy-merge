import { assertLlmConfigured, createAnthropicClient, getFeatureModel } from '../lib/llm-anthropic.js';
import { OUTREACH_SYSTEM_PROMPT, buildOutreachUserPrompt } from '../lib/outreach/prompts.js';
import { newCostBucket } from '../lib/cost-tracker.js';
import { extractContent } from './outreach-extractor.service.js';
import type { OutreachRequest, OutreachResult } from '../types/outreach.js';

function firstTextContent(response: { content: Array<{ type: string; text?: string }> }): string {
  const block = response.content[0];
  return block?.type === 'text' && typeof block.text === 'string' ? block.text : '';
}

export async function generateOutreach(request: OutreachRequest): Promise<OutreachResult> {
  assertLlmConfigured('outreach');
  const anthropic = createAnthropicClient('outreach');
  const model = getFeatureModel('outreach');
  const cost = newCostBucket('outreach.generate');

  // Extract content for selected enrichment cards in parallel.
  // Blocked domains (LinkedIn, etc.) reuse the Exa-returned text directly;
  // everything else goes through Jina Reader via extractContent().
  const [hiringContext, socialContext] = await Promise.all([
    request.hiringSignalUrl
      ? extractContent(request.hiringSignalUrl, request.hiringSignalExaText)
      : Promise.resolve(''),
    request.socialSignalUrl
      ? extractContent(request.socialSignalUrl, request.socialSignalExaText)
      : Promise.resolve(''),
  ]);

  const response = await anthropic.messages.create({
    model,
    max_tokens: 1500,
    system: OUTREACH_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: buildOutreachUserPrompt(request, hiringContext, socialContext),
      },
    ],
  });
  cost.llm('generate', model, response.usage);
  cost.flush();

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
  } catch {
    throw new Error(`Failed to parse outreach response as JSON. Raw: ${rawText.slice(0, 200)}`);
  }

  const result: OutreachResult = {
    intent: request.intent,
  };

  if (request.outputs.linkedIn && typeof parsed.linkedInMessage === 'string') {
    // Hard safety net: enforce LinkedIn's 300-char connection-request limit on
    // the server side in case the LLM ignores the prompt instructions.
    const LINKEDIN_MAX = 300;
    let msg = parsed.linkedInMessage.trim();
    if (msg.length > LINKEDIN_MAX) {
      // Trim to the last full word that still fits, keeping at most 297 chars
      // and adding a single ellipsis so the total stays ≤ 300.
      const cut = msg.slice(0, LINKEDIN_MAX - 3);
      const lastSpace = cut.lastIndexOf(' ');
      msg = (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd() + '…';
    }
    result.linkedInMessage = msg;
  }

  if (request.outputs.email && parsed.email && typeof parsed.email === 'object') {
    result.email = {
      subject: typeof parsed.email.subject === 'string' ? parsed.email.subject : '',
      body: typeof parsed.email.body === 'string' ? parsed.email.body : '',
    };
  }

  return result;
}

/**
 * Shared HTTP LLM client (OpenAI-compatible chat completions + Anthropic Messages).
 * Use for JSON-shaped responses when per-call token limits in this module are sufficient.
 */
import { getLlmApiKey, getLlmConfig, type LlmFeature } from '../config/llm.js';

interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

interface GenerateJsonOptions {
  feature: LlmFeature;
  systemPrompt: string;
  userPrompt: string;
}

interface OpenAiChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
}

interface AnthropicMessagesResponse {
  content?: Array<{
    type?: string;
    text?: string;
  }>;
}

function extractTextContent(content: string | Array<{ type?: string; text?: string }> | undefined) {
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .filter((item) => item.type === 'text' && typeof item.text === 'string')
      .map((item) => item.text)
      .join('\n');
  }

  return '';
}

function extractJsonBlock(raw: string) {
  const trimmed = raw.trim();

  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return trimmed;
  }

  const match = trimmed.match(/\{[\s\S]*\}/);

  return match?.[0] ?? trimmed;
}

async function callOpenAiCompatibleChat(messages: ChatMessage[], feature: LlmFeature) {
  const config = getLlmConfig(feature);
  const apiKey = getLlmApiKey(feature);

  if (!config.enabled || !apiKey) {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.2,
        response_format: {
          type: 'json_object',
        },
        messages,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`LLM request failed with ${response.status}: ${errorText}`);
    }

    const data = (await response.json()) as OpenAiChatCompletionResponse;
    const rawContent = extractTextContent(data.choices?.[0]?.message?.content);

    if (!rawContent) {
      throw new Error('LLM response did not contain any message content.');
    }

    return extractJsonBlock(rawContent);
  } finally {
    clearTimeout(timeout);
  }
}

async function callAnthropicMessages(messages: ChatMessage[], feature: LlmFeature) {
  const config = getLlmConfig(feature);
  const apiKey = getLlmApiKey(feature);

  if (!config.enabled || !apiKey) {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  const systemPrompt = messages.find((message) => message.role === 'system')?.content ?? '';
  const userMessages = messages
    .filter((message) => message.role === 'user')
    .map((message) => ({
      role: 'user',
      content: message.content,
    }));

  try {
    const response = await fetch(`${config.baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': config.anthropicApiVersion,
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: 1200,
        temperature: 0.2,
        system: systemPrompt,
        messages: userMessages,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`LLM request failed with ${response.status}: ${errorText}`);
    }

    const data = (await response.json()) as AnthropicMessagesResponse;
    const rawContent = extractTextContent(data.content);

    if (!rawContent) {
      throw new Error('LLM response did not contain any message content.');
    }

    return extractJsonBlock(rawContent);
  } finally {
    clearTimeout(timeout);
  }
}

export async function generateJson<T>(options: GenerateJsonOptions): Promise<T | null> {
  const messages: ChatMessage[] = [
    { role: 'system', content: options.systemPrompt },
    { role: 'user', content: options.userPrompt },
  ];
  const config = getLlmConfig(options.feature);

  const payload = config.provider === 'anthropic'
    ? await callAnthropicMessages(messages, options.feature)
    : await callOpenAiCompatibleChat(messages, options.feature);

  if (!payload) {
    return null;
  }

  return JSON.parse(payload) as T;
}

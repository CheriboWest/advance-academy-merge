const GROQ_TRANSCRIPTION_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const GROQ_MODEL = 'whisper-large-v3-turbo';
const DEFAULT_TIMEOUT_MS = 60_000;

function assertGroqConfigured(): string {
  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey) {
    throw Object.assign(
      new Error(
        'GROQ_API_KEY is not set in backend environment. Add it to backend/.env (see backend/.env.example).',
      ),
      { statusCode: 503, step: 'transcription' },
    );
  }
  return apiKey;
}

export async function transcribeAudio(
  audioBuffer: Buffer,
  filename: string,
  mimeType: string,
): Promise<{ text: string }> {
  const apiKey = assertGroqConfigured();

  const form = new FormData();
  const blob = new Blob([new Uint8Array(audioBuffer)], {
    type: mimeType || 'application/octet-stream',
  });
  form.append('file', blob, filename || 'answer.webm');
  form.append('model', GROQ_MODEL);
  form.append('response_format', 'json');
  form.append('language', 'en');
  form.append('temperature', '0');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(GROQ_TRANSCRIPTION_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw Object.assign(new Error('Transcription timed out.'), {
        statusCode: 504,
        step: 'transcription',
      });
    }
    throw Object.assign(
      new Error(error instanceof Error ? error.message : 'Transcription request failed.'),
      { statusCode: 502, step: 'transcription' },
    );
  } finally {
    clearTimeout(timeout);
  }

  const bodyText = await response.text();

  if (!response.ok) {
    let detail = bodyText;
    try {
      const parsed = JSON.parse(bodyText) as { error?: { message?: string } };
      if (parsed?.error?.message) detail = parsed.error.message;
    } catch {
      // keep raw body
    }
    throw Object.assign(
      new Error(`Groq transcription failed (${response.status}): ${detail}`),
      { statusCode: response.status >= 500 ? 502 : response.status, step: 'transcription' },
    );
  }

  let parsed: { text?: string };
  try {
    parsed = JSON.parse(bodyText) as { text?: string };
  } catch {
    throw Object.assign(new Error('Groq returned invalid JSON.'), {
      statusCode: 502,
      step: 'transcription',
    });
  }

  const text = (parsed.text ?? '').trim();
  return { text };
}

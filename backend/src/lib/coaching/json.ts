/**
 * Parsing the JSON an LLM says it returned.
 *
 * Every coaching stage asks for "a JSON object, no fence, no commentary" and
 * then parses the reply. That parse used to be `JSON.parse(stripFences(text))`,
 * which fails the moment the model does what models do: a `Here is the brief:`
 * lead-in, a closing sentence after the object, or a fence with a stray blank
 * line. The failure surfaced to the coach as "Failed to parse the company
 * brief" with the actual reply swallowed by the catch — unfixable without
 * reproducing it by hand.
 *
 * So this module does two things, and the second matters more than the first:
 * it extracts the object from surrounding prose, and when it still cannot, it
 * logs what actually came back.
 */

/** How much of a failed reply to log. Enough to diagnose, short enough to read. */
const LOG_CHARS = 500;

/**
 * The first `text` block of a response.
 *
 * Not `content[0]`: a response can lead with a non-text block (a thinking block,
 * for instance), and indexing blind turns that into a misleading "came back
 * empty" error when the text is sitting right behind it.
 */
export function firstTextBlock(content: readonly unknown[]): string | null {
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    const { type, text } = block as { type?: unknown; text?: unknown };
    if (type === 'text' && typeof text === 'string' && text.trim()) return text;
  }
  return null;
}

/**
 * Pull the JSON object out of a model reply, tolerating what wraps it.
 *
 * Slices from the first `{` to the last `}` — prose before, prose after, and
 * markdown fences all fall away, while braces *inside* strings are unaffected
 * because they are never the outermost pair. Returns null when there is no
 * brace pair at all, so the caller can log the raw text rather than a
 * `SyntaxError` about position 0.
 */
export function extractJsonObject(raw: string): string | null {
  const text = raw.trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  return text.slice(start, end + 1);
}

/**
 * Parse one LLM reply as a JSON object, or throw a 500 carrying `step`.
 *
 * `label` names the stage in both the log line and the thrown `step`, so a
 * failure in the logs and a failure on the session row line up.
 */
export function parseLlmJson<T>(raw: string, label: string, step: string): T {
  const candidate = extractJsonObject(raw);
  if (candidate !== null) {
    try {
      return JSON.parse(candidate) as T;
    } catch {
      // fall through to the shared failure path below
    }
  }

  // The one line that makes this diagnosable. Without it the raw reply is gone
  // and the only way to learn what the model said is to reproduce the run.
  console.error(
    `[coaching] ${label}: reply was not JSON. First ${LOG_CHARS} chars:\n${raw.slice(0, LOG_CHARS)}`,
  );
  throw Object.assign(new Error(`Could not parse the ${label}.`), { statusCode: 500, step });
}

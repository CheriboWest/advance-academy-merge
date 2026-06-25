/** LinkedIn connection-request hard limit (characters). */
export const LINKEDIN_MAX_CHARS = 300;

/**
 * Truncates a LinkedIn message to at most `max` characters, cutting on a word
 * boundary so a word is never split, then appending an ellipsis (AAT-19).
 *
 * - Messages already within the limit are returned unchanged (trimmed).
 * - If there is no space before the cut point (a single over-long token), it
 *   falls back to a hard cut — the only case where a word can't be preserved.
 *
 * The ellipsis is one character, so the result is always ≤ `max`.
 */
export function truncateLinkedInMessage(text: string, max = LINKEDIN_MAX_CHARS): string {
  const msg = text.trim();
  if (msg.length <= max) return msg;

  const cut = msg.slice(0, max - 1); // reserve one char for the ellipsis
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd() + '…';
}

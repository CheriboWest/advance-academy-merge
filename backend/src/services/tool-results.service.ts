import { getSupabase } from '../lib/supabase.js';

/**
 * Tool run history (sprint F5, migration 017).
 *
 * Every successful run of a credit-charging tool drops one row here, so the user
 * can reopen the output later without spending credits or triggering an LLM
 * call. Reads are always scoped by `user_id` — the table is service-role only,
 * and the service layer never trusts an id on its own.
 *
 * CV Optimizer is intentionally absent: its results already live in
 * `cv_analysis_jobs` (migration 005).
 */

export type ToolName = 'cv' | 'dream' | 'interview';

/** Row shape for the list view — deliberately without the heavy `result` blob. */
export interface ToolResultSummary {
  id: string;
  tool: ToolName;
  input_summary: string | null;
  created_at: string;
}

export interface ToolResultDetail extends ToolResultSummary {
  result: unknown;
}

/**
 * Rows above this serialise to more than we want to keep per run. A Dream
 * Company roadmap with a long job list is the realistic worst case; anything
 * beyond this is a bug or an abusive payload, and silently storing megabytes per
 * run would make the history table the biggest thing in the database.
 */
const MAX_RESULT_BYTES = 512 * 1024;

/**
 * Record one successful run. Best-effort by design: history is a convenience,
 * so a write failure is logged and swallowed rather than turning a successful
 * (already paid for) tool run into an error the user sees.
 */
export async function recordToolResult(
  userId: string | undefined,
  tool: ToolName,
  inputSummary: string | null,
  result: unknown,
): Promise<void> {
  if (!userId || result === undefined || result === null) return;

  try {
    const size = Buffer.byteLength(JSON.stringify(result) ?? '', 'utf8');
    if (size > MAX_RESULT_BYTES) {
      console.warn(`[tool-results] skipped ${tool} for ${userId}: ${size} bytes over the cap`);
      return;
    }

    const supabase = getSupabase();
    const { error } = await supabase.from('tool_results').insert({
      user_id: userId,
      tool,
      input_summary: inputSummary?.slice(0, 200) ?? null,
      result,
    });
    if (error) console.error(`[tool-results] insert failed for ${userId} (${tool}):`, error);
  } catch (err) {
    console.error(`[tool-results] could not record ${tool} for ${userId}:`, err);
  }
}

export async function listToolResults(
  userId: string,
  opts: { tool?: string; limit?: number } = {},
): Promise<ToolResultSummary[]> {
  const supabase = getSupabase();
  const limit = Math.min(Math.max(Number(opts.limit) || 50, 1), 200);

  let query = supabase
    .from('tool_results')
    .select('id, tool, input_summary, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (opts.tool) query = query.eq('tool', opts.tool);

  const { data, error } = await query;
  if (error) {
    throw Object.assign(new Error('Could not load your history'), { statusCode: 500, cause: error });
  }
  return (data ?? []) as ToolResultSummary[];
}

/**
 * One stored run, including its payload. Scoped by `user_id` as well as `id`, so
 * a guessed id from another account simply returns nothing.
 */
export async function getToolResult(userId: string, id: string): Promise<ToolResultDetail | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('tool_results')
    .select('id, tool, input_summary, created_at, result')
    .eq('user_id', userId)
    .eq('id', id)
    .maybeSingle();
  if (error) {
    throw Object.assign(new Error('Could not load that result'), { statusCode: 500, cause: error });
  }
  return (data as ToolResultDetail | null) ?? null;
}

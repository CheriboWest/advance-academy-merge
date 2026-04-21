/**
 * Marks abandoned CV analysis jobs as failed.
 *
 * Why this exists: the background task that runs the LLM work is pinned to the Node
 * process that received the POST. If that process restarts (deploy, crash, `tsx watch`
 * reload, etc.), the DB row is stuck in `running` forever because no one is still
 * awaiting the LLM calls. This reaper sweeps rows that haven't been updated in a while
 * and flips them to `failed` so the frontend stops spinning.
 */
import { getSupabase } from './supabase.js';

const REAP_INTERVAL_MS = 5 * 60 * 1000;
const STALE_AFTER_MS = 10 * 60 * 1000;

async function reapStaleJobs(): Promise<void> {
  const supabase = getSupabase();
  const cutoff = new Date(Date.now() - STALE_AFTER_MS).toISOString();

  const { data, error } = await supabase
    .from('cv_analysis_jobs')
    .update({
      status: 'failed',
      error_json: {
        code: 'JOB_ABANDONED',
        message: 'Analysis was abandoned (backend likely restarted). Please retry.',
      },
      updated_at: new Date().toISOString(),
    })
    .in('status', ['queued', 'running'])
    .lt('updated_at', cutoff)
    .select('id');

  if (error) {
    console.error('[cv-analysis-reaper] sweep failed:', error.message);
    return;
  }
  if (data && data.length > 0) {
    console.log(`[cv-analysis-reaper] marked ${data.length} stale job(s) as failed`);
  }
}

export function startCvAnalysisReaper(): void {
  void reapStaleJobs();
  setInterval(() => void reapStaleJobs(), REAP_INTERVAL_MS).unref();
}

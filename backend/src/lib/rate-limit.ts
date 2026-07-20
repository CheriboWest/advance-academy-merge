import type { FastifyRequest } from 'fastify';

/**
 * Per-user DAILY usage cap for credit-heavy (LLM) routes — the classroom cost knob.
 *
 * Keyed by authenticated userId (falls back to IP for the rare unauthenticated path) so a
 * shared campus IP doesn't throttle a whole class. `max` is env-tunable per feature so a
 * teacher can raise/lower limits on the host without a redeploy — mirrors how
 * JOB_MAX_ROLE_QUERIES is read from env. @fastify/rate-limit allows only one rateLimit
 * config per route, so this REPLACES a route's per-minute burst cap; a small daily number
 * makes bursting impossible anyway.
 *
 * `label` is shown to the student in the 429 message. `allowList` (optional) exempts some
 * requests from counting — Interview passes it so per-turn 'message' calls don't burn the
 * daily 'start' budget.
 *
 * ponytail: fixed 1-day window, per-user count. Real $-budget accounting (variable cost per
 * call) would be a Supabase tally wired into cost-tracker.ts, not this.
 */
export function perUserDaily(
  envVar: string,
  fallback: number,
  label: string,
  allowList?: (req: FastifyRequest) => boolean,
) {
  const raw = Number(process.env[envVar]);
  const max = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
  return {
    config: {
      rateLimit: {
        max,
        timeWindow: '1 day',
        keyGenerator: (req: FastifyRequest) => req.userId ?? req.ip,
        ...(allowList ? { allowList } : {}),
        errorResponseBuilder: (_req: FastifyRequest, ctx: { after: string }) => ({
          code: 'RATE_LIMIT_EXCEEDED',
          scope: label,
          message: `You've reached today's limit for ${label} (${max}/day). It resets in ${ctx.after}.`,
        }),
      },
    },
  };
}

// This route has been replaced by:
// - /api/dream-company/analyze (Step 1: Profile Analysis)
// - /api/dream-company/roles (Step 2: Roles + Companies)
// - /api/dream-company/roadmap (Step 3: Job Search + Roadmap)
//
// Keeping this file empty to avoid 404s during transition.
// Safe to delete once all clients have migrated.

export async function POST() {
  return new Response(
    JSON.stringify({ code: 'DEPRECATED', message: 'Use /api/dream-company/analyze, /roles, and /roadmap instead.' }),
    { status: 410, headers: { 'Content-Type': 'application/json' } },
  )
}

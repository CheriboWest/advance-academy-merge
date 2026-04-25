import { getSupabaseBrowser } from './supabase-browser'

export async function getAuthHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await getSupabaseBrowser().auth.getSession()
  if (!session?.access_token) return {}
  return { Authorization: `Bearer ${session.access_token}` }
}

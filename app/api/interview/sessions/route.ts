import { NextResponse } from 'next/server'
import { supabase, isDbReady } from '@/lib/supabase'

export async function GET() {
  if (!isDbReady()) {
    return NextResponse.json({ sessions: [] })
  }

  const { data, error } = await supabase!
    .from('interview_sessions')
    .select(
      'id, persona_id, mode, status, started_at, ended_at, final_score_json, context_json'
    )
    .order('started_at', { ascending: false })
    .limit(100)

  if (error) {
    console.error('[/api/interview/sessions]', error)
    return NextResponse.json(
      { error: 'Failed to load sessions' },
      { status: 500 }
    )
  }

  return NextResponse.json({ sessions: data ?? [] })
}

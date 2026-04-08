import { NextRequest, NextResponse } from 'next/server'
import { supabase, isDbReady } from '@/shared/utils/supabase'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isDbReady()) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 503 })
  }

  const { id } = await params

  const { data, error } = await supabase!
    .from('interview_sessions')
    .select('*')
    .eq('id', id)
    .single()

  if (error || !data) {
    console.error('[/api/interview/sessions/[id]]', error)
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }

  return NextResponse.json({ session: data })
}

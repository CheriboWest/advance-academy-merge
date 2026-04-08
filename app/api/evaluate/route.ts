import { NextRequest, NextResponse } from 'next/server'
import type { EvaluateSessionResponse } from '@/features/interview-prep/types'
import { generateFeedbackReport } from '@/shared/utils/feedback-engine'
import { dbCompleteSession, dbUpdateSessionStatus } from '@/shared/utils/db'

export async function POST(req: NextRequest) {
  try {
    const { session, dbSessionId } = await req.json()

    if (!session || !session.messages || session.messages.length === 0) {
      return NextResponse.json(
        { error: 'Invalid session data' },
        { status: 400 }
      )
    }

    // Mark session as evaluating in DB
    if (dbSessionId) {
      await dbUpdateSessionStatus(dbSessionId, 'evaluating')
    }

    const report = await generateFeedbackReport(session)

    // Persist final report and scores to database
    if (dbSessionId) {
      await dbCompleteSession(dbSessionId, report.overallIRS, report)
    }

    return NextResponse.json({ report } satisfies EvaluateSessionResponse)
  } catch (err) {
    console.error('[/api/evaluate]', err)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

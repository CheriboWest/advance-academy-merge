'use client'

import { useState, useCallback, useRef } from 'react'
import type {
  InterviewStep,
  InterviewContext,
  PersonaId,
  InterviewSession,
  InterviewMessage,
  IRSScore,
} from '@/lib/types'

const STORAGE_KEY = 'interview_sessions'

function loadSessions(): InterviewSession[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveSessions(sessions: InterviewSession[]) {
  if (typeof window === 'undefined') return
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions))
}

export function useInterview() {
  const [step, setStep] = useState<InterviewStep>('setup')
  const [context, setContext] = useState<InterviewContext>({
    cvText: '',
    jobTitle: '',
    jobDescription: '',
    companyName: '',
    companyUrl: '',
    extraLinks: '',
  })
  const [selectedPersona, setSelectedPersona] = useState<PersonaId | null>(null)
  const [session, setSession] = useState<InterviewSession | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [input, setInput] = useState('')

  // DB session ID tracked via ref (doesn't need to trigger re-renders)
  const dbSessionIdRef = useRef<string | null>(null)

  const updateContext = useCallback((updates: Partial<InterviewContext>) => {
    setContext((prev) => ({ ...prev, ...updates }))
  }, [])

  const startSession = useCallback(async () => {
    if (!selectedPersona) return
    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/interview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'start',
          personaId: selectedPersona,
          context,
        }),
      })

      if (!res.ok) throw new Error('Failed to start session')

      const data = await res.json()

      // Store DB session ID for subsequent requests
      if (data.dbSessionId) {
        dbSessionIdRef.current = data.dbSessionId
      }

      const openingMessage: InterviewMessage = {
        id: `msg_${Date.now()}`,
        role: 'interviewer',
        content: data.openingQuestion,
        timestamp: Date.now(),
      }

      const newSession: InterviewSession = {
        id: data.sessionId,
        personaId: selectedPersona,
        status: 'active',
        startedAt: Date.now(),
        messages: [openingMessage],
        context,
      }

      setSession(newSession)
      setStep('interview')

      const sessions = loadSessions()
      sessions.unshift(newSession)
      saveSessions(sessions)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start session')
    } finally {
      setLoading(false)
    }
  }, [selectedPersona, context])

  const sendMessage = useCallback(async () => {
    if (!session || !input.trim() || loading) return

    const candidateMessage: InterviewMessage = {
      id: `msg_${Date.now()}`,
      role: 'candidate',
      content: input.trim(),
      timestamp: Date.now(),
    }

    const updatedMessages = [...session.messages, candidateMessage]
    setSession((prev) => prev ? { ...prev, messages: updatedMessages } : null)
    setInput('')
    setLoading(true)
    setError(null)

    try {
      const messageHistory = updatedMessages.map((m) => ({
        role: m.role,
        content: m.content,
      }))

      const res = await fetch('/api/interview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'message',
          sessionId: session.id,
          content: candidateMessage.content,
          messageHistory,
          personaId: session.personaId,
          context: session.context,
          dbSessionId: dbSessionIdRef.current,
        }),
      })

      if (!res.ok) throw new Error('Failed to send message')

      const data = await res.json()

      const scoredCandidate: InterviewMessage = {
        ...candidateMessage,
        irsScore: data.irsScore,
      }

      const interviewerReply: InterviewMessage = {
        id: `msg_${Date.now() + 1}`,
        role: 'interviewer',
        content: data.reply,
        timestamp: Date.now(),
      }

      const finalMessages = [
        ...session.messages,
        scoredCandidate,
        interviewerReply,
      ]

      const updatedSession: InterviewSession = {
        ...session,
        messages: finalMessages,
      }

      setSession(updatedSession)

      const sessions = loadSessions()
      const idx = sessions.findIndex((s) => s.id === session.id)
      if (idx >= 0) {
        sessions[idx] = updatedSession
      }
      saveSessions(sessions)

      if (data.isComplete) {
        await evaluateSession(updatedSession)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message')
    } finally {
      setLoading(false)
    }
  }, [session, input, loading])

  const evaluateSession = useCallback(async (sessionToEvaluate: InterviewSession) => {
    setLoading(true)

    const evaluatingSession: InterviewSession = {
      ...sessionToEvaluate,
      status: 'evaluating',
    }
    setSession(evaluatingSession)

    try {
      const res = await fetch('/api/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session: evaluatingSession,
          dbSessionId: dbSessionIdRef.current,
        }),
      })

      if (!res.ok) throw new Error('Failed to evaluate session')

      const data = await res.json()

      const completedSession: InterviewSession = {
        ...evaluatingSession,
        status: 'complete',
        endedAt: Date.now(),
        finalReport: data.report,
      }

      setSession(completedSession)
      setStep('report')

      const sessions = loadSessions()
      const idx = sessions.findIndex((s) => s.id === completedSession.id)
      if (idx >= 0) {
        sessions[idx] = completedSession
      }
      saveSessions(sessions)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate report')
    } finally {
      setLoading(false)
    }
  }, [])

  const endInterview = useCallback(async () => {
    if (!session) return
    await evaluateSession(session)
  }, [session, evaluateSession])

  const reset = useCallback(() => {
    setStep('setup')
    setContext({
      cvText: '',
      jobTitle: '',
      jobDescription: '',
      companyName: '',
      companyUrl: '',
      extraLinks: '',
    })
    setSelectedPersona(null)
    setSession(null)
    setLoading(false)
    setError(null)
    setInput('')
    dbSessionIdRef.current = null
  }, [])

  const lastScore: IRSScore | undefined = session?.messages
    .filter((m) => m.role === 'candidate' && m.irsScore)
    .slice(-1)[0]?.irsScore

  const candidateAnswerCount = session?.messages.filter(
    (m) => m.role === 'candidate'
  ).length ?? 0

  return {
    step,
    setStep,
    context,
    updateContext,
    selectedPersona,
    setSelectedPersona,
    session,
    loading,
    error,
    input,
    setInput,
    startSession,
    sendMessage,
    endInterview,
    reset,
    lastScore,
    candidateAnswerCount,
  }
}

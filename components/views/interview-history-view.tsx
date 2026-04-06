'use client'

import { useEffect, useState } from 'react'
import { ArrowLeft, Loader2, AlertCircle, CheckCircle, Calendar, Clock, History } from 'lucide-react'
import type { SessionListItem, SessionDetail } from '@/lib/types'
import { PERSONAS } from '@/data/personas'
import { irsScoreColor, irsScoreLabel } from '@/lib/score-utils'

export function InterviewHistoryView() {
  const [sessions, setSessions] = useState<SessionListItem[]>([])
  const [selected, setSelected] = useState<SessionDetail | null>(null)
  const [loadingList, setLoadingList] = useState(true)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchList()
  }, [])

  async function fetchList() {
    setLoadingList(true)
    setError(null)
    try {
      const res = await fetch('/api/interview/sessions')
      if (!res.ok) throw new Error('Failed to load sessions')
      const data = await res.json()
      setSessions(data.sessions ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load sessions')
    } finally {
      setLoadingList(false)
    }
  }

  async function openSession(id: string) {
    setLoadingDetail(true)
    setError(null)
    try {
      const res = await fetch(`/api/interview/sessions/${id}`)
      if (!res.ok) throw new Error('Failed to load session')
      const data = await res.json()
      setSelected(data.session)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load session')
    } finally {
      setLoadingDetail(false)
    }
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      {!selected ? (
        <ListView
          sessions={sessions}
          loading={loadingList}
          error={error}
          onOpen={openSession}
          openingId={loadingDetail}
        />
      ) : (
        <DetailView session={selected} onBack={() => setSelected(null)} />
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// List
// ──────────────────────────────────────────────────────────────

function ListView({
  sessions,
  loading,
  error,
  onOpen,
  openingId,
}: {
  sessions: SessionListItem[]
  loading: boolean
  error: string | null
  onOpen: (id: string) => void
  openingId: boolean
}) {
  return (
    <>
      <div className="mb-8">
        <h1 className="text-4xl font-serif font-bold text-blue-900 mb-2 flex items-center gap-3">
          <History className="w-9 h-9 text-yellow-500" />
          Interview History
        </h1>
        <p className="text-gray-600 text-lg">
          Review your past mock interviews and feedback reports.
        </p>
      </div>

      {error && (
        <div className="mb-6 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <div>{error}</div>
        </div>
      )}

      {loading ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <Loader2 className="w-8 h-8 animate-spin text-yellow-500 mx-auto mb-3" />
          <p className="text-gray-500">Loading sessions…</p>
        </div>
      ) : sessions.length === 0 ? (
        <div className="bg-blue-50 rounded-xl p-12 text-center">
          <History className="w-12 h-12 text-blue-300 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-blue-900 mb-2">
            No interviews yet
          </h2>
          <p className="text-gray-600">
            Complete your first mock interview to see it here.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {sessions.map((s) => (
            <SessionCard
              key={s.id}
              session={s}
              onClick={() => onOpen(s.id)}
              disabled={openingId}
            />
          ))}
        </div>
      )}
    </>
  )
}

function SessionCard({
  session,
  onClick,
  disabled,
}: {
  session: SessionListItem
  onClick: () => void
  disabled: boolean
}) {
  const persona = PERSONAS.find((p) => p.id === session.persona_id)
  const overall = session.final_score_json?.overall ?? null
  const isComplete = session.status === 'complete'

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="w-full text-left bg-white rounded-xl border border-gray-200 shadow-sm p-5 hover:border-blue-300 hover:shadow-md transition-all disabled:opacity-50"
    >
      <div className="flex items-start gap-4">
        <div className="text-4xl">{persona?.avatar ?? '🎙️'}</div>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3 mb-1">
            <div>
              <h3 className="font-semibold text-blue-900">
                {persona?.name ?? session.persona_id}
                {session.context_json?.jobTitle && (
                  <span className="text-gray-500 font-normal">
                    {' · '}
                    {session.context_json.jobTitle}
                  </span>
                )}
              </h3>
              {session.context_json?.companyName && (
                <p className="text-sm text-gray-500">
                  {session.context_json.companyName}
                </p>
              )}
            </div>

            <StatusBadge status={session.status} />
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500 mt-2">
            <span className="flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5" />
              {formatDate(session.started_at)}
            </span>
            <span className="flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" />
              {formatDuration(session.started_at, session.ended_at)}
            </span>
            <span className="capitalize">{session.mode.replace('_', ' ')}</span>
          </div>
        </div>

        {isComplete && overall != null && (
          <div className="text-right shrink-0">
            <div
              className={`text-3xl font-bold tabular-nums ${irsScoreColor(overall)}`}
            >
              {overall.toFixed(1)}
            </div>
            <div className="text-xs text-gray-400">/10</div>
            <div className={`text-xs font-medium mt-0.5 ${irsScoreColor(overall)}`}>
              {irsScoreLabel(overall)}
            </div>
          </div>
        )}
      </div>
    </button>
  )
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    complete: 'bg-emerald-100 text-emerald-700',
    active: 'bg-blue-100 text-blue-700',
    evaluating: 'bg-amber-100 text-amber-700',
  }
  return (
    <span
      className={`px-2 py-0.5 rounded-full text-xs font-medium ${
        styles[status] ?? 'bg-gray-100 text-gray-600'
      }`}
    >
      {status}
    </span>
  )
}

// ──────────────────────────────────────────────────────────────
// Detail
// ──────────────────────────────────────────────────────────────

function DetailView({
  session,
  onBack,
}: {
  session: SessionDetail
  onBack: () => void
}) {
  const persona = PERSONAS.find((p) => p.id === session.persona_id)
  const score = session.final_score_json
  const report = session.final_report_json
  const overall = score?.overall ?? 0

  return (
    <div className="space-y-6">
      <button
        onClick={onBack}
        className="flex items-center gap-2 text-gray-600 hover:text-blue-900 font-medium"
      >
        <ArrowLeft className="w-4 h-4" /> Back to history
      </button>

      {/* Header card */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-8">
        <div className="flex items-start gap-4 mb-6">
          <div className="text-5xl">{persona?.avatar ?? '🎙️'}</div>
          <div className="flex-1">
            <h1 className="text-2xl font-serif font-bold text-blue-900">
              {persona?.name ?? session.persona_id}
            </h1>
            <p className="text-gray-500">{persona?.title}</p>
            {session.context_json?.jobTitle && (
              <p className="text-sm text-gray-600 mt-2">
                <span className="font-medium">{session.context_json.jobTitle}</span>
                {session.context_json.companyName && (
                  <> · {session.context_json.companyName}</>
                )}
              </p>
            )}
          </div>
          <StatusBadge status={session.status} />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm border-t border-gray-100 pt-5">
          <div>
            <div className="text-xs text-gray-400 uppercase tracking-wide">
              Started
            </div>
            <div className="text-gray-900 font-medium mt-0.5">
              {formatDateTime(session.started_at)}
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-400 uppercase tracking-wide">
              Ended
            </div>
            <div className="text-gray-900 font-medium mt-0.5">
              {session.ended_at ? formatDateTime(session.ended_at) : '—'}
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-400 uppercase tracking-wide">
              Duration
            </div>
            <div className="text-gray-900 font-medium mt-0.5">
              {formatDuration(session.started_at, session.ended_at)}
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-400 uppercase tracking-wide">
              Mode
            </div>
            <div className="text-gray-900 font-medium mt-0.5 capitalize">
              {session.mode.replace('_', ' ')}
            </div>
          </div>
        </div>
      </div>

      {/* Score */}
      {score && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-8">
          <div className="flex items-end gap-3 mb-6">
            <span
              className={`text-5xl font-bold tabular-nums ${irsScoreColor(overall)}`}
            >
              {overall.toFixed(1)}
            </span>
            <span className="text-xl text-gray-400 mb-1">/10</span>
            <span
              className={`ml-2 mb-2 text-sm font-semibold ${irsScoreColor(overall)}`}
            >
              {irsScoreLabel(overall)}
            </span>
          </div>

          <div className="grid grid-cols-3 gap-4 text-sm">
            <ScoreStat label="Integrity" value={score.integrity} />
            <ScoreStat label="Relevance" value={score.relevance} />
            <ScoreStat label="Substance" value={score.substance} />
          </div>
        </div>
      )}

      {/* Report */}
      {report ? (
        <>
          {report.summary && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
              <h3 className="text-sm font-semibold text-blue-900 mb-3">
                Summary
              </h3>
              <p className="text-gray-700 leading-relaxed">{report.summary}</p>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {report.strengths && report.strengths.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
                <h3 className="text-sm font-semibold text-emerald-700 mb-4 flex items-center gap-2">
                  <CheckCircle className="w-4 h-4" /> Strengths
                </h3>
                <div className="space-y-4">
                  {report.strengths.map((s, i) => (
                    <div key={i}>
                      <div className="font-semibold text-blue-900 text-sm">
                        {s.title}
                      </div>
                      <p className="text-sm text-gray-600 mt-1 leading-relaxed">
                        {s.detail}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {report.improvements && report.improvements.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
                <h3 className="text-sm font-semibold text-amber-700 mb-4 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4" /> Areas to Improve
                </h3>
                <div className="space-y-4">
                  {report.improvements.map((s, i) => (
                    <div key={i}>
                      <div className="font-semibold text-blue-900 text-sm">
                        {s.title}
                      </div>
                      <p className="text-sm text-gray-600 mt-1 leading-relaxed">
                        {s.detail}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="bg-blue-50 rounded-xl p-8 text-center text-gray-600">
          No final report available for this session yet.
        </div>
      )}
    </div>
  )
}

function ScoreStat({ label, value }: { label: string; value: number | undefined }) {
  const v = value ?? 0
  return (
    <div className="bg-gray-50 rounded-lg p-3">
      <div className="text-xs text-gray-500 uppercase tracking-wide">
        {label}
      </div>
      <div className={`text-2xl font-bold tabular-nums mt-1 ${irsScoreColor(v)}`}>
        {v.toFixed(1)}
        <span className="text-sm text-gray-400 font-normal">/10</span>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatDuration(startIso: string, endIso: string | null): string {
  if (!endIso) return 'In progress'
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime()
  const mins = Math.round(ms / 60000)
  if (mins < 1) return '<1 min'
  if (mins < 60) return `${mins} min`
  const hrs = Math.floor(mins / 60)
  const rem = mins % 60
  return rem ? `${hrs}h ${rem}m` : `${hrs}h`
}

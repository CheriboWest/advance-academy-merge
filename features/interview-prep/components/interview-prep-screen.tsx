'use client'

import { useRef, useEffect, useMemo, useState } from 'react'
import { authedFetch } from '@/shared/auth/authed-fetch'
import { useFakeProgress } from '@/shared/hooks/use-fake-progress'
import { ProgressBar } from '@/shared/hooks/progress-bar'
import Link from 'next/link'
import {
  ArrowRight,
  ArrowLeft,
  Send,
  Mic,
  CheckCircle,
  AlertCircle,
  Loader2,
  RotateCcw,
  Sparkles,
  Wand2,
  FileText,
  ChevronDown,
  ChevronRight,
  Plus,
  X,
  Search,
  Pencil,
} from 'lucide-react'
import type {
  InterviewMessage,
  CoachPreview,
  CoachPreviewBullet,
  UserBulletSummaryDto,
} from '@/features/interview-prep/types'

interface CvVersionOption {
  id: string
  name: string
  isActive: boolean
  detectedField: 'tech' | 'business' | 'marketing' | null
  bulletCount: number
  openGapCount: number
}
import type { ViewName } from '@/shared/types/navigation'
import type { PersonaId, InterviewStep } from '@/features/interview-prep/types'
import { PERSONAS } from '@/data/personas'
import { useInterview } from '@/hooks/use-interview'
import type { InterviewMode } from '@/hooks/use-interview'
import { IRSMeter } from '@/components/interview/irs-meter'
import { MicButton } from '@/features/interview-prep/components/mic-button'
import { irsScoreColor, irsScoreLabel } from '@/shared/utils/score-utils'

interface InterviewPrepScreenProps {
  onNavigate: (view: ViewName) => void
}

export function InterviewPrepScreen({ onNavigate }: InterviewPrepScreenProps) {
  const interview = useInterview()

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-4xl font-serif font-bold text-blue-900 mb-2">
          Interview Preparation
        </h1>
        <p className="text-gray-600 text-lg">
          Practice with AI interviewers tailored to your target role and company.
        </p>
      </div>

      <StepIndicator currentStep={interview.step} />

      {interview.error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />
          <p className="text-red-700 text-sm">{interview.error}</p>
        </div>
      )}

      {interview.step === 'setup' && (
        <SetupStep
          context={interview.context}
          updateContext={interview.updateContext}
          onNext={() => interview.setStep('persona')}
        />
      )}

      {interview.step === 'persona' && (
        <PersonaStep
          selectedPersona={interview.selectedPersona}
          onSelect={interview.setSelectedPersona}
          mode={interview.mode}
          onSelectMode={interview.setMode}
          onBack={() => interview.setStep('setup')}
          onStart={interview.startSession}
          loading={interview.loading}
        />
      )}

      {interview.step === 'interview' && interview.session && (
        <InterviewStepView
          session={interview.session}
          mode={interview.mode}
          input={interview.input}
          setInput={interview.setInput}
          loading={interview.loading}
          onSend={interview.sendMessage}
          onEnd={interview.endInterview}
          lastScore={interview.lastScore}
          candidateAnswerCount={interview.candidateAnswerCount}
          onRequestCoachPreview={interview.requestCoachPreview}
          onRequestCoachGenerate={interview.requestCoachGenerate}
          onSetCoachPreview={interview.setCoachPreview}
          onSubmitJit={interview.submitJitClarification}
          transcribeAudio={interview.transcribeAudio}
          transcribing={interview.transcribing}
        />
      )}

      {interview.step === 'report' && interview.session?.finalReport && (
        <ReportStep
          session={interview.session}
          onNavigateHome={() => onNavigate('home')}
          onNewInterview={interview.reset}
        />
      )}
    </div>
  )
}

function StepIndicator({ currentStep }: { currentStep: InterviewStep }) {
  const steps: { key: InterviewStep; label: string }[] = [
    { key: 'setup', label: 'Context' },
    { key: 'persona', label: 'Persona' },
    { key: 'interview', label: 'Interview' },
    { key: 'report', label: 'Report' },
  ]
  const currentIndex = steps.findIndex((s) => s.key === currentStep)

  return (
    <div className="flex items-center justify-center gap-2 mb-8">
      {steps.map((s, i) => (
        <div key={s.key} className="flex items-center gap-2">
          <div
            className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              i === currentIndex
                ? 'bg-blue-900 text-white'
                : i < currentIndex
                  ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-gray-100 text-gray-400'
            }`}
          >
            {i < currentIndex ? (
              <CheckCircle className="w-4 h-4" />
            ) : (
              <span className="w-5 h-5 flex items-center justify-center text-xs font-bold">
                {i + 1}
              </span>
            )}
            {s.label}
          </div>
          {i < steps.length - 1 && (
            <div className={`w-8 h-0.5 ${i < currentIndex ? 'bg-emerald-300' : 'bg-gray-200'}`} />
          )}
        </div>
      ))}
    </div>
  )
}

function SetupStep({
  context,
  updateContext,
  onNext,
}: {
  context: ReturnType<typeof useInterview>['context']
  updateContext: ReturnType<typeof useInterview>['updateContext']
  onNext: () => void
}) {
  const isValid =
    context.cvText.trim().length > 0 &&
    context.jobTitle.trim().length > 0 &&
    context.jobDescription.trim().length > 0 &&
    context.companyName.trim().length > 0

  // ── CV Library picker ──────────────────────────────────────────────
  const [cvVersions, setCvVersions] = useState<CvVersionOption[]>([])
  const [cvLoading, setCvLoading] = useState(true)
  const [cvError, setCvError] = useState<string | null>(null)
  const [selectedCvId, setSelectedCvId] = useState<string>('')
  const [loadingRawText, setLoadingRawText] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setCvLoading(true)
      setCvError(null)
      try {
        const res = await authedFetch('/api/cv-library/versions')
        if (!res.ok) throw new Error('Failed to load CVs')
        const data: CvVersionOption[] = await res.json()
        if (cancelled) return
        setCvVersions(data)
        // Default to active CV (or first one)
        const active = data.find((c) => c.isActive) ?? data[0]
        if (active && !selectedCvId) {
          setSelectedCvId(active.id)
        }
      } catch (err) {
        if (!cancelled) setCvError(err instanceof Error ? err.message : 'Failed to load CVs')
      } finally {
        if (!cancelled) setCvLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // When the selected CV changes, fetch its raw text and put it into context.cvText
  // so the existing scoring/feedback path stays grounded.
  useEffect(() => {
    if (!selectedCvId) return
    let cancelled = false
    ;(async () => {
      setLoadingRawText(true)
      try {
        const res = await authedFetch(`/api/cv-library/versions/${selectedCvId}`)
        if (!res.ok) throw new Error('Failed to load CV')
        const data: { rawText: string } = await res.json()
        if (cancelled) return
        updateContext({ cvText: data.rawText ?? '' })
      } catch (err) {
        if (!cancelled) setCvError(err instanceof Error ? err.message : 'Failed to load CV')
      } finally {
        if (!cancelled) setLoadingRawText(false)
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCvId])

  // Also keep the active CV in sync so the coach-answer service uses the same one.
  const handleSelectCv = async (id: string) => {
    setSelectedCvId(id)
    try {
      await authedFetch(`/api/cv-library/versions/${id}/activate`, { method: 'POST' })
      setCvVersions((prev) => prev.map((c) => ({ ...c, isActive: c.id === id })))
    } catch {
      // non-fatal
    }
  }

  const [jobUrl, setJobUrl] = useState('')
  const [extractError, setExtractError] = useState<string | null>(null)
  const [extractInfo, setExtractInfo] = useState<string | null>(null)
  const {
    progress: extractProgress,
    phase: extractPhase,
    busy: extracting,
    start: startExtractProgress,
    finish: finishExtractProgress,
    reset: resetExtractProgress,
  } = useFakeProgress({
    tauMs: 8_000,
    phaseLabel: (elapsedMs) => {
      if (elapsedMs < 2_500) return 'Fetching the job posting…'
      if (elapsedMs < 10_000) return 'Extracting job details with AI…'
      return 'Finalising the structured fields…'
    },
  })

  const handleExtractFromUrl = async () => {
    const url = jobUrl.trim()
    if (!url) return
    setExtractError(null)
    setExtractInfo(null)
    startExtractProgress()
    try {
      const res = await authedFetch('/api/interview-prep/extract-job-from-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error || data?.message || 'Failed to extract job details')
      }
      const data: {
        jobTitle?: string
        jobDescription?: string
        companyName?: string
        companyUrl?: string
        extraLinks?: string
      } = await res.json()

      // Only overwrite fields that came back non-empty so user-typed data is preserved.
      const updates: Record<string, string> = {}
      if (data.jobTitle) updates.jobTitle = data.jobTitle
      if (data.jobDescription) updates.jobDescription = data.jobDescription
      if (data.companyName) updates.companyName = data.companyName
      if (data.companyUrl) updates.companyUrl = data.companyUrl
      if (data.extraLinks) updates.extraLinks = data.extraLinks
      updateContext(updates)

      const filled = Object.keys(updates).length
      const missing = 5 - filled
      finishExtractProgress()
      setExtractInfo(
        missing === 0
          ? 'All fields extracted. Review and edit as needed.'
          : `Filled ${filled} of 5 fields. Please complete the remaining ${missing} manually.`,
      )
    } catch (err) {
      resetExtractProgress()
      setExtractError(err instanceof Error ? err.message : 'Failed to extract job details')
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
      <div className="lg:col-span-2">
        <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-4">
          <label className="block text-sm font-semibold text-blue-900 mb-2">
            Paste a job posting URL to auto-fill
          </label>
          <p className="text-xs text-gray-600 mb-3">
            We use Jina Reader + AI to pull the job title, description, company name, website, and links from a LinkedIn (or similar) job page. Anything we can&apos;t find is left blank for you to fill in.
          </p>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="url"
              value={jobUrl}
              onChange={(e) => setJobUrl(e.target.value)}
              placeholder="https://www.linkedin.com/jobs/view/..."
              disabled={extracting}
              className="flex-1 p-3 border border-gray-200 rounded-xl text-sm text-gray-700 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400 disabled:opacity-50"
            />
            <button
              type="button"
              onClick={handleExtractFromUrl}
              disabled={extracting || !jobUrl.trim()}
              className="flex items-center justify-center gap-2 px-5 py-3 bg-blue-900 text-white rounded-xl text-sm font-semibold hover:bg-blue-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {extracting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> Extracting...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" /> Extract
                </>
              )}
            </button>
          </div>
          {extracting && <ProgressBar progress={extractProgress} phase={extractPhase} />}
          {extractError && (
            <p className="mt-2 text-xs text-red-600 flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5" /> {extractError}
            </p>
          )}
          {extractInfo && !extractError && (
            <p className="mt-2 text-xs text-emerald-700 flex items-center gap-1.5">
              <CheckCircle className="w-3.5 h-3.5" /> {extractInfo}
            </p>
          )}
        </div>
      </div>

      <div className="space-y-6">
        <div>
          <label className="block text-sm font-semibold text-blue-900 mb-2">
            CV from your library *
          </label>
          {cvLoading ? (
            <div className="flex items-center gap-2 text-sm text-gray-500 p-3 border border-gray-200 rounded-xl">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading your CVs…
            </div>
          ) : cvVersions.length === 0 ? (
            <div className="p-4 border border-yellow-200 bg-yellow-50 rounded-xl text-sm">
              <p className="text-yellow-900 font-medium mb-1 flex items-center gap-1.5">
                <AlertCircle className="w-4 h-4" /> No CVs in your library yet
              </p>
              <p className="text-yellow-800 text-xs mb-2">
                Upload one in the CV Library so we can ground your interview answers in real evidence.
              </p>
              <Link
                href="/cv-library"
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-900 hover:text-blue-700"
              >
                <FileText className="w-3.5 h-3.5" /> Go to CV Library →
              </Link>
            </div>
          ) : (
            <>
              <div className="relative">
                <select
                  value={selectedCvId}
                  onChange={(e) => handleSelectCv(e.target.value)}
                  disabled={loadingRawText}
                  className="w-full p-3 pr-10 border border-gray-200 rounded-xl text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400 disabled:opacity-50 appearance-none"
                >
                  {cvVersions.map((cv) => (
                    <option key={cv.id} value={cv.id}>
                      {cv.name}
                      {cv.isActive ? ' (active)' : ''}
                      {cv.detectedField ? ` · ${cv.detectedField}` : ''}
                      {' · '}
                      {cv.bulletCount} bullets, {cv.openGapCount} gaps remaining
                    </option>
                  ))}
                </select>
                <FileText className="w-4 h-4 text-gray-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
              <div className="flex items-center justify-between mt-1">
                <p className="text-xs text-gray-400">
                  {loadingRawText
                    ? 'Loading CV…'
                    : context.cvText.length > 0
                      ? `${context.cvText.length} characters loaded`
                      : 'Select a CV to use for this interview'}
                </p>
                <Link
                  href="/cv-library"
                  className="text-xs text-blue-700 hover:text-blue-900 font-medium"
                >
                  Manage library →
                </Link>
              </div>
            </>
          )}
          {cvError && (
            <p className="mt-2 text-xs text-red-600 flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5" /> {cvError}
            </p>
          )}
        </div>

        <div>
          <label className="block text-sm font-semibold text-blue-900 mb-2">Job Title *</label>
          <input
            type="text"
            value={context.jobTitle}
            onChange={(e) => updateContext({ jobTitle: e.target.value })}
            placeholder="e.g., Senior Frontend Engineer"
            className="w-full p-3 border border-gray-200 rounded-xl text-sm text-gray-700 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
          />
        </div>
      </div>

      <div className="space-y-6">
        <div>
          <label className="block text-sm font-semibold text-blue-900 mb-2">Job Description *</label>
          <textarea
            value={context.jobDescription}
            onChange={(e) => updateContext({ jobDescription: e.target.value })}
            placeholder="Paste the full job description here..."
            className="w-full h-32 p-4 border border-gray-200 rounded-xl text-sm text-gray-700 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400 resize-none"
          />
        </div>

        <div>
          <label className="block text-sm font-semibold text-blue-900 mb-2">Company Name *</label>
          <input
            type="text"
            value={context.companyName}
            onChange={(e) => updateContext({ companyName: e.target.value })}
            placeholder="e.g., Google"
            className="w-full p-3 border border-gray-200 rounded-xl text-sm text-gray-700 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
          />
        </div>

        <div>
          <label className="block text-sm font-semibold text-blue-900 mb-2">
            Company URL <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <input
            type="url"
            value={context.companyUrl}
            onChange={(e) => updateContext({ companyUrl: e.target.value })}
            placeholder="e.g., https://google.com"
            className="w-full p-3 border border-gray-200 rounded-xl text-sm text-gray-700 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
          />
        </div>

        <div>
          <label className="block text-sm font-semibold text-blue-900 mb-2">
            Additional Links <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <input
            type="text"
            value={context.extraLinks}
            onChange={(e) => updateContext({ extraLinks: e.target.value })}
            placeholder="LinkedIn profile, portfolio, etc."
            className="w-full p-3 border border-gray-200 rounded-xl text-sm text-gray-700 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
          />
        </div>
      </div>

      <div className="lg:col-span-2 flex justify-end">
        <button
          onClick={onNext}
          disabled={!isValid}
          className="flex items-center gap-2 px-6 py-3 bg-blue-900 text-white rounded-xl font-semibold hover:bg-blue-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Choose Interviewer <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}

function PersonaStep({
  selectedPersona,
  onSelect,
  mode,
  onSelectMode,
  onBack,
  onStart,
  loading,
}: {
  selectedPersona: PersonaId | null
  onSelect: (id: PersonaId) => void
  mode: InterviewMode
  onSelectMode: (mode: InterviewMode) => void
  onBack: () => void
  onStart: () => void
  loading: boolean
}) {
  return (
    <div>
      <p className="text-gray-600 mb-6 text-center">
        Choose your interviewer persona. Each has a unique style and evaluation approach.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        {PERSONAS.map((persona) => (
          <button
            key={persona.id}
            onClick={() => onSelect(persona.id)}
            className={`p-5 rounded-xl border-2 text-left transition-all ${
              selectedPersona === persona.id
                ? 'border-blue-900 bg-blue-50 shadow-md'
                : 'border-gray-200 hover:border-gray-300 hover:shadow-sm'
            }`}
          >
            <div className="flex items-center gap-3 mb-3">
              <span className="text-3xl">{persona.avatar}</span>
              <div>
                <h3 className="font-semibold text-blue-900">{persona.name}</h3>
                <p className="text-xs text-gray-500">{persona.title}</p>
              </div>
            </div>
            <p className="text-sm text-gray-600 mb-3">{persona.description}</p>
            <div className="flex flex-wrap gap-1.5">
              {persona.style.split(' · ').map((tag) => (
                <span key={tag} className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded-full">
                  {tag}
                </span>
              ))}
            </div>
          </button>
        ))}
      </div>

      <div className="bg-blue-50 rounded-xl p-4 mb-8 flex items-center gap-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => onSelectMode('text')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              mode === 'text'
                ? 'bg-blue-900 text-white'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
          >
            Text Mode
          </button>
          <button
            type="button"
            onClick={() => onSelectMode('voice')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${
              mode === 'voice'
                ? 'bg-blue-900 text-white'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
          >
            <Mic className="w-3.5 h-3.5" /> Voice Mode
          </button>
        </div>
        <p className="text-xs text-gray-600 ml-auto">
          {mode === 'voice'
            ? 'Speak your answers — we transcribe them for you.'
            : 'Type your answers in the chat box.'}
        </p>
      </div>

      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          className="flex items-center gap-2 px-5 py-2.5 text-gray-600 hover:text-gray-800 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <button
          onClick={onStart}
          disabled={!selectedPersona || loading}
          className="flex items-center gap-2 px-6 py-3 bg-yellow-500 text-blue-900 rounded-xl font-semibold hover:bg-yellow-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" /> Starting Interview...
            </>
          ) : (
            <>
              Start Interview <ArrowRight className="w-4 h-4" />
            </>
          )}
        </button>
      </div>
    </div>
  )
}

function InterviewStepView({
  session,
  mode,
  input,
  setInput,
  loading,
  onSend,
  onEnd,
  lastScore,
  candidateAnswerCount,
  onRequestCoachPreview,
  onRequestCoachGenerate,
  onSetCoachPreview,
  onSubmitJit,
  transcribeAudio,
  transcribing,
}: {
  session: NonNullable<ReturnType<typeof useInterview>['session']>
  mode: InterviewMode
  input: string
  setInput: (val: string) => void
  loading: boolean
  onSend: () => void
  onEnd: () => void
  lastScore: ReturnType<typeof useInterview>['lastScore']
  candidateAnswerCount: number
  onRequestCoachPreview: (messageId: string) => Promise<void>
  onRequestCoachGenerate: (messageId: string, selectedBulletIds: string[]) => Promise<void>
  onSetCoachPreview: (messageId: string, coachPreview: CoachPreview) => void
  onSubmitJit: (messageId: string, promptIndex: number, answer: string, selectedBulletIds: string[]) => Promise<void>
  transcribeAudio: (blob: Blob) => Promise<string>
  transcribing: boolean
}) {
  const chatEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const persona = PERSONAS.find((p) => p.id === session.personaId)

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [session.messages.length])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      onSend()
    }
  }

  const isEvaluating = session.status === 'evaluating'

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 flex flex-col">
        {persona && (
          <div className="flex items-center gap-3 mb-4 p-3 bg-blue-50 rounded-xl">
            <span className="text-2xl">{persona.avatar}</span>
            <div>
              <h3 className="font-semibold text-blue-900 text-sm">{persona.name}</h3>
              <p className="text-xs text-gray-500">{persona.title}</p>
            </div>
            <div className="flex gap-1.5 ml-auto">
              {persona.style.split(' · ').map((tag) => (
                <span key={tag} className="px-2 py-0.5 bg-white text-gray-600 text-xs rounded-full">
                  {tag}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="flex-1 space-y-4 mb-4 max-h-[500px] overflow-y-auto pr-2">
          {session.messages.map((msg) => (
            <div key={msg.id}>
              <div className={`flex ${msg.role === 'candidate' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                    msg.role === 'candidate' ? 'bg-blue-900 text-white' : 'bg-gray-100 text-gray-800'
                  }`}
                >
                  <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                  {msg.irsScore && (
                    <div className="mt-2 pt-2 border-t border-blue-800/30">
                      <IRSMeter score={msg.irsScore} compact />
                    </div>
                  )}
                </div>
              </div>
              {msg.role === 'candidate' && msg.questionAsked && (
                <CoachPanel
                  message={msg}
                  onRequestCoachPreview={onRequestCoachPreview}
                  onRequestCoachGenerate={onRequestCoachGenerate}
                  onSetCoachPreview={onSetCoachPreview}
                  onSubmitJit={onSubmitJit}
                />
              )}
            </div>
          ))}

          {loading && (
            <div className="flex justify-start">
              <div className="bg-gray-100 rounded-2xl px-4 py-3">
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {isEvaluating ? 'Generating your feedback report...' : 'Thinking...'}
                </div>
              </div>
            </div>
          )}

          <div ref={chatEndRef} />
        </div>

        {session.status === 'active' && (
          <div className="border border-gray-200 rounded-xl p-3">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                mode === 'voice'
                  ? 'Press Record to speak your answer, or type here... (Ctrl + Enter to send)'
                  : 'Type your answer here... (Ctrl + Enter to send)'
              }
              disabled={loading || transcribing}
              rows={3}
              className="w-full text-sm text-gray-700 placeholder:text-gray-400 focus:outline-none resize-none disabled:opacity-50"
            />
            <div className="flex items-center justify-between mt-2 gap-2">
              <span className="text-xs text-gray-400">{input.length} characters</span>
              <div className="flex items-center gap-2">
                {mode === 'voice' && (
                  <MicButton
                    disabled={loading}
                    transcribing={transcribing}
                    onTranscribe={transcribeAudio}
                    onTranscribed={(text) =>
                      setInput(input.trim() ? `${input.trim()} ${text}` : text)
                    }
                  />
                )}
                <button
                  onClick={onEnd}
                  disabled={candidateAnswerCount < 1 || loading}
                  className="px-4 py-2 text-sm text-gray-500 hover:text-red-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  End Interview
                </button>
                <button
                  onClick={onSend}
                  disabled={!input.trim() || loading || transcribing}
                  className="flex items-center gap-1.5 px-4 py-2 bg-blue-900 text-white rounded-lg text-sm font-medium hover:bg-blue-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Send className="w-3.5 h-3.5" /> Send
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="space-y-4">
        {lastScore && (
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <h3 className="text-sm font-semibold text-blue-900 mb-3">Last Answer Score</h3>
            <IRSMeter score={lastScore} />
          </div>
        )}

        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-blue-900 mb-3">Session Progress</h3>
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Answers given</span>
              <span className="font-medium text-gray-700">{candidateAnswerCount}</span>
            </div>
            {candidateAnswerCount > 0 && <RunningAverages messages={session.messages} />}
          </div>
        </div>

        <div className="bg-blue-50 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-blue-900 mb-3">IRS Rubric</h3>
          <div className="space-y-2 text-xs text-gray-600">
            <p>
              <span className="font-semibold text-blue-900">I - Integrity (30%):</span> Authenticity, honesty, internal consistency
            </p>
            <p>
              <span className="font-semibold text-blue-900">R - Relevance (30%):</span> Addresses the question and target role
            </p>
            <p>
              <span className="font-semibold text-blue-900">S - Substance (40%):</span> Depth, specifics, examples, metrics
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

function RunningAverages({
  messages,
}: {
  messages: { role: string; irsScore?: { integrity: { score: number }; relevance: { score: number }; substance: { score: number }; overall: number } }[]
}) {
  const scored = messages.filter((m) => m.role === 'candidate' && m.irsScore)
  if (scored.length === 0) return null

  const avg = (fn: (s: NonNullable<(typeof scored)[0]['irsScore']>) => number) =>
    Math.round((scored.reduce((sum, m) => sum + fn(m.irsScore!), 0) / scored.length) * 10) / 10

  return (
    <div className="space-y-1.5 pt-2 border-t border-gray-100">
      <div className="flex justify-between text-xs">
        <span className="text-gray-500">Avg Integrity</span>
        <span className="font-medium">{avg((s) => s.integrity.score).toFixed(1)}</span>
      </div>
      <div className="flex justify-between text-xs">
        <span className="text-gray-500">Avg Relevance</span>
        <span className="font-medium">{avg((s) => s.relevance.score).toFixed(1)}</span>
      </div>
      <div className="flex justify-between text-xs">
        <span className="text-gray-500">Avg Substance</span>
        <span className="font-medium">{avg((s) => s.substance.score).toFixed(1)}</span>
      </div>
      <div className="flex justify-between text-xs font-semibold">
        <span className="text-gray-600">Overall</span>
        <span className={irsScoreColor(avg((s) => s.overall))}>{avg((s) => s.overall).toFixed(1)}/10</span>
      </div>
    </div>
  )
}

function CoachPanel({
  message,
  onRequestCoachPreview,
  onRequestCoachGenerate,
  onSetCoachPreview,
  onSubmitJit,
}: {
  message: InterviewMessage
  onRequestCoachPreview: (id: string) => Promise<void>
  onRequestCoachGenerate: (id: string, selectedBulletIds: string[]) => Promise<void>
  onSetCoachPreview: (id: string, coachPreview: CoachPreview) => void
  onSubmitJit: (id: string, idx: number, answer: string, selectedBulletIds: string[]) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [previewBusy, setPreviewBusy] = useState(false)
  const [generateBusy, setGenerateBusy] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[] | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)

  const preview = message.coachPreview
  const coach = message.coach

  // Seed user-editable selection from the embedding-preselected list the
  // first time a preview lands. After that the user owns it.
  useEffect(() => {
    if (preview && selectedIds === null) {
      setSelectedIds(preview.selectedBulletIds)
    }
  }, [preview, selectedIds])

  const effectiveSelected = selectedIds ?? preview?.selectedBulletIds ?? []

  const handleToggleOpen = async () => {
    if (!preview && !previewBusy) {
      setPreviewBusy(true)
      try {
        await onRequestCoachPreview(message.id)
      } finally {
        setPreviewBusy(false)
      }
    }
    setOpen((o) => !o)
  }

  const handleRefreshBullet = async (bulletId: string) => {
    if (!preview) return
    try {
      const res = await authedFetch(`/api/cv-library/bullets/${bulletId}/details`)
      if (!res.ok) return
      const detail = (await res.json()) as BulletWithGapsDto
      const updatedBullet: CoachPreviewBullet = adaptBulletDetail(detail, currentSimilarity(preview, bulletId))
      onSetCoachPreview(message.id, {
        ...preview,
        bullets: preview.bullets.some((b) => b.id === bulletId)
          ? preview.bullets.map((b) => (b.id === bulletId ? updatedBullet : b))
          : [...preview.bullets, updatedBullet],
        // Bump answered counts in the lightweight pool too so the picker stays accurate.
        allBullets: preview.allBullets.map((b) =>
          b.id === bulletId
            ? {
                ...b,
                gapCount: updatedBullet.gaps.length,
                answeredGapCount: updatedBullet.gaps.filter((g) => g.status === 'answered').length,
              }
            : b,
        ),
      })
    } catch {
      // non-fatal — UI just won't refresh, user can re-expand to retry
    }
  }

  const handleAddBullet = async (bulletId: string) => {
    if (!preview) return
    if (effectiveSelected.includes(bulletId)) {
      setPickerOpen(false)
      return
    }
    // If we already have its details, just add to the selection.
    if (preview.bullets.some((b) => b.id === bulletId)) {
      setSelectedIds([...effectiveSelected, bulletId])
      setPickerOpen(false)
      return
    }
    // Otherwise lazy-load the bullet's gaps + raw artifacts.
    try {
      const res = await authedFetch(`/api/cv-library/bullets/${bulletId}/details`)
      if (!res.ok) return
      const detail = (await res.json()) as BulletWithGapsDto
      const newBullet = adaptBulletDetail(detail, 0)
      onSetCoachPreview(message.id, {
        ...preview,
        bullets: [...preview.bullets, newBullet],
      })
      setSelectedIds([...effectiveSelected, bulletId])
      setPickerOpen(false)
    } catch {
      // ignore — user can retry
    }
  }

  const handleRemoveBullet = (bulletId: string) => {
    setSelectedIds(effectiveSelected.filter((id) => id !== bulletId))
  }

  const handleGenerate = async () => {
    if (generateBusy) return
    setGenerateBusy(true)
    try {
      await onRequestCoachGenerate(message.id, effectiveSelected)
    } finally {
      setGenerateBusy(false)
    }
  }

  // Bullets the user has currently selected, in selection order, joined with
  // their preview details (gaps + raw artifacts).
  const selectedBullets: CoachPreviewBullet[] = useMemo(() => {
    if (!preview) return []
    const byId = new Map(preview.bullets.map((b) => [b.id, b]))
    return effectiveSelected
      .map((id) => byId.get(id))
      .filter((b): b is CoachPreviewBullet => Boolean(b))
  }, [preview, effectiveSelected])

  return (
    <div className="flex justify-end mt-2">
      <div className="max-w-[80%] w-full">
        <button
          onClick={handleToggleOpen}
          disabled={previewBusy}
          className="flex items-center gap-1.5 text-xs text-blue-700 hover:text-blue-900 font-medium ml-auto"
        >
          {previewBusy ? (
            <>
              <Loader2 className="w-3 h-3 animate-spin" /> Loading evidence…
            </>
          ) : (
            <>
              <Wand2 className="w-3 h-3" />
              {coach
                ? open
                  ? 'Hide enhanced version'
                  : 'Show enhanced version'
                : preview
                  ? open
                    ? 'Hide evidence panel'
                    : 'Review evidence'
                  : 'See enhanced version'}
            </>
          )}
        </button>

        {open && preview && (
          <div className="mt-2 border border-blue-200 bg-blue-50/60 rounded-xl p-4 space-y-3">
            {!coach && (
              <>
                <div>
                  <p className="text-xs font-semibold text-blue-900 mb-0.5">
                    Evidence the AI coach will use
                  </p>
                  <p className="text-[11px] text-gray-500">
                    Top {preview.bullets.length || '0'} bullet
                    {preview.bullets.length === 1 ? '' : 's'} retrieved by similarity
                    (≥ {Math.round(preview.threshold * 100)}%). Add or remove bullets to control
                    what the coach sees. Raw evidence stays here — only structured summaries are
                    sent to the AI.
                  </p>
                </div>

                {selectedBullets.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-blue-200 p-3 text-xs text-gray-500 italic">
                    No bullets selected. Add at least one from your CV pool below — or click
                    Generate anyway to let the coach work from your answer alone (expect more
                    placeholders).
                  </div>
                ) : (
                  <ul className="space-y-2">
                    {selectedBullets.map((b) => (
                      <CoachBulletRow
                        key={b.id}
                        bullet={b}
                        onRemove={() => handleRemoveBullet(b.id)}
                        onChanged={() => handleRefreshBullet(b.id)}
                      />
                    ))}
                  </ul>
                )}

                <div>
                  {pickerOpen ? (
                    <CoachBulletPicker
                      allBullets={preview.allBullets}
                      excludeIds={effectiveSelected}
                      onPick={handleAddBullet}
                      onClose={() => setPickerOpen(false)}
                    />
                  ) : (
                    <button
                      onClick={() => setPickerOpen(true)}
                      className="flex items-center gap-1 text-xs text-blue-700 hover:text-blue-900 font-medium"
                    >
                      <Plus className="w-3 h-3" /> Add a CV bullet
                    </button>
                  )}
                </div>

                <div className="pt-2 border-t border-blue-200 flex items-center justify-between">
                  <span className="text-[11px] text-gray-500">
                    {selectedBullets.length} bullet
                    {selectedBullets.length === 1 ? '' : 's'} will be sent to the coach
                  </span>
                  <button
                    onClick={handleGenerate}
                    disabled={generateBusy}
                    className="px-3 py-1.5 bg-blue-900 text-white rounded-lg text-xs font-medium hover:bg-blue-800 disabled:opacity-50 flex items-center gap-1.5"
                  >
                    {generateBusy ? (
                      <>
                        <Loader2 className="w-3 h-3 animate-spin" /> Generating…
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-3 h-3" /> Generate enhanced response
                      </>
                    )}
                  </button>
                </div>
              </>
            )}

            {coach && (
              <div>
                {coach.critique && (
                  <p className="text-xs text-gray-600 italic mb-2">{coach.critique}</p>
                )}
                <div className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">
                  {renderImproved(coach.improvedAnswer)}
                </div>
                {coach.missingEvidencePrompts.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-blue-200 space-y-2">
                    <p className="text-xs font-semibold text-blue-900">
                      Help me fill in the missing details:
                    </p>
                    {coach.missingEvidencePrompts.map((p, i) => (
                      <JitForm
                        key={`${message.id}-${i}`}
                        question={p.question}
                        bulletText={p.bulletText}
                        onSubmit={(answer) => onSubmitJit(message.id, i, answer, effectiveSelected)}
                      />
                    ))}
                  </div>
                )}
                <div className="mt-3 pt-2 border-t border-blue-200 flex items-center justify-between text-[11px] text-gray-500">
                  <span>
                    Used {selectedBullets.length} bullet{selectedBullets.length === 1 ? '' : 's'}
                  </span>
                  <button
                    onClick={handleGenerate}
                    disabled={generateBusy}
                    className="text-blue-700 hover:text-blue-900 font-medium flex items-center gap-1"
                    title="Regenerate with the same selection"
                  >
                    {generateBusy ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <RotateCcw className="w-3 h-3" />
                    )}
                    Regenerate
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// Shape the /api/cv-library/bullets/:id/details proxy returns. Same as the
// CV-Library page's BulletWithGaps but with raw artifact `contentText`.
interface BulletWithGapsDto {
  id: string
  sectionPath: string | null
  bulletText: string
  ordinal: number
  gaps: Array<{
    id: string
    question: string
    rationale: string | null
    ordinal: number
    status: 'open' | 'answered' | 'skipped'
    artifacts: Array<{
      id: string
      sourceType: 'text' | 'file' | 'url' | 'jit_clarification'
      contentText: string | null
      sourceUrl: string | null
      summary: unknown
      createdAt: string
    }>
  }>
}

function adaptBulletDetail(detail: BulletWithGapsDto, similarity: number): CoachPreviewBullet {
  return {
    id: detail.id,
    bulletText: detail.bulletText,
    sectionPath: detail.sectionPath,
    similarity,
    gaps: detail.gaps.map((g) => ({
      id: g.id,
      question: g.question,
      status: g.status,
      artifacts: g.artifacts.map((a) => ({
        id: a.id,
        sourceType: a.sourceType,
        contentText: a.contentText,
        sourceUrl: a.sourceUrl,
        createdAt: a.createdAt,
      })),
    })),
  }
}

function currentSimilarity(preview: CoachPreview, bulletId: string): number {
  return preview.bullets.find((b) => b.id === bulletId)?.similarity ?? 0
}

function CoachBulletRow({
  bullet,
  onRemove,
  onChanged,
}: {
  bullet: CoachPreviewBullet
  onRemove: () => void
  onChanged: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const artifactCount = bullet.gaps.reduce((s, g) => s + g.artifacts.length, 0)

  return (
    <li className="border border-blue-200 bg-white rounded-lg">
      <div className="flex items-start gap-2 p-2.5">
        <button
          onClick={() => setExpanded((e) => !e)}
          className="mt-0.5 text-gray-400 hover:text-blue-700 shrink-0"
          aria-label={expanded ? 'Collapse' : 'Expand'}
        >
          {expanded ? (
            <ChevronDown className="w-3.5 h-3.5" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5" />
          )}
        </button>
        <div className="flex-1 min-w-0">
          {bullet.sectionPath && (
            <p className="text-[10px] text-gray-400 mb-0.5">{bullet.sectionPath}</p>
          )}
          <p className="text-xs text-gray-800 leading-snug">{bullet.bulletText}</p>
          <p className="text-[10px] text-gray-500 mt-1">
            {bullet.similarity > 0 && (
              <span className="mr-2">{Math.round(bullet.similarity * 100)}% match</span>
            )}
            <span>
              {artifactCount} artifact{artifactCount === 1 ? '' : 's'} · {bullet.gaps.length} gap
              {bullet.gaps.length === 1 ? '' : 's'}
            </span>
          </p>
        </div>
        <button
          onClick={onRemove}
          className="text-gray-400 hover:text-red-600 shrink-0"
          title="Remove from coach evidence"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      {expanded && (
        <div className="px-2.5 pb-2.5 pt-1 space-y-2 border-t border-blue-100">
          {bullet.gaps.length === 0 ? (
            <p className="text-[11px] text-gray-400 italic">No gaps generated for this bullet.</p>
          ) : (
            bullet.gaps.map((gap) => (
              <CoachGapBlock
                key={gap.id}
                gap={gap}
                onChanged={onChanged}
              />
            ))
          )}
        </div>
      )}
    </li>
  )
}

function CoachGapBlock({
  gap,
  onChanged,
}: {
  gap: CoachPreviewBullet['gaps'][number]
  onChanged: () => void
}) {
  const [adding, setAdding] = useState(false)
  return (
    <div>
      <p className="text-[11px] font-medium text-gray-800">{gap.question}</p>
      {gap.artifacts.length === 0 ? (
        <div className="mt-1 flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wide text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">
            unanswered
          </span>
          {!adding && (
            <button
              onClick={() => setAdding(true)}
              className="text-[11px] text-blue-700 hover:text-blue-900 font-medium flex items-center gap-1"
            >
              <Plus className="w-3 h-3" /> Add answer
            </button>
          )}
        </div>
      ) : (
        <div className="mt-1 space-y-1">
          {gap.artifacts.map((a) => (
            <CoachArtifactView
              key={a.id}
              artifact={a}
              onChanged={onChanged}
            />
          ))}
        </div>
      )}
      {adding && (
        <CoachArtifactComposer
          gapId={gap.id}
          onSaved={() => {
            setAdding(false)
            onChanged()
          }}
          onCancel={() => setAdding(false)}
        />
      )}
    </div>
  )
}

function CoachArtifactView({
  artifact,
  onChanged,
}: {
  artifact: CoachPreviewBullet['gaps'][number]['artifacts'][number]
  onChanged: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(artifact.contentText ?? '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const startEdit = () => {
    setText(artifact.contentText ?? '')
    setErr(null)
    setEditing(true)
  }

  const save = async () => {
    if (!text.trim() || text.trim() === artifact.contentText?.trim()) {
      setEditing(false)
      return
    }
    setBusy(true)
    setErr(null)
    try {
      const res = await authedFetch(`/api/cv-library/artifacts/${artifact.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text.trim() }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error || data?.message || 'Failed to update')
      }
      setEditing(false)
      onChanged()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed')
    } finally {
      setBusy(false)
    }
  }

  if (editing) {
    return (
      <div className="border border-emerald-200 bg-emerald-50/40 rounded p-2">
        <p className="text-[10px] uppercase tracking-wide text-emerald-700 font-semibold mb-1">
          Editing {artifact.sourceType}
        </p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          disabled={busy}
          className="w-full p-2 text-xs border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-emerald-300 resize-y min-h-16 bg-white"
        />
        {err && <p className="text-[11px] text-red-600 mt-1">{err}</p>}
        <div className="flex items-center gap-2 mt-1.5">
          <button
            onClick={save}
            disabled={busy || !text.trim()}
            className="px-2.5 py-1 text-[11px] bg-emerald-700 text-white rounded font-medium hover:bg-emerald-600 disabled:opacity-40"
          >
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Save'}
          </button>
          <button
            onClick={() => setEditing(false)}
            disabled={busy}
            className="text-[11px] text-gray-500 hover:text-gray-700"
          >
            Cancel
          </button>
          {busy && (
            <span className="text-[10px] text-gray-500 italic">Re-summarising…</span>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="group rounded border border-gray-200 bg-gray-50/60 p-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[9px] uppercase tracking-wide text-emerald-700 font-semibold">
          ✓ {artifact.sourceType}
        </span>
        <button
          onClick={startEdit}
          className="flex items-center gap-1 text-[10px] text-gray-400 hover:text-emerald-700 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
          title="Edit this answer"
        >
          <Pencil className="w-3 h-3" /> Edit
        </button>
      </div>
      <p className="mt-0.5 text-[11px] text-gray-700 whitespace-pre-wrap leading-snug">
        {artifact.contentText || artifact.sourceUrl || '(no content)'}
      </p>
    </div>
  )
}

function CoachArtifactComposer({
  gapId,
  onSaved,
  onCancel,
}: {
  gapId: string
  onSaved: () => void
  onCancel: () => void
}) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const submit = async () => {
    if (!text.trim() || busy) return
    setBusy(true)
    setErr(null)
    try {
      const res = await authedFetch(`/api/cv-library/gaps/${gapId}/artifacts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text.trim() }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error || data?.message || 'Failed')
      }
      onSaved()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-1 border border-amber-200 bg-amber-50/50 rounded p-2">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Type the evidence (a paragraph, project blurb, etc.)…"
        rows={3}
        disabled={busy}
        className="w-full p-2 text-xs border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-amber-300 resize-y min-h-16 bg-white"
      />
      {err && <p className="text-[11px] text-red-600 mt-1">{err}</p>}
      <div className="flex items-center gap-2 mt-1.5">
        <button
          onClick={submit}
          disabled={busy || !text.trim()}
          className="px-2.5 py-1 text-[11px] bg-amber-700 text-white rounded font-medium hover:bg-amber-600 disabled:opacity-40"
        >
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Save'}
        </button>
        <button
          onClick={onCancel}
          disabled={busy}
          className="text-[11px] text-gray-500 hover:text-gray-700"
        >
          Cancel
        </button>
        {busy && <span className="text-[10px] text-gray-500 italic">Summarising…</span>}
      </div>
    </div>
  )
}

function CoachBulletPicker({
  allBullets,
  excludeIds,
  onPick,
  onClose,
}: {
  allBullets: UserBulletSummaryDto[]
  excludeIds: string[]
  onPick: (bulletId: string) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const exclude = useMemo(() => new Set(excludeIds), [excludeIds])
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return allBullets
      .filter((b) => !exclude.has(b.id))
      .filter((b) =>
        !q ||
        b.bulletText.toLowerCase().includes(q) ||
        (b.sectionPath ?? '').toLowerCase().includes(q),
      )
      .slice(0, 30)
  }, [allBullets, exclude, query])

  return (
    <div className="border border-blue-200 bg-white rounded-lg p-2">
      <div className="flex items-center gap-2 mb-2">
        <Search className="w-3 h-3 text-gray-400" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search your CV bullets…"
          className="flex-1 text-xs p-1 border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-300"
        />
        <button onClick={onClose} className="text-gray-400 hover:text-gray-700" title="Close picker">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      {filtered.length === 0 ? (
        <p className="text-[11px] text-gray-500 italic px-1">
          {allBullets.length === 0
            ? 'No bullets in your CV pool yet.'
            : 'No matches — adjust the search.'}
        </p>
      ) : (
        <ul className="max-h-56 overflow-y-auto space-y-1">
          {filtered.map((b) => (
            <li key={b.id}>
              <button
                onClick={() => onPick(b.id)}
                className="w-full text-left p-1.5 rounded border border-gray-200 hover:border-blue-300 hover:bg-blue-50/40"
              >
                {b.sectionPath && (
                  <p className="text-[10px] text-gray-400">{b.sectionPath}</p>
                )}
                <p className="text-[11px] text-gray-800 line-clamp-2">{b.bulletText}</p>
                <p className="text-[10px] text-gray-500 mt-0.5">
                  {b.answeredGapCount}/{b.gapCount} gaps filled
                </p>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function renderImproved(text: string) {
  // Highlight [CANDIDATE TO FILL: bulletId|question] placeholders
  const parts: Array<string | { ph: string }> = []
  const re = /\[CANDIDATE TO FILL:[^\]]+\]/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    parts.push({ ph: m[0] })
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts.map((p, i) =>
    typeof p === 'string' ? (
      <span key={i}>{p}</span>
    ) : (
      <span
        key={i}
        className="inline-block bg-yellow-200 text-yellow-900 px-1.5 py-0.5 rounded text-xs font-medium mx-0.5"
      >
        {p.ph.replace(/\[CANDIDATE TO FILL:\s*[^|]+\|\s*([^\]]+)\]/, '?? $1')}
      </span>
    ),
  )
}

function JitForm({
  question,
  bulletText,
  onSubmit,
}: {
  question: string
  bulletText: string | null
  onSubmit: (answer: string) => Promise<void>
}) {
  const [val, setVal] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <div className="bg-white border border-yellow-200 rounded-lg p-2">
      <p className="text-xs font-medium text-gray-800 mb-0.5">{question}</p>
      {bulletText && <p className="text-[10px] text-gray-400 mb-1 truncate">re: {bulletText}</p>}
      <div className="flex gap-1.5">
        <input
          value={val}
          onChange={(e) => setVal(e.target.value)}
          placeholder="Type your answer…"
          className="flex-1 text-xs p-1.5 border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-300"
        />
        <button
          onClick={async () => {
            if (!val.trim() || busy) return
            setBusy(true)
            try {
              await onSubmit(val.trim())
              setVal('')
            } finally {
              setBusy(false)
            }
          }}
          disabled={busy || !val.trim()}
          className="px-2 py-1 text-xs bg-blue-900 text-white rounded font-medium disabled:opacity-40"
        >
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Save'}
        </button>
      </div>
    </div>
  )
}

function ReportStep({
  session,
  onNavigateHome,
  onNewInterview,
}: {
  session: NonNullable<ReturnType<typeof useInterview>['session']>
  onNavigateHome: () => void
  onNewInterview: () => void
}) {
  const report = session.finalReport!

  return (
    <div className="max-w-3xl mx-auto">
      <div className="text-center mb-8">
        <h2 className="text-3xl font-serif font-bold text-blue-900 mb-2">Interview Complete</h2>
        <p className="text-gray-600">{report.summary}</p>
        <div className="mt-4 flex items-center justify-center gap-2">
          <span className={`text-5xl font-bold tabular-nums ${irsScoreColor(report.overallIRS.overall)}`}>
            {report.overallIRS.overall.toFixed(1)}
          </span>
          <div className="text-left">
            <span className="text-lg text-gray-400">/10</span>
            <p className={`text-sm font-semibold ${irsScoreColor(report.overallIRS.overall)}`}>
              {irsScoreLabel(report.overallIRS.overall)}
            </p>
          </div>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-6 mb-6">
        <h3 className="text-sm font-semibold text-blue-900 mb-4">IRS Breakdown</h3>
        <IRSMeter score={report.overallIRS} />
      </div>

      <div className="mb-6">
        <h3 className="text-sm font-semibold text-emerald-700 mb-3 flex items-center gap-2">
          <CheckCircle className="w-4 h-4" /> Strengths
        </h3>
        <div className="space-y-3">
          {report.strengths.map((item, i) => (
            <div key={i} className="bg-emerald-50 border border-emerald-100 rounded-xl p-4">
              <h4 className="font-semibold text-emerald-800 text-sm mb-1">{item.title}</h4>
              <p className="text-sm text-emerald-700">{item.detail}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="mb-8">
        <h3 className="text-sm font-semibold text-red-700 mb-3 flex items-center gap-2">
          <AlertCircle className="w-4 h-4" /> Areas for Improvement
        </h3>
        <div className="space-y-3">
          {report.improvements.map((item, i) => (
            <div key={i} className="bg-red-50 border border-red-100 rounded-xl p-4">
              <h4 className="font-semibold text-red-800 text-sm mb-1">{item.title}</h4>
              <p className="text-sm text-red-700">{item.detail}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-center gap-4">
        <button
          onClick={onNavigateHome}
          className="px-5 py-2.5 text-gray-600 hover:text-gray-800 border border-gray-200 rounded-xl transition-colors"
        >
          Back to Home
        </button>
        <button
          onClick={onNewInterview}
          className="flex items-center gap-2 px-6 py-3 bg-yellow-500 text-blue-900 rounded-xl font-semibold hover:bg-yellow-400 transition-colors"
        >
          <RotateCcw className="w-4 h-4" /> New Interview
        </button>
      </div>
    </div>
  )
}

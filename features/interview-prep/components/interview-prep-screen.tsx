'use client'

import { useRef, useEffect, useState } from 'react'
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
} from 'lucide-react'
import type { ViewName } from '@/shared/types/navigation'
import type { PersonaId, InterviewStep } from '@/features/interview-prep/types'
import { PERSONAS } from '@/data/personas'
import { useInterview } from '@/hooks/use-interview'
import { IRSMeter } from '@/components/interview/irs-meter'
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
          onBack={() => interview.setStep('setup')}
          onStart={interview.startSession}
          loading={interview.loading}
        />
      )}

      {interview.step === 'interview' && interview.session && (
        <InterviewStepView
          session={interview.session}
          input={interview.input}
          setInput={interview.setInput}
          loading={interview.loading}
          onSend={interview.sendMessage}
          onEnd={interview.endInterview}
          lastScore={interview.lastScore}
          candidateAnswerCount={interview.candidateAnswerCount}
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

  const [jobUrl, setJobUrl] = useState('')
  const [extracting, setExtracting] = useState(false)
  const [extractError, setExtractError] = useState<string | null>(null)
  const [extractInfo, setExtractInfo] = useState<string | null>(null)

  const handleExtractFromUrl = async () => {
    const url = jobUrl.trim()
    if (!url) return
    setExtracting(true)
    setExtractError(null)
    setExtractInfo(null)
    try {
      const res = await fetch('/api/interview-prep/extract-job-from-url', {
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
      setExtractInfo(
        missing === 0
          ? 'All fields extracted. Review and edit as needed.'
          : `Filled ${filled} of 5 fields. Please complete the remaining ${missing} manually.`,
      )
    } catch (err) {
      setExtractError(err instanceof Error ? err.message : 'Failed to extract job details')
    } finally {
      setExtracting(false)
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
          <label className="block text-sm font-semibold text-blue-900 mb-2">Your CV / Resume *</label>
          <textarea
            value={context.cvText}
            onChange={(e) => updateContext({ cvText: e.target.value })}
            placeholder="Paste your CV content here... Include your experience, skills, education, and achievements."
            className="w-full h-48 p-4 border border-gray-200 rounded-xl text-sm text-gray-700 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400 resize-none"
          />
          <p className="text-xs text-gray-400 mt-1">
            {context.cvText.length > 0
              ? `${context.cvText.length} characters`
              : 'Paste your CV text for personalized questions'}
          </p>
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
  onBack,
  onStart,
  loading,
}: {
  selectedPersona: PersonaId | null
  onSelect: (id: PersonaId) => void
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
          <div className="px-3 py-1.5 bg-blue-900 text-white rounded-lg text-sm font-medium">Text Mode</div>
          <div className="px-3 py-1.5 bg-gray-200 text-gray-400 rounded-lg text-sm font-medium cursor-not-allowed flex items-center gap-1.5">
            <Mic className="w-3.5 h-3.5" /> Voice Mode
            <span className="text-xs">(Coming Soon)</span>
          </div>
        </div>
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
  input,
  setInput,
  loading,
  onSend,
  onEnd,
  lastScore,
  candidateAnswerCount,
}: {
  session: NonNullable<ReturnType<typeof useInterview>['session']>
  input: string
  setInput: (val: string) => void
  loading: boolean
  onSend: () => void
  onEnd: () => void
  lastScore: ReturnType<typeof useInterview>['lastScore']
  candidateAnswerCount: number
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
            <div key={msg.id} className={`flex ${msg.role === 'candidate' ? 'justify-end' : 'justify-start'}`}>
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
              placeholder="Type your answer here... (Ctrl + Enter to send)"
              disabled={loading}
              rows={3}
              className="w-full text-sm text-gray-700 placeholder:text-gray-400 focus:outline-none resize-none disabled:opacity-50"
            />
            <div className="flex items-center justify-between mt-2">
              <span className="text-xs text-gray-400">{input.length} characters</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={onEnd}
                  disabled={candidateAnswerCount < 1 || loading}
                  className="px-4 py-2 text-sm text-gray-500 hover:text-red-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  End Interview
                </button>
                <button
                  onClick={onSend}
                  disabled={!input.trim() || loading}
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

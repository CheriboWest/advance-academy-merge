'use client'

import { useEffect, useRef, useState } from 'react'
import { AlertCircle, ArrowRight, CheckCircle2, Download, FileText, Loader, Target, Upload, X, XCircle } from 'lucide-react'
import type {
  ActionPlan,
  ActionPlanItem,
  AnalyzeCvRequest,
  AnalyzeCvResult,
  AtsExtractedKeyword,
  AtsKeywordCategory,
  BulletEvaluation,
  RewriteSuggestion,
} from '@advance-academy/contracts'
import { type CvOptimizerTab, useCvOptimizer } from '@/features/cv-optimizer/hooks/use-cv-analysis'
import { generateRewrittenCv, parseFileForCvOptimizer, rewriteBullet } from '@/features/cv-optimizer/api/frontend-client'
import { HttpClientError } from '@/shared/api/http-client'

// ─── Constants ────────────────────────────────────────────────────────────────

const INITIAL_FORM: AnalyzeCvRequest = {
  targetRole: '',
  currentCvText: '',
  jobDescription: '',
}

const TABS: { id: CvOptimizerTab; label: string; weight?: string }[] = [
  { id: 'overview', label: 'CV Overview', weight: '25%' },
  { id: 'ats', label: 'ATS Compatibility', weight: '40%' },
  { id: 'bullets', label: 'Bullet Impact', weight: '35%' },
  { id: 'rewrite', label: 'Rewrite Suggestions' },
  { id: 'action-plan', label: 'Action Plan' },
]

const KEYWORD_CATEGORY_LABEL: Record<AtsKeywordCategory, string> = {
  job_title: 'Job Title',
  tool_or_technical_skill: 'Tool/Tech',
  hard_skill: 'Hard Skill',
  industry_term: 'Industry Term',
  certification: 'Certification',
  seniority_indicator: 'Seniority',
  mandatory_requirement: 'Mandatory',
}

const KEYWORD_CATEGORY_COLOR: Record<AtsKeywordCategory, string> = {
  job_title: 'bg-purple-100 text-purple-700 border-purple-200',
  tool_or_technical_skill: 'bg-blue-100 text-blue-700 border-blue-200',
  hard_skill: 'bg-indigo-100 text-indigo-700 border-indigo-200',
  industry_term: 'bg-teal-100 text-teal-700 border-teal-200',
  certification: 'bg-amber-100 text-amber-700 border-amber-200',
  seniority_indicator: 'bg-card text-foreground',
  mandatory_requirement: 'bg-red-100 text-red-700 border-red-200',
}

// ─── Score helpers ────────────────────────────────────────────────────────────

function scoreColor(score: number): string {
  if (score >= 75) return 'text-green-600'
  if (score >= 50) return 'text-amber-500'
  return 'text-red-500'
}

function scoreBg(score: number): string {
  if (score >= 75) return 'bg-green-50 border-green-200'
  if (score >= 50) return 'bg-amber-50 border-amber-200'
  return 'bg-red-50 border-red-200'
}

function scoreBar(score: number): string {
  if (score >= 75) return 'bg-green-500'
  if (score >= 50) return 'bg-amber-400'
  return 'bg-red-400'
}

function scoreLabel(score: number): string {
  if (score >= 75) return 'Strong'
  if (score >= 50) return 'Moderate'
  return 'Weak'
}

function impactColor(score: number): string {
  if (score >= 7) return 'text-green-600'
  if (score >= 4) return 'text-amber-500'
  return 'text-red-500'
}

// ─── Sub-components ───────────────────────────────────────────────────────────

interface FileUploadZoneProps {
  label: string
  fileName: string | null
  parsing: boolean
  onFile: (file: File) => void
  onClear: () => void
}

function FileUploadZone({ label, fileName, parsing, onFile, onClear }: FileUploadZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [isDragOver, setIsDragOver] = useState(false)

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setIsDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) onFile(file)
  }

  return (
    <div>
      <p className="text-sm font-medium text-foreground mb-1">{label}</p>
      {fileName ? (
        <div className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
          <FileText className="w-4 h-4 text-blue-600 flex-shrink-0" />
          <span className="text-sm text-blue-800 truncate flex-1">{fileName}</span>
          {parsing ? (
            <Loader className="w-4 h-4 text-blue-500 animate-spin flex-shrink-0" />
          ) : (
            <button onClick={onClear} className="text-blue-400 hover:text-blue-600">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      ) : (
        <div
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setIsDragOver(true) }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={handleDrop}
          className={`cursor-pointer rounded-lg border-2 border-dashed px-4 py-5 text-center transition-colors ${
            isDragOver ? 'border-yellow-400 bg-yellow-50' : 'border-border hover:border-yellow-400'
          }`}
        >
          <Upload className="w-6 h-6 text-subtle-foreground mx-auto mb-1" />
          <p className="text-sm text-muted-foreground">Drop a file or <span className="text-yellow-600 font-medium">browse</span></p>
          <p className="text-xs text-subtle-foreground mt-0.5">PDF or DOCX</p>
        </div>
      )}
      <input ref={inputRef} type="file" accept=".pdf,.docx" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f) }} />
    </div>
  )
}

function ScoreBar({ score }: { score: number }) {
  return (
    <div className="w-full bg-muted rounded-full h-2 mt-2">
      <div className={`h-2 rounded-full transition-all ${scoreBar(score)}`} style={{ width: `${score}%` }} />
    </div>
  )
}

// ─── Results tabs ─────────────────────────────────────────────────────────────

function CvOverviewTab({ results }: { results: AnalyzeCvResult }) {
  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-blue-200 bg-blue-50 px-5 py-4">
        <p className="text-sm text-blue-900">
          <span className="font-semibold">CV Overview</span> contributes <span className="font-semibold">25%</span> of your overall score. It measures how your CV reads across four core dimensions — skills, experience, role alignment, and writing impact.
        </p>
      </div>
      {results.sections.map((section, idx) => (
        <div key={`${section.title}-${idx}`} className={`rounded-xl border p-6 ${scoreBg(section.score)}`}>
          <div className="flex items-center justify-between mb-1">
            <h4 className="font-semibold text-blue-900">{section.title}</h4>
            <div className="flex items-center gap-2">
              <span className={`text-xs font-medium ${scoreColor(section.score)}`}>{scoreLabel(section.score)}</span>
              <span className={`text-2xl font-bold ${scoreColor(section.score)}`}>{section.score}</span>
            </div>
          </div>
          <ScoreBar score={section.score} />
          <p className="text-foreground text-sm mt-3">{section.feedback}</p>
        </div>
      ))}
    </div>
  )
}

function AtsKeywordChip({ kw }: { kw: AtsExtractedKeyword }) {
  const baseColor = kw.foundInCv
    ? 'bg-green-100 text-green-700 border-green-200'
    : KEYWORD_CATEGORY_COLOR[kw.category]
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${baseColor}`}>
      {kw.foundInCv ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
      {kw.keyword}
      <span className="opacity-60 text-[10px]">{KEYWORD_CATEGORY_LABEL[kw.category]}</span>
      {kw.mandatory && <span className="text-[10px] font-bold text-red-600">★</span>}
    </span>
  )
}

function AtsIntelligenceTab({ results }: { results: AnalyzeCvResult }) {
  const keywords = results.atsCheck.extractedKeywords
  const mandatoryMissing = keywords.filter((k) => k.mandatory && !k.foundInCv)
  const foundCount = keywords.filter((k) => k.foundInCv).length
  const totalCount = keywords.length

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-blue-200 bg-blue-50 px-5 py-4">
        <p className="text-sm text-blue-900">
          <span className="font-semibold">ATS Compatibility</span> is <span className="font-semibold">40%</span> of your overall score — the single largest dimension. It measures how well your CV would perform against an applicant tracking system that screens for specific requirements, technologies, and qualifications extracted from the job description.
        </p>
      </div>

      <div className={`rounded-xl border p-6 ${scoreBg(results.atsCheck.score)}`}>
        <div className="flex items-center justify-between mb-1">
          <div>
            <h4 className="font-semibold text-blue-900">ATS Compatibility Score</h4>
            <p className="text-xs text-muted-foreground mt-0.5">Recruitment-grade scoring across mandatory requirements, keyword coverage, and relevance signals</p>
          </div>
          <span className={`text-3xl font-bold ${scoreColor(results.atsCheck.score)}`}>
            {results.atsCheck.score}
          </span>
        </div>
        <ScoreBar score={results.atsCheck.score} />
      </div>

      {mandatoryMissing.length > 0 && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-4">
          <p className="text-xs font-semibold text-red-700 mb-2 uppercase tracking-wide">Missing Mandatory Requirements</p>
          <div className="flex flex-wrap gap-2">
            {mandatoryMissing.map((k, idx) => (
              <AtsKeywordChip key={`mand-${idx}`} kw={k} />
            ))}
          </div>
          <p className="mt-2 text-xs text-red-600">Mandatory items are binary — missing any one of these is an immediate disqualifier for most ATS filters.</p>
        </div>
      )}

      {keywords.length > 0 && (
        <div>
          <h4 className="font-semibold text-blue-900 mb-2">Extracted Keywords</h4>
          <p className="text-xs text-muted-foreground mb-3">
            Every requirement, tool, and qualification the employer is screening for — mapped against your CV. {foundCount}/{totalCount} found.
          </p>
          <div className="flex flex-wrap gap-2">
            {keywords.map((kw, idx) => <AtsKeywordChip key={idx} kw={kw} />)}
          </div>
        </div>
      )}

      {results.atsCheck.relevanceSignals.length > 0 && (
        <div>
          <h4 className="font-semibold text-blue-900 mb-3">Relevance Signals</h4>
          <div className="space-y-2">
            {results.atsCheck.relevanceSignals.map((s, idx) => (
              <div key={idx} className={`rounded-lg border p-4 ${s.score >= 7 ? 'bg-green-50 border-green-200' : s.score >= 5 ? 'bg-amber-50 border-amber-200' : 'bg-red-50 border-red-200'}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-semibold text-blue-900">
                    {s.signal.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                  </span>
                  <span className={`text-lg font-bold ${impactColor(s.score)}`}>{s.score}<span className="text-xs text-subtle-foreground">/10</span></span>
                </div>
                <p className="text-xs text-foreground">{s.reasoning}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid sm:grid-cols-2 gap-4">
        {results.atsCheck.passed.length > 0 && (
          <div className="rounded-lg bg-green-50 border border-green-200 p-4">
            <p className="text-xs font-semibold text-green-700 mb-2 uppercase tracking-wide">Passed</p>
            <ul className="space-y-1.5">
              {results.atsCheck.passed.map((item, idx) => (
                <li key={idx} className="flex items-start gap-2 text-sm text-green-800">
                  <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" /> {item}
                </li>
              ))}
            </ul>
          </div>
        )}
        {results.atsCheck.issues.length > 0 && (
          <div className="rounded-lg bg-red-50 border border-red-200 p-4">
            <p className="text-xs font-semibold text-red-700 mb-2 uppercase tracking-wide">Issues</p>
            <ul className="space-y-1.5">
              {results.atsCheck.issues.map((item, idx) => (
                <li key={idx} className="flex items-start gap-2 text-sm text-red-800">
                  <XCircle className="w-4 h-4 flex-shrink-0 mt-0.5" /> {item}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {(results.jdAlignment.matchedRequirements.length > 0 || results.jdAlignment.missingRequirements.length > 0) && (
        <div>
          <h4 className="font-semibold text-blue-900 mb-3">JD Requirement Alignment</h4>
          {results.jdAlignment.alignmentSummary && (
            <p className="text-sm text-foreground mb-4 leading-relaxed">{results.jdAlignment.alignmentSummary}</p>
          )}
          <div className="grid sm:grid-cols-2 gap-4">
            {results.jdAlignment.matchedRequirements.length > 0 && (
              <div className="rounded-lg bg-green-50 border border-green-200 p-4">
                <p className="text-xs font-semibold text-green-700 mb-2 uppercase tracking-wide">Evidenced in CV</p>
                <ul className="space-y-1">
                  {results.jdAlignment.matchedRequirements.map((req, idx) => (
                    <li key={idx} className="flex items-start gap-2 text-sm text-green-800">
                      <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" /> {req}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {results.jdAlignment.missingRequirements.length > 0 && (
              <div className="rounded-lg bg-red-50 border border-red-200 p-4">
                <p className="text-xs font-semibold text-red-700 mb-2 uppercase tracking-wide">Not Evidenced</p>
                <ul className="space-y-1">
                  {results.jdAlignment.missingRequirements.map((req, idx) => (
                    <li key={idx} className="flex items-start gap-2 text-sm text-red-800">
                      <XCircle className="w-4 h-4 flex-shrink-0 mt-0.5" /> {req}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

      {(results.formatCheck.issues.length > 0 || results.formatCheck.suggestions.length > 0) && (
        <div>
          <h4 className="font-semibold text-blue-900 mb-3">Format & Consistency Check</h4>
          <div className="space-y-2">
            {results.formatCheck.issues.map((issue, idx) => (
              <div key={idx} className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5 text-amber-500" /> {issue}
              </div>
            ))}
            {results.formatCheck.suggestions.map((s, idx) => (
              <div key={idx} className="flex items-start gap-2 rounded-lg bg-blue-50 border border-blue-200 px-4 py-3 text-sm text-blue-800">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5 text-blue-400" /> {s}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function bulletBorder(score: number): string {
  if (score >= 7) return 'border-green-200 bg-green-50'
  if (score >= 5) return 'border-amber-200 bg-amber-50'
  return 'border-red-200 bg-red-50'
}

interface BulletRewriteState {
  answers: string[]
  rewriting: boolean
  rewritten: string | null
  error: string | null
  personalizeOpen: boolean
}

function BulletCard({ bullet, bulletKey, targetRole, state, onAnswersChange, onRewrite, onCopySuggested, onCopyPersonalized, onTogglePersonalize, copiedSuggested, copiedPersonalized }: {
  bullet: BulletEvaluation
  bulletKey: string
  targetRole: string
  state: BulletRewriteState
  onAnswersChange: (answers: string[]) => void
  onRewrite: () => void
  onCopySuggested: () => void
  onCopyPersonalized: () => void
  onTogglePersonalize: () => void
  copiedSuggested: boolean
  copiedPersonalized: boolean
}) {
  const hasAutoRewrite = bullet.autoRewrite.trim().length > 0
  const hasQuestions = bullet.clarifyingQuestions.length > 0
  const isWeak = hasAutoRewrite || hasQuestions

  return (
    <div className={`rounded-xl border p-5 ${bulletBorder(bullet.impactScore)}`}>
      <div className="flex items-start justify-between gap-4 mb-2">
        <p className="text-sm text-foreground italic flex-1">&ldquo;{bullet.original}&rdquo;</p>
        <div className="flex-shrink-0 text-right">
          <span className={`text-xl font-bold ${impactColor(bullet.impactScore)}`}>{bullet.impactScore}</span>
          <span className="text-xs text-subtle-foreground">/10</span>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{bullet.feedback}</p>
      {!bullet.hasImpact && (
        <span className="inline-block mt-2 rounded-full bg-red-100 text-red-600 text-xs px-2 py-0.5 font-medium">No measurable impact</span>
      )}

      {isWeak && (
        <div className="mt-4 space-y-3">
          {/* OPTION 1 — Suggested rewrite (already prepared, no input needed) */}
          {hasAutoRewrite && (
            <div className="rounded-lg border border-green-200 bg-green-50 p-4">
              <div className="flex items-start justify-between gap-2 mb-2">
                <div>
                  <p className="text-xs font-semibold text-green-700 uppercase tracking-wide">Option 1 — Suggested Rewrite</p>
                  <p className="text-[11px] text-green-600/80">Tightened using only what&apos;s already in your CV — no invented numbers.</p>
                </div>
                <button
                  onClick={onCopySuggested}
                  className="text-xs text-green-700 hover:text-green-900 font-medium flex-shrink-0"
                >
                  {copiedSuggested ? 'Copied!' : 'Copy'}
                </button>
              </div>
              <p className="text-sm text-foreground leading-relaxed">{bullet.autoRewrite}</p>
            </div>
          )}

          {/* OPTION 2 — Personalize with your answers */}
          {hasQuestions && (
            <div className="rounded-lg border border-blue-200 bg-background p-4">
              <button
                onClick={onTogglePersonalize}
                className="w-full flex items-center justify-between text-left"
              >
                <div>
                  <p className="text-xs font-semibold text-blue-900 uppercase tracking-wide">Option 2 — Personalize It</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">Answer a few quick questions and we&apos;ll rewrite using your real impact details.</p>
                </div>
                <span className="text-xs font-medium text-blue-600 flex-shrink-0">
                  {state.personalizeOpen ? 'Hide' : 'Answer questions'}
                </span>
              </button>

              {state.personalizeOpen && (
                <div className="mt-4 space-y-3 border-t border-border pt-4">
                  {bullet.clarifyingQuestions.map((q, qIdx) => (
                    <div key={`${bulletKey}-q-${qIdx}`}>
                      <label className="block text-xs font-medium text-foreground mb-1">{q}</label>
                      <input
                        type="text"
                        value={state.answers[qIdx] ?? ''}
                        onChange={(e) => {
                          const next = [...state.answers]
                          next[qIdx] = e.target.value
                          onAnswersChange(next)
                        }}
                        placeholder="Your answer..."
                        className="w-full rounded-md border px-3 py-2 text-sm focus:border-yellow-400 focus:outline-none"
                      />
                    </div>
                  ))}
                  <div className="flex items-center gap-3 pt-1">
                    <button
                      onClick={onRewrite}
                      disabled={state.rewriting || !targetRole}
                      className="inline-flex items-center gap-2 rounded-lg bg-yellow-500 px-4 py-2 text-sm font-semibold text-blue-900 hover:bg-yellow-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {state.rewriting ? <Loader className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
                      {state.rewriting ? 'Rewriting...' : 'Generate personalized rewrite'}
                    </button>
                    {state.error && <span className="text-xs text-red-600">{state.error}</span>}
                  </div>

                  {state.rewritten && (
                    <div className="mt-3 rounded-lg border border-green-300 bg-green-50 p-4">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <p className="text-xs font-semibold text-green-700 uppercase tracking-wide">Personalized Rewrite</p>
                        <button
                          onClick={onCopyPersonalized}
                          className="text-xs text-green-700 hover:text-green-900 font-medium"
                        >
                          {copiedPersonalized ? 'Copied!' : 'Copy'}
                        </button>
                      </div>
                      <p className="text-sm text-foreground leading-relaxed">{state.rewritten}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function BulletsTab({ results, targetRole }: { results: AnalyzeCvResult; targetRole: string }) {
  const [rewriteStates, setRewriteStates] = useState<Record<string, BulletRewriteState>>({})
  const [copiedSuggestedKey, setCopiedSuggestedKey] = useState<string | null>(null)
  const [copiedPersonalizedKey, setCopiedPersonalizedKey] = useState<string | null>(null)

  if (results.bulletEvaluations.length === 0) {
    return <p className="text-muted-foreground text-sm">No bullet evaluations returned. Ensure the CV contains structured experience bullets.</p>
  }

  // Group by project, preserving original order within each project
  const groups = new Map<string, { bullets: BulletEvaluation[]; originalIndices: number[] }>()
  results.bulletEvaluations.forEach((b, idx) => {
    const key = b.project || 'Other'
    if (!groups.has(key)) groups.set(key, { bullets: [], originalIndices: [] })
    const g = groups.get(key)!
    g.bullets.push(b)
    g.originalIndices.push(idx)
  })

  // Within each group, sort weakest → strongest so the bullets that need help surface first
  for (const g of groups.values()) {
    const paired = g.bullets.map((b, i) => ({ b, i: g.originalIndices[i] }))
    paired.sort((a, b) => a.b.impactScore - b.b.impactScore)
    g.bullets = paired.map((p) => p.b)
    g.originalIndices = paired.map((p) => p.i)
  }

  const getState = (key: string, questionCount: number): BulletRewriteState =>
    rewriteStates[key] ?? {
      answers: Array(questionCount).fill(''),
      rewriting: false,
      rewritten: null,
      error: null,
      personalizeOpen: false,
    }

  function updateState(key: string, patch: Partial<BulletRewriteState>) {
    setRewriteStates((prev) => ({ ...prev, [key]: { ...getState(key, 0), ...prev[key], ...patch } }))
  }

  async function handleRewrite(key: string, bullet: BulletEvaluation) {
    const current = getState(key, bullet.clarifyingQuestions.length)
    updateState(key, { rewriting: true, error: null, rewritten: null })
    try {
      const { rewritten } = await rewriteBullet({
        original: bullet.original,
        project: bullet.project,
        feedback: bullet.feedback,
        clarifyingQuestions: bullet.clarifyingQuestions,
        answers: current.answers,
        targetRole,
      })
      updateState(key, { rewriting: false, rewritten })
    } catch (err) {
      const message = err instanceof HttpClientError
        ? err.payload.message
        : err instanceof Error
          ? err.message
          : 'Failed to rewrite bullet.'
      updateState(key, { rewriting: false, error: message })
    }
  }

  async function handleCopySuggested(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedSuggestedKey(key)
      window.setTimeout(() => setCopiedSuggestedKey((k) => (k === key ? null : k)), 2000)
    } catch {
      // ignore clipboard failures
    }
  }

  async function handleCopyPersonalized(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedPersonalizedKey(key)
      window.setTimeout(() => setCopiedPersonalizedKey((k) => (k === key ? null : k)), 2000)
    } catch {
      // ignore clipboard failures
    }
  }

  const weakCount = results.bulletEvaluations.filter((b) => b.impactScore <= 6).length

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-blue-200 bg-blue-50 px-5 py-4">
        <p className="text-sm text-blue-900">
          <span className="font-semibold">Bullet Impact</span> is <span className="font-semibold">35%</span> of your overall score. Bullets are grouped by project and sorted weakest first.
          {weakCount > 0 && <> {weakCount} bullet{weakCount === 1 ? '' : 's'} need{weakCount === 1 ? 's' : ''} strengthening — answer the clarifying questions below and we&apos;ll rewrite them using your real details.</>}
        </p>
      </div>

      {Array.from(groups.entries()).map(([project, group]) => (
        <div key={project} className="space-y-3">
          <h4 className="font-semibold text-blue-900 text-base border-b pb-2">{project}</h4>
          {group.bullets.map((bullet, localIdx) => {
            const key = `${project}::${group.originalIndices[localIdx]}`
            const state = getState(key, bullet.clarifyingQuestions.length)
            return (
              <BulletCard
                key={key}
                bullet={bullet}
                bulletKey={key}
                targetRole={targetRole}
                state={state}
                onAnswersChange={(answers) => updateState(key, { answers })}
                onRewrite={() => handleRewrite(key, bullet)}
                onCopySuggested={() => handleCopySuggested(key, bullet.autoRewrite)}
                onCopyPersonalized={() => state.rewritten && handleCopyPersonalized(key, state.rewritten)}
                onTogglePersonalize={() => updateState(key, { personalizeOpen: !state.personalizeOpen })}
                copiedSuggested={copiedSuggestedKey === key}
                copiedPersonalized={copiedPersonalizedKey === key}
              />
            )
          })}
        </div>
      ))}
    </div>
  )
}

interface RewriteTabProps {
  results: AnalyzeCvResult
  cvFile: File | null
  onDownload: () => void
  downloading: boolean
  downloadError: string | null
  downloadNotice: string | null
}

function RewriteTab({ results, cvFile, onDownload, downloading, downloadError, downloadNotice }: RewriteTabProps) {
  if (results.rewriteSuggestions.length === 0) {
    return <p className="text-muted-foreground text-sm">No rewrite suggestions returned.</p>
  }

  const isDocx = cvFile ? cvFile.name.toLowerCase().endsWith('.docx') : false

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-xl border border-blue-200 bg-blue-50 px-5 py-4">
        <div>
          <p className="text-sm font-semibold text-blue-900">Download your improved CV</p>
          <p className="text-xs text-blue-700 mt-0.5">
            {cvFile
              ? isDocx
                ? `We'll apply these rewrites to ${cvFile.name}, preserving its original formatting.`
                : 'PDF in-place editing isn\'t supported. Re-upload your CV as a .docx file to download an improved version.'
              : 'Re-upload your CV as a file to enable download (text-only inputs can\'t be rewritten in place).'}
          </p>
        </div>
        <button
          onClick={onDownload}
          disabled={!cvFile || !isDocx || downloading}
          className="flex-shrink-0 inline-flex items-center justify-center gap-2 px-4 py-2 bg-yellow-500 text-blue-900 rounded-lg font-semibold hover:bg-yellow-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {downloading ? <Loader className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
          {downloading ? 'Generating...' : 'Download Rewritten CV'}
        </button>
      </div>
      {downloadError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{downloadError}</div>
      )}
      {downloadNotice && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">{downloadNotice}</div>
      )}
      {results.rewriteSuggestions.map((suggestion: RewriteSuggestion, idx: number) => (
        <div key={idx} className="rounded-xl border overflow-hidden">
          <div className="bg-card px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            {suggestion.section}
          </div>
          <div className="grid sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-border">
            <div className="p-5 bg-red-50">
              <p className="text-xs font-semibold text-red-600 mb-2 uppercase tracking-wide">Current</p>
              <p className="text-sm text-foreground leading-relaxed">{suggestion.current}</p>
            </div>
            <div className="p-5 bg-green-50 relative">
              <div className="absolute left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 hidden sm:flex w-7 h-7 bg-background border rounded-full items-center justify-center shadow-sm">
                <ArrowRight className="w-3 h-3 text-subtle-foreground" />
              </div>
              <p className="text-xs font-semibold text-green-600 mb-2 uppercase tracking-wide">Suggested</p>
              <p className="text-sm text-foreground leading-relaxed">{suggestion.suggested}</p>
            </div>
          </div>
          <div className="px-4 py-2 bg-card border-t">
            <p className="text-xs text-muted-foreground"><span className="font-medium text-foreground">Why: </span>{suggestion.reason}</p>
          </div>
        </div>
      ))}
    </div>
  )
}

function ActionPlanSection({ title, icon, items, emptyMessage }: {
  title: string
  icon: React.ReactNode
  items: ActionPlanItem[]
  emptyMessage?: string
}) {
  if (items.length === 0) {
    if (!emptyMessage) return null
    return (
      <div>
        <h4 className="font-semibold text-blue-900 mb-2 flex items-center gap-2">{icon}{title}</h4>
        <p className="text-sm text-muted-foreground italic">{emptyMessage}</p>
      </div>
    )
  }
  return (
    <div>
      <h4 className="font-semibold text-blue-900 mb-3 flex items-center gap-2">{icon}{title}</h4>
      <div className="space-y-2">
        {items.map((item, idx) => (
          <div key={idx} className="rounded-lg border bg-background px-4 py-3">
            <p className="text-sm font-semibold text-blue-900">{item.title}</p>
            {item.description && <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{item.description}</p>}
          </div>
        ))}
      </div>
    </div>
  )
}

const ANALYZING_STEPS = [
  'Parsing your CV...',
  'Extracting job requirements...',
  'Running ATS & keyword analysis...',
  'Scoring every experience bullet...',
  'Generating rewrite suggestions...',
  'Building your action plan...',
]

function AnalyzingPanel({ status }: { status: 'submitting' | 'running' }) {
  const [stepIndex, setStepIndex] = useState(0)

  // Rotate through the steps every 3s so the user sees movement while the
  // async job is running in the background.
  useRefInterval(() => {
    setStepIndex((i) => (i + 1) % ANALYZING_STEPS.length)
  }, 3000)

  return (
    <div className="bg-blue-900 rounded-2xl p-12 text-center text-white">
      <div className="flex justify-center mb-6">
        <div className="relative">
          <div className="w-20 h-20 rounded-full border-4 border-blue-800 border-t-yellow-400 animate-spin" />
          <Target className="w-8 h-8 text-yellow-400 absolute inset-0 m-auto" />
        </div>
      </div>
      <h2 className="text-2xl font-serif font-semibold mb-2">
        {status === 'submitting' ? 'Sending your CV...' : 'Analyzing your CV'}
      </h2>
      <p className="text-blue-200 text-base mb-6 max-w-md mx-auto">
        Our AI is running a full recruitment-grade analysis. This usually takes 20–40 seconds — hang tight.
      </p>
      <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-blue-800 text-sm text-blue-100">
        <Loader className="w-4 h-4 animate-spin text-yellow-400" />
        <span className="transition-opacity duration-300">{ANALYZING_STEPS[stepIndex]}</span>
      </div>
      <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs text-blue-200 max-w-xl mx-auto">
        <div className="rounded-lg bg-blue-800/50 px-3 py-2"><strong className="text-yellow-400">CV Overview</strong><br />Section-by-section scoring</div>
        <div className="rounded-lg bg-blue-800/50 px-3 py-2"><strong className="text-yellow-400">ATS Intelligence</strong><br />Keyword & requirement match</div>
        <div className="rounded-lg bg-blue-800/50 px-3 py-2"><strong className="text-yellow-400">Action Plan</strong><br />What to do next</div>
      </div>
    </div>
  )
}

// Lightweight setInterval wrapper that cleans itself up on unmount.
function useRefInterval(callback: () => void, delay: number) {
  const savedCallback = useRef(callback)
  savedCallback.current = callback
  useEffect(() => {
    const id = window.setInterval(() => savedCallback.current(), delay)
    return () => window.clearInterval(id)
  }, [delay])
}

function ActionPlanTab({ plan }: { plan: ActionPlan }) {
  const hasAnything =
    plan.summary.trim().length > 0 ||
    plan.projectsToBuild.length > 0 ||
    plan.skillsToLearn.length > 0 ||
    plan.certifications.length > 0 ||
    plan.intermediateRoles.length > 0

  if (!hasAnything) {
    return <p className="text-muted-foreground text-sm">No action plan returned.</p>
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-blue-200 bg-blue-50 px-5 py-4">
        <p className="text-sm text-blue-900">
          Concrete next steps tailored to your gaps — specific projects to build, skills to acquire, certifications to pursue, and roles to target in the interim.
        </p>
      </div>
      {plan.summary && (
        <div className="bg-blue-900 rounded-xl p-6 text-white">
          <p className="text-xs font-semibold text-yellow-400 mb-2 uppercase tracking-wide flex items-center gap-2">
            <Target className="w-4 h-4" /> Strategic Summary
          </p>
          <p className="text-blue-100 text-base leading-relaxed">{plan.summary}</p>
        </div>
      )}
      <ActionPlanSection
        title="Projects to Build"
        icon={<span className="text-yellow-500 font-bold">1.</span>}
        items={plan.projectsToBuild}
        emptyMessage="No portfolio gaps identified."
      />
      <ActionPlanSection
        title="Skills to Learn"
        icon={<span className="text-yellow-500 font-bold">2.</span>}
        items={plan.skillsToLearn}
      />
      <ActionPlanSection
        title="Certifications"
        icon={<span className="text-yellow-500 font-bold">3.</span>}
        items={plan.certifications}
        emptyMessage="No certifications are strictly required for this role."
      />
      <ActionPlanSection
        title="Intermediate Roles to Target"
        icon={<span className="text-yellow-500 font-bold">4.</span>}
        items={plan.intermediateRoles}
        emptyMessage="No seniority gap detected — you can apply directly to the target role."
      />
    </div>
  )
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export function CvOptimizerScreen() {
  const [form, setForm] = useState<AnalyzeCvRequest>(INITIAL_FORM)
  const [cvFile, setCvFile] = useState<File | null>(null)
  const [cvFileName, setCvFileName] = useState<string | null>(null)
  const [jdFileName, setJdFileName] = useState<string | null>(null)
  const [cvParsing, setCvParsing] = useState(false)
  const [jdParsing, setJdParsing] = useState(false)
  const [parseError, setParseError] = useState<string | null>(null)
  const [validationErrors, setValidationErrors] = useState<string[]>([])
  const [downloadingRewrite, setDownloadingRewrite] = useState(false)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const [downloadNotice, setDownloadNotice] = useState<string | null>(null)

  function validateForm(values: AnalyzeCvRequest): string[] {
    const errors: string[] = []
    if (!values.targetRole.trim()) {
      errors.push('Please enter a target role so we know what to compare your CV against.')
    }
    if (values.currentCvText.trim().length < 30) {
      errors.push('Please upload your CV or paste at least a few sentences of CV content.')
    }
    return errors
  }

  function handleSubmit() {
    const errors = validateForm(form)
    if (errors.length > 0) {
      setValidationErrors(errors)
      return
    }
    setValidationErrors([])
    submit(form)
  }

  function friendlyServerError(message: string | undefined): string[] {
    if (!message) return []
    // Legacy Zod issues may leak through as a JSON array string — parse them.
    const trimmed = message.trim()
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        const parsed = JSON.parse(trimmed) as Array<{ message?: string }>
        const messages = parsed.map((i) => i?.message).filter((m): m is string => Boolean(m))
        if (messages.length > 0) return messages
      } catch {
        // fall through to raw display
      }
    }
    return [message]
  }

  const { tab, setTab, state, submit, reset } = useCvOptimizer()
  const isBusy = state.status === 'submitting' || state.status === 'running'
  const results = state.data

  function updateField<K extends keyof AnalyzeCvRequest>(key: K, value: AnalyzeCvRequest[K]) {
    setForm((current) => ({ ...current, [key]: value }))
    if (validationErrors.length > 0) setValidationErrors([])
  }

  async function handleCvFile(file: File) {
    setCvFile(file); setCvFileName(file.name); setCvParsing(true); setParseError(null)
    try {
      const { text } = await parseFileForCvOptimizer(file)
      updateField('currentCvText', text)
    } catch (error) {
      console.error('CV file parse failed', error)
      const status = (error as { status?: number })?.status
      const detail = (error as { payload?: { message?: string } })?.payload?.message
      const suffix = status ? ` (${status}${detail ? `: ${detail}` : ''})` : ''
      setParseError(`Failed to extract text from CV file${suffix}. Try pasting it manually.`)
      setCvFile(null)
      setCvFileName(null)
    } finally { setCvParsing(false) }
  }

  async function handleDownloadRewrittenCv() {
    if (!cvFile || !results) return
    setDownloadingRewrite(true)
    setDownloadError(null)
    setDownloadNotice(null)
    try {
      const { blob, filename, appliedCount, totalCount } = await generateRewrittenCv(
        cvFile,
        results.rewriteSuggestions,
      )
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      if (totalCount > 0 && appliedCount < totalCount) {
        setDownloadNotice(
          `Downloaded ${filename}. Applied ${appliedCount} of ${totalCount} rewrites — the rest couldn't be matched against the original document text.`,
        )
      } else {
        setDownloadNotice(`Downloaded ${filename} with ${appliedCount} rewrite${appliedCount === 1 ? '' : 's'} applied.`)
      }
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : 'Failed to generate rewritten CV.')
    } finally {
      setDownloadingRewrite(false)
    }
  }

  async function handleJdFile(file: File) {
    setJdFileName(file.name); setJdParsing(true); setParseError(null)
    try {
      const { text } = await parseFileForCvOptimizer(file)
      updateField('jobDescription', text)
    } catch (error) {
      console.error('JD file parse failed', error)
      const status = (error as { status?: number })?.status
      const detail = (error as { payload?: { message?: string } })?.payload?.message
      const suffix = status ? ` (${status}${detail ? `: ${detail}` : ''})` : ''
      setParseError(`Failed to extract text from JD file${suffix}. Try pasting it manually.`)
      setJdFileName(null)
    } finally { setJdParsing(false) }
  }

  function handleReset() {
    reset(); setForm(INITIAL_FORM); setCvFile(null); setCvFileName(null); setJdFileName(null); setParseError(null)
    setValidationErrors([])
    setDownloadError(null); setDownloadNotice(null)
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <h1 className="text-4xl font-serif font-bold text-blue-900 mb-2">CV Optimizer</h1>
      <p className="text-muted-foreground mb-8">Upload your CV and a job description — our AI runs a full recruitment-grade analysis in seconds.</p>

      {isBusy && !results ? (
        <AnalyzingPanel status={state.status === 'submitting' ? 'submitting' : 'running'} />
      ) : !results ? (
        <div className="grid md:grid-cols-2 gap-8">
          {/* Left — inputs */}
          <div className="bg-card rounded-xl p-8 space-y-5">
            <input
              value={form.targetRole}
              onChange={(e) => updateField('targetRole', e.target.value)}
              placeholder="Target role (e.g. Frontend Developer)"
              className="w-full rounded-lg border px-4 py-3 bg-background"
            />
            <div className="space-y-2">
              <FileUploadZone label="CV" fileName={cvFileName} parsing={cvParsing} onFile={handleCvFile}
                onClear={() => { setCvFile(null); setCvFileName(null); updateField('currentCvText', '') }} />
              <textarea value={form.currentCvText} onChange={(e) => updateField('currentCvText', e.target.value)}
                placeholder="Or paste your CV text here..." className="min-h-36 w-full rounded-lg border px-4 py-3 bg-background text-sm" />
            </div>
            <div className="space-y-2">
              <FileUploadZone label="Job Description" fileName={jdFileName} parsing={jdParsing} onFile={handleJdFile}
                onClear={() => { setJdFileName(null); updateField('jobDescription', '') }} />
              <textarea value={form.jobDescription} onChange={(e) => updateField('jobDescription', e.target.value)}
                placeholder="Or paste the job description here..." className="min-h-28 w-full rounded-lg border px-4 py-3 bg-background text-sm" />
            </div>

            {(() => {
              const messages: string[] = []
              if (parseError) messages.push(parseError)
              if (validationErrors.length > 0) messages.push(...validationErrors)
              else if (state.error?.message) {
                const details = state.error as { details?: { fieldErrors?: { message: string }[] } }
                const fieldErrors = details.details?.fieldErrors?.map((f) => f.message) ?? []
                if (fieldErrors.length > 0) messages.push(...fieldErrors)
                else messages.push(...friendlyServerError(state.error.message))
              }
              if (messages.length === 0) return null
              return (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {messages.length === 1 ? (
                    <p>{messages[0]}</p>
                  ) : (
                    <ul className="space-y-1 list-disc list-inside">
                      {messages.map((m, idx) => <li key={idx}>{m}</li>)}
                    </ul>
                  )}
                </div>
              )
            })()}

            <button onClick={handleSubmit} disabled={isBusy || cvParsing || jdParsing}
              className="w-full mt-2 px-6 py-3 bg-yellow-500 text-blue-900 rounded-lg font-semibold hover:bg-yellow-400 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
              {isBusy ? (
                <><Loader className="w-4 h-4 animate-spin" />{state.status === 'submitting' ? 'Submitting...' : 'Analyzing...'}</>
              ) : 'Analyze My CV'}
            </button>

          </div>

          {/* Right — description + tips */}
          <div className="space-y-6">
            <div className="bg-blue-900 rounded-xl p-8 text-white">
              <h3 className="text-xl font-serif font-semibold mb-3">What this tool does</h3>
              <p className="text-blue-100 leading-relaxed mb-4">
                Upload your CV and a job description — our AI runs a full recruitment-grade analysis in seconds.
              </p>
              <ul className="space-y-3 text-blue-200 text-sm">
                {[
                  ['CV Overview', 'Your overall match score and a breakdown of how your CV performs across every dimension. See exactly where you stand before you apply.', '25% of total score'],
                  ['ATS Compatibility', 'Every requirement, technology, and qualification the employer is screening for — mapped against your CV line by line. Know exactly what an Applicant Tracking System sees before a human ever does.', '40% of total score'],
                  ['Bullet Impact', 'Every experience bullet analysed for real-world impact. Are you showing outcomes or just listing duties?', '35% of total score'],
                  ['Rewrite Suggestions', 'Side-by-side view of weak content and a stronger AI-generated version, driven directly by the gaps found in your analysis.', 'unscored'],
                  ['Action Plan', 'Concrete next steps tailored to your gaps. Specific projects to build, skills to acquire, certifications to pursue, and experiences to target — so you know exactly what to do before your next application.', 'unscored'],
                ].map(([title, desc, weight], i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-yellow-400 font-bold mt-0.5">{i + 1}.</span>
                    <div className="flex-1">
                      <strong className="text-white">{title}</strong> — {desc}
                      <div className="text-[10px] uppercase tracking-wide text-yellow-400 mt-0.5">{weight}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
            <div className="bg-blue-50 rounded-xl p-6">
              <h3 className="text-lg font-semibold text-blue-900 mb-3">Optimization Tips</h3>
              <ul className="space-y-2 text-sm text-foreground">
                {[
                  'Upload both a CV and JD for the most accurate keyword and alignment analysis.',
                  'Quantify every bullet — numbers and percentages score significantly higher.',
                  'Mirror exact keywords from the job description to pass ATS filters.',
                  'Start each bullet with a strong action verb (built, led, reduced, delivered).',
                ].map((tip, i) => (
                  <li key={i} className="flex gap-2">
                    <AlertCircle className="w-4 h-4 text-yellow-500 flex-shrink-0 mt-0.5" />
                    <span>{tip}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      ) : (
        <div>
          <div className="mb-6">
            <button onClick={handleReset} className="px-4 py-2 text-yellow-600 font-medium hover:bg-yellow-50 rounded-lg">
              &larr; Analyze Another CV
            </button>
          </div>

          {/* Score header: overall + 25/40/35 breakdown */}
          <div className="grid sm:grid-cols-4 gap-4 mb-8">
            <div className={`rounded-xl border p-6 ${scoreBg(results.overallScore)}`}>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Overall Score</p>
              <p className={`text-4xl font-bold ${scoreColor(results.overallScore)}`}>{results.overallScore}<span className="text-lg text-subtle-foreground">/100</span></p>
              <ScoreBar score={results.overallScore} />
              <p className="text-[10px] text-muted-foreground mt-2">Weighted composite of the three dimensions</p>
            </div>
            <div className={`rounded-xl border p-6 ${scoreBg(results.scoreBreakdown.cvOverview)}`}>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">CV Overview <span className="text-subtle-foreground">(25%)</span></p>
              <p className={`text-4xl font-bold ${scoreColor(results.scoreBreakdown.cvOverview)}`}>{results.scoreBreakdown.cvOverview}<span className="text-lg text-subtle-foreground">/100</span></p>
              <ScoreBar score={results.scoreBreakdown.cvOverview} />
            </div>
            <div className={`rounded-xl border p-6 ${scoreBg(results.scoreBreakdown.atsAndKeywordIntelligence)}`}>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">ATS & Keywords <span className="text-subtle-foreground">(40%)</span></p>
              <p className={`text-4xl font-bold ${scoreColor(results.scoreBreakdown.atsAndKeywordIntelligence)}`}>{results.scoreBreakdown.atsAndKeywordIntelligence}<span className="text-lg text-subtle-foreground">/100</span></p>
              <ScoreBar score={results.scoreBreakdown.atsAndKeywordIntelligence} />
            </div>
            <div className={`rounded-xl border p-6 ${scoreBg(results.scoreBreakdown.bulletImpact)}`}>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Bullet Impact <span className="text-subtle-foreground">(35%)</span></p>
              <p className={`text-4xl font-bold ${scoreColor(results.scoreBreakdown.bulletImpact)}`}>{results.scoreBreakdown.bulletImpact}<span className="text-lg text-subtle-foreground">/100</span></p>
              <ScoreBar score={results.scoreBreakdown.bulletImpact} />
            </div>
          </div>

          {/* Tabs */}
          <div className="mb-6 flex gap-1 overflow-x-auto border-b">
            {TABS.map(({ id, label }) => (
              <button key={id} onClick={() => setTab(id)}
                className={`px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                  tab === id ? 'border-yellow-500 text-blue-900' : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}>
                {label}
              </button>
            ))}
          </div>

          {tab === 'overview' && <CvOverviewTab results={results} />}
          {tab === 'ats' && <AtsIntelligenceTab results={results} />}
          {tab === 'bullets' && <BulletsTab results={results} targetRole={form.targetRole} />}
          {tab === 'rewrite' && (
            <RewriteTab
              results={results}
              cvFile={cvFile}
              onDownload={handleDownloadRewrittenCv}
              downloading={downloadingRewrite}
              downloadError={downloadError}
              downloadNotice={downloadNotice}
            />
          )}
          {tab === 'action-plan' && <ActionPlanTab plan={results.actionPlan} />}
        </div>
      )}
    </div>
  )
}

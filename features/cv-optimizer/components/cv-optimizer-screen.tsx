'use client'

import { useRef, useState } from 'react'
import { AlertCircle, ArrowRight, CheckCircle2, FileText, Loader, Upload, X, XCircle } from 'lucide-react'
import type {
  AnalyzeCvRequest,
  AnalyzeCvResult,
  BulletEvaluation,
  KeywordHighlight,
  RewriteSuggestion,
} from '@advance-academy/contracts'
import { type CvOptimizerTab, useCvOptimizer } from '@/features/cv-optimizer/hooks/use-cv-analysis'
import { parseFileForCvOptimizer } from '@/features/cv-optimizer/api/frontend-client'

// ─── Constants ────────────────────────────────────────────────────────────────

const INITIAL_FORM: AnalyzeCvRequest = {
  targetRole: '',
  currentCvText: '',
  jobDescription: '',
}

const TABS: { id: CvOptimizerTab; label: string }[] = [
  { id: 'analysis', label: 'Section Scores' },
  { id: 'keywords', label: 'Keywords & JD Fit' },
  { id: 'ats', label: 'ATS & Format' },
  { id: 'bullets', label: 'Bullet Impact' },
  { id: 'rewrite', label: 'Rewrite Suggestions' },
  { id: 'expert', label: 'Expert Review' },
]

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
      <p className="text-sm font-medium text-gray-700 mb-1">{label}</p>
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
            isDragOver ? 'border-yellow-400 bg-yellow-50' : 'border-gray-300 hover:border-yellow-400'
          }`}
        >
          <Upload className="w-6 h-6 text-gray-400 mx-auto mb-1" />
          <p className="text-sm text-gray-600">Drop a file or <span className="text-yellow-600 font-medium">browse</span></p>
          <p className="text-xs text-gray-400 mt-0.5">PDF or DOCX</p>
        </div>
      )}
      <input ref={inputRef} type="file" accept=".pdf,.docx" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f) }} />
    </div>
  )
}

function ScoreBar({ score }: { score: number }) {
  return (
    <div className="w-full bg-gray-200 rounded-full h-2 mt-2">
      <div className={`h-2 rounded-full transition-all ${scoreBar(score)}`} style={{ width: `${score}%` }} />
    </div>
  )
}

// ─── Results tabs ─────────────────────────────────────────────────────────────

function SectionScoresTab({ results }: { results: AnalyzeCvResult }) {
  return (
    <div className="space-y-4">
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
          <p className="text-gray-700 text-sm mt-3">{section.feedback}</p>
        </div>
      ))}
    </div>
  )
}

function KeywordsTab({ results }: { results: AnalyzeCvResult }) {
  const found = results.keywordHighlights.filter((k) => k.foundInCv)
  const missing = results.keywordHighlights.filter((k) => !k.foundInCv)

  const categoryLabel: Record<KeywordHighlight['category'], string> = {
    required_skill: 'Required',
    tech_stack: 'Tech Stack',
    nice_to_have: 'Nice to Have',
  }

  const categoryColor: Record<KeywordHighlight['category'], string> = {
    required_skill: 'bg-red-100 text-red-700 border-red-200',
    tech_stack: 'bg-blue-100 text-blue-700 border-blue-200',
    nice_to_have: 'bg-gray-100 text-gray-600 border-gray-200',
  }

  return (
    <div className="space-y-6">
      {results.keywordHighlights.length > 0 && (
        <div>
          <h4 className="font-semibold text-blue-900 mb-3">Keyword Coverage</h4>
          <div className="flex flex-wrap gap-2">
            {results.keywordHighlights.map((kw, idx) => (
              <span
                key={idx}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${
                  kw.foundInCv ? 'bg-green-100 text-green-700 border-green-200' : categoryColor[kw.category]
                }`}
              >
                {kw.foundInCv
                  ? <CheckCircle2 className="w-3 h-3" />
                  : <XCircle className="w-3 h-3" />}
                {kw.keyword}
                <span className="opacity-60 text-[10px]">{categoryLabel[kw.category]}</span>
              </span>
            ))}
          </div>
          <div className="mt-2 flex gap-4 text-xs text-gray-500">
            <span className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-green-500" /> Found in CV ({found.length})</span>
            <span className="flex items-center gap-1"><XCircle className="w-3 h-3 text-red-400" /> Missing ({missing.length})</span>
          </div>
        </div>
      )}

      <div>
        <h4 className="font-semibold text-blue-900 mb-3">JD Alignment</h4>
        {results.jdAlignment.alignmentSummary && (
          <p className="text-sm text-gray-700 mb-4 leading-relaxed">{results.jdAlignment.alignmentSummary}</p>
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
    </div>
  )
}

function AtsTab({ results }: { results: AnalyzeCvResult }) {
  return (
    <div className="space-y-6">
      <div className={`rounded-xl border p-6 ${scoreBg(results.atsCheck.score)}`}>
        <div className="flex items-center justify-between mb-1">
          <div>
            <h4 className="font-semibold text-blue-900">ATS Compatibility Score</h4>
            <p className="text-xs text-gray-500 mt-0.5">How well an applicant tracking system can parse this CV</p>
          </div>
          <span className={`text-3xl font-bold ${scoreColor(results.atsCheck.score)}`}>
            {results.atsCheck.score}
          </span>
        </div>
        <ScoreBar score={results.atsCheck.score} />
      </div>

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

function BulletsTab({ results }: { results: AnalyzeCvResult }) {
  if (results.bulletEvaluations.length === 0) {
    return <p className="text-gray-500 text-sm">No bullet evaluations returned. Ensure the CV contains structured experience bullets.</p>
  }

  const sorted = [...results.bulletEvaluations].sort((a: BulletEvaluation, b: BulletEvaluation) => a.impactScore - b.impactScore)

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-500">Bullets sorted from weakest to strongest. Impact score is 1–10.</p>
      {sorted.map((bullet, idx) => (
        <div key={idx} className={`rounded-xl border p-5 ${bullet.impactScore >= 7 ? 'border-green-200 bg-green-50' : bullet.impactScore >= 4 ? 'border-amber-200 bg-amber-50' : 'border-red-200 bg-red-50'}`}>
          <div className="flex items-start justify-between gap-4 mb-2">
            <p className="text-sm text-gray-800 italic flex-1">"{bullet.original}"</p>
            <div className="flex-shrink-0 text-right">
              <span className={`text-xl font-bold ${impactColor(bullet.impactScore)}`}>{bullet.impactScore}</span>
              <span className="text-xs text-gray-400">/10</span>
            </div>
          </div>
          <p className="text-xs text-gray-600">{bullet.feedback}</p>
          {!bullet.hasImpact && (
            <span className="inline-block mt-2 rounded-full bg-red-100 text-red-600 text-xs px-2 py-0.5 font-medium">No measurable impact</span>
          )}
        </div>
      ))}
    </div>
  )
}

function RewriteTab({ results }: { results: AnalyzeCvResult }) {
  if (results.rewriteSuggestions.length === 0) {
    return <p className="text-gray-500 text-sm">No rewrite suggestions returned.</p>
  }

  return (
    <div className="space-y-5">
      {results.rewriteSuggestions.map((suggestion: RewriteSuggestion, idx: number) => (
        <div key={idx} className="rounded-xl border border-gray-200 overflow-hidden">
          <div className="bg-gray-100 px-4 py-2 text-xs font-semibold text-gray-600 uppercase tracking-wide">
            {suggestion.section}
          </div>
          <div className="grid sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-gray-200">
            <div className="p-5 bg-red-50">
              <p className="text-xs font-semibold text-red-600 mb-2 uppercase tracking-wide">Current</p>
              <p className="text-sm text-gray-800 leading-relaxed">{suggestion.current}</p>
            </div>
            <div className="p-5 bg-green-50 relative">
              <div className="absolute left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 hidden sm:flex w-7 h-7 bg-white border border-gray-200 rounded-full items-center justify-center shadow-sm">
                <ArrowRight className="w-3 h-3 text-gray-400" />
              </div>
              <p className="text-xs font-semibold text-green-600 mb-2 uppercase tracking-wide">Suggested</p>
              <p className="text-sm text-gray-800 leading-relaxed">{suggestion.suggested}</p>
            </div>
          </div>
          <div className="px-4 py-2 bg-gray-50 border-t border-gray-200">
            <p className="text-xs text-gray-500"><span className="font-medium text-gray-700">Why: </span>{suggestion.reason}</p>
          </div>
        </div>
      ))}
    </div>
  )
}

function ExpertReviewTab({ results }: { results: AnalyzeCvResult }) {
  return (
    <div className="bg-blue-50 rounded-xl p-8">
      <p className="text-gray-700 text-base leading-relaxed">{results.expertReview}</p>
    </div>
  )
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export function CvOptimizerScreen() {
  const [form, setForm] = useState<AnalyzeCvRequest>(INITIAL_FORM)
  const [cvFileName, setCvFileName] = useState<string | null>(null)
  const [jdFileName, setJdFileName] = useState<string | null>(null)
  const [cvParsing, setCvParsing] = useState(false)
  const [jdParsing, setJdParsing] = useState(false)
  const [parseError, setParseError] = useState<string | null>(null)

  const { tab, setTab, state, submit, reset, latestJob } = useCvOptimizer()
  const isBusy = state.status === 'submitting' || state.status === 'running'
  const results = state.data

  function updateField<K extends keyof AnalyzeCvRequest>(key: K, value: AnalyzeCvRequest[K]) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  async function handleCvFile(file: File) {
    setCvFileName(file.name); setCvParsing(true); setParseError(null)
    try {
      const { text } = await parseFileForCvOptimizer(file)
      updateField('currentCvText', text)
    } catch {
      setParseError('Failed to extract text from CV file. Try pasting it manually.')
      setCvFileName(null)
    } finally { setCvParsing(false) }
  }

  async function handleJdFile(file: File) {
    setJdFileName(file.name); setJdParsing(true); setParseError(null)
    try {
      const { text } = await parseFileForCvOptimizer(file)
      updateField('jobDescription', text)
    } catch {
      setParseError('Failed to extract text from JD file. Try pasting it manually.')
      setJdFileName(null)
    } finally { setJdParsing(false) }
  }

  function handleReset() {
    reset(); setForm(INITIAL_FORM); setCvFileName(null); setJdFileName(null); setParseError(null)
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <h1 className="text-4xl font-serif font-bold text-blue-900 mb-2">CV Optimizer</h1>
      <p className="text-gray-500 mb-8">Analyze your CV against a job description — get scores, keyword gaps, ATS check, bullet impact ratings, and rewrite suggestions.</p>

      {!results ? (
        <div className="grid md:grid-cols-2 gap-8">
          {/* Left — inputs */}
          <div className="bg-gray-50 rounded-xl p-8 space-y-5">
            <input
              value={form.targetRole}
              onChange={(e) => updateField('targetRole', e.target.value)}
              placeholder="Target role (e.g. Frontend Developer)"
              className="w-full rounded-lg border border-gray-200 px-4 py-3 bg-white"
            />
            <div className="space-y-2">
              <FileUploadZone label="CV" fileName={cvFileName} parsing={cvParsing} onFile={handleCvFile}
                onClear={() => { setCvFileName(null); updateField('currentCvText', '') }} />
              <textarea value={form.currentCvText} onChange={(e) => updateField('currentCvText', e.target.value)}
                placeholder="Or paste your CV text here..." className="min-h-36 w-full rounded-lg border border-gray-200 px-4 py-3 bg-white text-sm" />
            </div>
            <div className="space-y-2">
              <FileUploadZone label="Job Description" fileName={jdFileName} parsing={jdParsing} onFile={handleJdFile}
                onClear={() => { setJdFileName(null); updateField('jobDescription', '') }} />
              <textarea value={form.jobDescription} onChange={(e) => updateField('jobDescription', e.target.value)}
                placeholder="Or paste the job description here..." className="min-h-28 w-full rounded-lg border border-gray-200 px-4 py-3 bg-white text-sm" />
            </div>

            {(parseError || state.error) && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {parseError ?? state.error?.message}
              </div>
            )}

            <button onClick={() => submit(form)} disabled={isBusy || cvParsing || jdParsing}
              className="w-full mt-2 px-6 py-3 bg-yellow-500 text-blue-900 rounded-lg font-semibold hover:bg-yellow-400 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
              {isBusy ? (
                <><Loader className="w-4 h-4 animate-spin" />{state.status === 'submitting' ? 'Submitting...' : 'Analyzing...'}</>
              ) : 'Analyze My CV'}
            </button>

            {latestJob && (
              <p className="text-xs text-gray-400 text-center">
                Job <span className="font-mono">{latestJob.jobId.slice(0, 8)}…</span> · {latestJob.status}
              </p>
            )}
          </div>

          {/* Right — description + tips */}
          <div className="space-y-6">
            <div className="bg-blue-900 rounded-xl p-8 text-white">
              <h3 className="text-xl font-serif font-semibold mb-3">What this tool does</h3>
              <p className="text-blue-100 leading-relaxed mb-4">
                Upload your CV and a job description — our AI compares them side by side across six dimensions.
              </p>
              <ul className="space-y-2 text-blue-200 text-sm">
                {[
                  ['Section Scores', 'Scored feedback on skills, experience, alignment, and writing.'],
                  ['Keywords & JD Fit', 'Every named technology and requirement from the JD, marked found or missing.'],
                  ['ATS & Format', 'Applicant tracking system compatibility and format/typo issues.'],
                  ['Bullet Impact', 'Semantic evaluation of every experience bullet — does it show real impact?'],
                  ['Rewrite Suggestions', 'Side-by-side view of weak content and a stronger version to replace it.'],
                  ['Expert Review', 'Holistic verdict from an AI career coach.'],
                ].map(([title, desc], i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-yellow-400 font-bold mt-0.5">{i + 1}.</span>
                    <span><strong className="text-white">{title}</strong> — {desc}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="bg-blue-50 rounded-xl p-6">
              <h3 className="text-lg font-semibold text-blue-900 mb-3">Optimization Tips</h3>
              <ul className="space-y-2 text-sm text-gray-700">
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

          {/* Score header */}
          <div className="grid sm:grid-cols-3 gap-4 mb-8">
            <div className={`rounded-xl border p-6 ${scoreBg(results.overallScore)}`}>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Overall Score</p>
              <p className={`text-4xl font-bold ${scoreColor(results.overallScore)}`}>{results.overallScore}<span className="text-lg text-gray-400">/100</span></p>
              <ScoreBar score={results.overallScore} />
            </div>
            <div className={`rounded-xl border p-6 ${scoreBg(results.atsCheck.score)}`}>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">ATS Score</p>
              <p className={`text-4xl font-bold ${scoreColor(results.atsCheck.score)}`}>{results.atsCheck.score}<span className="text-lg text-gray-400">/100</span></p>
              <ScoreBar score={results.atsCheck.score} />
            </div>
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-6">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Keywords Found</p>
              <p className="text-4xl font-bold text-blue-900">
                {results.keywordHighlights.filter((k) => k.foundInCv).length}
                <span className="text-lg text-gray-400">/{results.keywordHighlights.length}</span>
              </p>
              <p className="text-xs text-gray-500 mt-2">from the job description</p>
            </div>
          </div>

          {/* Tabs */}
          <div className="mb-6 flex gap-1 overflow-x-auto border-b border-gray-200">
            {TABS.map(({ id, label }) => (
              <button key={id} onClick={() => setTab(id)}
                className={`px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                  tab === id ? 'border-yellow-500 text-blue-900' : 'border-transparent text-gray-500 hover:text-gray-800'
                }`}>
                {label}
              </button>
            ))}
          </div>

          {tab === 'analysis' && <SectionScoresTab results={results} />}
          {tab === 'keywords' && <KeywordsTab results={results} />}
          {tab === 'ats' && <AtsTab results={results} />}
          {tab === 'bullets' && <BulletsTab results={results} />}
          {tab === 'rewrite' && <RewriteTab results={results} />}
          {tab === 'expert' && <ExpertReviewTab results={results} />}
        </div>
      )}
    </div>
  )
}

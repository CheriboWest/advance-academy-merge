'use client'

import { useState } from 'react'
import { AlertCircle, Loader, Upload } from 'lucide-react'
import type { AnalyzeCvRequest } from '@advance-academy/contracts'
import { useCvOptimizer } from '@/features/cv-optimizer/hooks/use-cv-analysis'

const INITIAL_FORM: AnalyzeCvRequest = {
  candidateName: '',
  targetRole: '',
  currentCvText: '',
  jobDescription: '',
}

export function CvOptimizerScreen() {
  const [form, setForm] = useState<AnalyzeCvRequest>(INITIAL_FORM)
  const { tab, setTab, state, submit, reset, latestJob } = useCvOptimizer()
  const isBusy = state.status === 'submitting' || state.status === 'running'
  const results = state.data

  function updateField<K extends keyof AnalyzeCvRequest>(key: K, value: AnalyzeCvRequest[K]) {
    setForm((current) => ({
      ...current,
      [key]: value,
    }))
  }

  function handleSubmit() {
    submit(form)
  }

  function handleReset() {
    reset()
    setForm(INITIAL_FORM)
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <h1 className="text-4xl font-serif font-bold text-blue-900 mb-4">CV Optimizer</h1>


      {!results ? (
        <div className="grid md:grid-cols-2 gap-8">
          <div className="bg-gray-50 rounded-xl p-8 space-y-4">
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-yellow-500 transition-colors">
              <Upload className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-700 font-medium mb-2">Paste CV content below</p>
              <p className="text-gray-500 text-sm">File upload can be connected later through the same BFF structure.</p>
            </div>

            <input
              value={form.candidateName}
              onChange={(event) => updateField('candidateName', event.target.value)}
              placeholder="Candidate name"
              className="w-full rounded-lg border border-gray-200 px-4 py-3"
            />
            <input
              value={form.targetRole}
              onChange={(event) => updateField('targetRole', event.target.value)}
              placeholder="Target role"
              className="w-full rounded-lg border border-gray-200 px-4 py-3"
            />
            <textarea
              value={form.currentCvText}
              onChange={(event) => updateField('currentCvText', event.target.value)}
              placeholder="Paste CV text"
              className="min-h-56 w-full rounded-lg border border-gray-200 px-4 py-3"
            />
            <textarea
              value={form.jobDescription}
              onChange={(event) => updateField('jobDescription', event.target.value)}
              placeholder="Optional job description"
              className="min-h-32 w-full rounded-lg border border-gray-200 px-4 py-3"
            />

            {state.error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {state.error.message}
              </div>
            )}

            <button
              onClick={handleSubmit}
              disabled={isBusy}
              className="w-full mt-2 px-6 py-3 bg-yellow-500 text-blue-900 rounded-lg font-semibold hover:bg-yellow-400 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isBusy ? (
                <>
                  <Loader className="w-4 h-4 animate-spin" />
                  {state.status === 'submitting' ? 'Submitting job...' : 'Analyzing...'}
                </>
              ) : (
                'Analyze My CV'
              )}
            </button>

            {latestJob && (
              <p className="text-xs text-gray-500">
                Job `{latestJob.jobId}` is currently `{latestJob.status}`.
              </p>
            )}
          </div>

          <div className="bg-blue-50 rounded-xl p-8">
            <h3 className="text-xl font-serif font-semibold text-blue-900 mb-4">Optimization Tips</h3>
            <ul className="space-y-3 text-gray-700">
              <li className="flex gap-3">
                <AlertCircle className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" />
                <span>Use strong action verbs to start bullet points.</span>
              </li>
              <li className="flex gap-3">
                <AlertCircle className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" />
                <span>Quantify achievements so the AI analysis can score impact correctly.</span>
              </li>
              <li className="flex gap-3">
                <AlertCircle className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" />
                <span>Add a target job description when you want stronger role alignment feedback.</span>
              </li>
              <li className="flex gap-3">
                <AlertCircle className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" />
                <span>The job id is persisted locally, so refresh can resume polling.</span>
              </li>
            </ul>
          </div>
        </div>
      ) : (
        <div>
          <div className="mb-8">
            <button
              onClick={handleReset}
              className="px-4 py-2 text-yellow-600 font-medium hover:bg-yellow-50 rounded-lg"
            >
              &larr; Analyze Another CV
            </button>
          </div>

          <div className="bg-gradient-to-r from-yellow-500 to-yellow-400 rounded-xl p-8 text-blue-900 mb-8">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold opacity-90">Overall CV score</p>
                <p className="text-4xl font-bold">{results.overallScore}/100</p>
              </div>
              <div className="text-right">
                <p className="text-sm opacity-90">Async job completed</p>
                <p className="text-lg font-semibold">Ready for optimization</p>
              </div>
            </div>
          </div>

          <div className="mb-6 flex gap-4 border-b border-gray-200">
            <button
              onClick={() => setTab('analysis')}
              className={`px-4 py-3 font-medium border-b-2 transition-colors ${tab === 'analysis'
                  ? 'border-yellow-500 text-blue-900'
                  : 'border-transparent text-gray-600 hover:text-gray-900'
                }`}
            >
              Section Analysis
            </button>
            <button
              onClick={() => setTab('expert')}
              className={`px-4 py-3 font-medium border-b-2 transition-colors ${tab === 'expert'
                  ? 'border-yellow-500 text-blue-900'
                  : 'border-transparent text-gray-600 hover:text-gray-900'
                }`}
            >
              Expert Review
            </button>
          </div>

          {tab === 'analysis' && (
            <div className="space-y-6">
              {results.sections.map((section, idx) => (
                <div key={`${section.title}-${idx}`} className="bg-gray-50 rounded-xl p-6">
                  <div className="flex justify-between items-start mb-4">
                    <h4 className="text-lg font-serif font-semibold text-blue-900">{section.title}</h4>
                    <div className="text-2xl font-bold text-yellow-500">{section.score}</div>
                  </div>
                  <p className="text-gray-700">{section.feedback}</p>
                </div>
              ))}
            </div>
          )}

          {tab === 'expert' && (
            <div className="bg-blue-50 rounded-xl p-8">
              <p className="text-gray-700 text-lg leading-relaxed">{results.expertReview}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

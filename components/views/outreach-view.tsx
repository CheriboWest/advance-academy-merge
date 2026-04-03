'use client'

import { Loader, CheckCircle2 } from 'lucide-react'
import type { OutreachFormData, OutreachScript } from '@/lib/types'

interface OutreachViewProps {
  form: OutreachFormData
  updateForm: (updates: Partial<OutreachFormData>) => void
  results: OutreachScript[] | null
  clearResults: () => void
  loading: boolean
  onGenerate: () => void
}

export function OutreachView({
  form,
  updateForm,
  results,
  clearResults,
  loading,
  onGenerate,
}: OutreachViewProps) {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <h1 className="text-4xl font-serif font-bold text-blue-900 mb-4">Recruitment Outreach Generator</h1>
      <p className="text-gray-600 text-lg mb-12">Generate personalized outreach scripts to connect with recruiters.</p>

      {!results ? (
        <div className="grid md:grid-cols-2 gap-8">
          {/* Form */}
          <div className="bg-gray-50 rounded-xl p-8">
            <h3 className="text-xl font-serif font-semibold text-blue-900 mb-6">Your Target</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-blue-900 mb-2">Job Title</label>
                <input
                  type="text"
                  placeholder="e.g., Senior Product Manager"
                  value={form.jobTitle}
                  onChange={(e) => updateForm({ jobTitle: e.target.value })}
                  className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-yellow-500"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-blue-900 mb-2">Company</label>
                <input
                  type="text"
                  placeholder="e.g., TechFlow Systems"
                  value={form.company}
                  onChange={(e) => updateForm({ company: e.target.value })}
                  className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-yellow-500"
                />
              </div>
              <button
                onClick={onGenerate}
                disabled={loading || !form.jobTitle || !form.company}
                className="w-full mt-6 px-6 py-3 bg-yellow-500 text-blue-900 rounded-lg font-semibold hover:bg-yellow-400 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <Loader className="w-4 h-4 animate-spin" /> Generating...
                  </>
                ) : (
                  'Generate Scripts'
                )}
              </button>
            </div>
          </div>

          {/* Info */}
          <div className="bg-blue-50 rounded-xl p-8">
            <h3 className="text-xl font-serif font-semibold text-blue-900 mb-4">Why Outreach?</h3>
            <ul className="space-y-3 text-gray-700">
              <li className="flex gap-3">
                <CheckCircle2 className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" />
                <span>Direct connections with decision makers</span>
              </li>
              <li className="flex gap-3">
                <CheckCircle2 className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" />
                <span>Higher response rates than applications</span>
              </li>
              <li className="flex gap-3">
                <CheckCircle2 className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" />
                <span>Personalized approach shows genuine interest</span>
              </li>
              <li className="flex gap-3">
                <CheckCircle2 className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" />
                <span>Build relationships before opportunities open</span>
              </li>
            </ul>
          </div>
        </div>
      ) : (
        <div>
          <div className="mb-8">
            <button
              onClick={clearResults}
              className="px-4 py-2 text-yellow-600 font-medium hover:bg-yellow-50 rounded-lg"
            >
              &larr; Generate New Scripts
            </button>
          </div>

          <div className="space-y-6">
            {results.map((script, idx) => (
              <div key={idx} className="bg-gray-50 rounded-xl p-8">
                <h3 className="text-xl font-serif font-semibold text-blue-900 mb-4">{script.type}</h3>
                <div className="bg-white rounded-lg p-6 border border-gray-200 mb-4 font-mono text-sm text-gray-700 whitespace-pre-wrap">
                  {script.content}
                </div>
                <div className="flex gap-3">
                  <button className="px-4 py-2 bg-yellow-500 text-blue-900 rounded-lg font-medium hover:bg-yellow-400 transition-colors">
                    Copy
                  </button>
                  <button className="px-4 py-2 bg-white border border-yellow-500 text-yellow-600 rounded-lg font-medium hover:bg-yellow-50 transition-colors">
                    Customize
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

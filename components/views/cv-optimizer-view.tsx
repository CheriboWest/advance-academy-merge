'use client'

import { Upload, Loader, AlertCircle } from 'lucide-react'
import type { CvTabName, CVReview } from '@/lib/types'

interface CvOptimizerViewProps {
  tab: CvTabName
  setTab: (tab: CvTabName) => void
  loading: boolean
  results: CVReview | null
  clearResults: () => void
  onUpload: () => void
}

export function CvOptimizerView({
  tab,
  setTab,
  loading,
  results,
  clearResults,
  onUpload,
}: CvOptimizerViewProps) {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <h1 className="text-4xl font-serif font-bold text-blue-900 mb-4">CV Optimizer</h1>
      <p className="text-gray-600 text-lg mb-12">Upload your CV for AI-powered analysis and expert feedback.</p>

      {!results ? (
        <div className="grid md:grid-cols-2 gap-8">
          {/* Upload Area */}
          <div className="bg-gray-50 rounded-xl p-8">
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-12 text-center hover:border-yellow-500 transition-colors cursor-pointer">
              <Upload className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-700 font-medium mb-2">Drop your CV here</p>
              <p className="text-gray-500 text-sm mb-4">or click to select a file</p>
              <p className="text-gray-500 text-xs">PDF, DOCX, or TXT (Max 5MB)</p>
            </div>
            <button
              onClick={onUpload}
              disabled={loading}
              className="w-full mt-6 px-6 py-3 bg-yellow-500 text-blue-900 rounded-lg font-semibold hover:bg-yellow-400 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <Loader className="w-4 h-4 animate-spin" /> Analyzing...
                </>
              ) : (
                'Analyze My CV'
              )}
            </button>
          </div>

          {/* Tips */}
          <div className="bg-blue-50 rounded-xl p-8">
            <h3 className="text-xl font-serif font-semibold text-blue-900 mb-4">Optimization Tips</h3>
            <ul className="space-y-3 text-gray-700">
              <li className="flex gap-3">
                <AlertCircle className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" />
                <span>Use strong action verbs to start bullet points</span>
              </li>
              <li className="flex gap-3">
                <AlertCircle className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" />
                <span>Quantify your achievements with metrics</span>
              </li>
              <li className="flex gap-3">
                <AlertCircle className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" />
                <span>Tailor your CV to each job posting</span>
              </li>
              <li className="flex gap-3">
                <AlertCircle className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" />
                <span>Keep it to 1-2 pages for most roles</span>
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
              &larr; Analyze Another CV
            </button>
          </div>

          {/* Overall Score */}
          <div className="bg-gradient-to-r from-yellow-500 to-yellow-400 rounded-xl p-8 text-blue-900 mb-8">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold opacity-90">Overall CV Score</p>
                <p className="text-4xl font-bold">{results.overallScore}/100</p>
              </div>
              <div className="text-right">
                <p className="text-sm opacity-90">Great potential!</p>
                <p className="text-lg font-semibold">Room for optimization</p>
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="mb-6 flex gap-4 border-b border-gray-200">
            <button
              onClick={() => setTab('analysis')}
              className={`px-4 py-3 font-medium border-b-2 transition-colors ${
                tab === 'analysis'
                  ? 'border-yellow-500 text-blue-900'
                  : 'border-transparent text-gray-600 hover:text-gray-900'
              }`}
            >
              Section Analysis
            </button>
            <button
              onClick={() => setTab('expert')}
              className={`px-4 py-3 font-medium border-b-2 transition-colors ${
                tab === 'expert'
                  ? 'border-yellow-500 text-blue-900'
                  : 'border-transparent text-gray-600 hover:text-gray-900'
              }`}
            >
              Expert Review
            </button>
          </div>

          {/* Content */}
          {tab === 'analysis' && (
            <div className="space-y-6">
              {results.sections.map((section, idx) => (
                <div key={idx} className="bg-gray-50 rounded-xl p-6">
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

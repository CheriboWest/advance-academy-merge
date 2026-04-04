'use client'

import { Loader } from 'lucide-react'
import { useDreamCompany } from '@/features/dream-company/hooks/use-dream-company'

export function DreamCompanyScreen() {
  const { step, setStep, form, updateForm, results, loading, search, reset } = useDreamCompany()

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <h1 className="text-4xl font-serif font-bold text-blue-900 mb-4">Dream Company Finder</h1>
      <p className="text-gray-600 text-lg mb-12">Find companies that align with your career aspirations.</p>

      {!results ? (
        <div className="bg-gray-50 rounded-xl p-8">
          <div className="max-w-2xl">
            <div className="flex gap-2 mb-8">
              {[1, 2, 3].map((currentStep) => (
                <div
                  key={currentStep}
                  className={`h-2 flex-1 rounded-full transition-colors ${
                    currentStep <= step ? 'bg-yellow-500' : 'bg-gray-300'
                  }`}
                />
              ))}
            </div>

            {step === 1 && (
              <div>
                <label className="block text-sm font-semibold text-blue-900 mb-4">
                  What industry interests you?
                </label>
                <select
                  value={form.industry}
                  onChange={(event) => updateForm({ industry: event.target.value })}
                  className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-yellow-500 bg-white"
                >
                  <option value="">Select an industry</option>
                  <option value="Tech">Technology</option>
                  <option value="Finance">Finance</option>
                  <option value="Healthcare">Healthcare</option>
                  <option value="Education">Education</option>
                  <option value="Consulting">Consulting</option>
                </select>
                <button
                  onClick={() => form.industry && setStep(2)}
                  className="mt-6 w-full px-6 py-3 bg-yellow-500 text-blue-900 rounded-lg font-semibold hover:bg-yellow-400 transition-colors disabled:opacity-50"
                  disabled={!form.industry}
                >
                  Next
                </button>
              </div>
            )}

            {step === 2 && (
              <div>
                <label className="block text-sm font-semibold text-blue-900 mb-4">
                  Preferred location?
                </label>
                <select
                  value={form.location}
                  onChange={(event) => updateForm({ location: event.target.value })}
                  className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-yellow-500 bg-white"
                >
                  <option value="">Select a location</option>
                  <option value="San Francisco">San Francisco, CA</option>
                  <option value="New York">New York, NY</option>
                  <option value="Seattle">Seattle, WA</option>
                  <option value="Austin">Austin, TX</option>
                  <option value="Remote">Remote</option>
                </select>
                <div className="flex gap-4 mt-6">
                  <button
                    onClick={() => setStep(1)}
                    className="flex-1 px-6 py-3 bg-gray-200 text-blue-900 rounded-lg font-semibold hover:bg-gray-300 transition-colors"
                  >
                    Back
                  </button>
                  <button
                    onClick={() => form.location && setStep(3)}
                    className="flex-1 px-6 py-3 bg-yellow-500 text-blue-900 rounded-lg font-semibold hover:bg-yellow-400 transition-colors disabled:opacity-50"
                    disabled={!form.location}
                  >
                    Next
                  </button>
                </div>
              </div>
            )}

            {step === 3 && (
              <div>
                <label className="block text-sm font-semibold text-blue-900 mb-4">
                  Company size preference?
                </label>
                <select
                  value={form.companySize}
                  onChange={(event) => updateForm({ companySize: event.target.value })}
                  className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-yellow-500 bg-white"
                >
                  <option value="">Select company size</option>
                  <option value="Startup">Startup (1-50)</option>
                  <option value="Scaleup">Scale-up (50-500)</option>
                  <option value="Mid">Mid-size (500-5000)</option>
                  <option value="Enterprise">Enterprise (5000+)</option>
                </select>
                <div className="flex gap-4 mt-6">
                  <button
                    onClick={() => setStep(2)}
                    className="flex-1 px-6 py-3 bg-gray-200 text-blue-900 rounded-lg font-semibold hover:bg-gray-300 transition-colors"
                  >
                    Back
                  </button>
                  <button
                    onClick={search}
                    disabled={loading || !form.companySize}
                    className="flex-1 px-6 py-3 bg-yellow-500 text-blue-900 rounded-lg font-semibold hover:bg-yellow-400 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {loading ? (
                      <>
                        <Loader className="w-4 h-4 animate-spin" /> Finding...
                      </>
                    ) : (
                      'Find Companies'
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div>
          <div className="mb-8">
            <button
              onClick={reset}
              className="px-4 py-2 text-yellow-600 font-medium hover:bg-yellow-50 rounded-lg"
            >
              &larr; New Search
            </button>
          </div>

          <div className="grid gap-6">
            {results.map((company, index) => (
              <div key={`${company.name}-${index}`} className="bg-gray-50 rounded-xl p-8 border-l-4 border-yellow-500">
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <h3 className="text-2xl font-serif font-semibold text-blue-900">{company.name}</h3>
                    <p className="text-gray-600">{company.industry} &bull; {company.location}</p>
                  </div>
                  <div className="text-right">
                    <div className="text-3xl font-bold text-yellow-500">{company.match}%</div>
                    <p className="text-sm text-gray-600">Match Score</p>
                  </div>
                </div>
                <div className="flex gap-3 mt-4">
                  <button className="px-4 py-2 bg-yellow-500 text-blue-900 rounded-lg font-medium hover:bg-yellow-400 transition-colors">
                    View Details
                  </button>
                  <button className="px-4 py-2 bg-white border border-yellow-500 text-yellow-600 rounded-lg font-medium hover:bg-yellow-50 transition-colors">
                    Learn More
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

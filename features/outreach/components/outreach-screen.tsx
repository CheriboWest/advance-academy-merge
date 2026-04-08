'use client'

import { useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Link as LinkIcon,
  Loader,
  Upload,
} from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import { useOutreach } from '@/features/outreach/hooks/use-outreach'
import type { ManualContextLink, OutreachFormData } from '@/features/outreach/types'
import type { EnrichmentCard, ExperienceLevel, OutreachIntent } from '@/types/outreach'
import { extractOutreachSource } from '@/features/outreach/api/frontend-client'
import { EnrichmentPanel } from './enrichment-panel'
import { ManualContextManager } from './manual-context-manager'

const inputClass =
  'w-full px-4 py-2.5 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm'
const textareaClass = `${inputClass} min-h-24 resize-y`

function Field({
  label,
  required,
  children,
}: {
  label: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <div>
      <label className="block text-sm font-semibold text-blue-900 mb-1.5 flex justify-between items-center">
        <span>
          {label} {required && <span className="text-red-500 ml-0.5">*</span>}
        </span>
      </label>
      {children}
    </div>
  )
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <button
      onClick={handleCopy}
      className="px-4 py-2 bg-yellow-500 text-blue-900 rounded-lg font-medium hover:bg-yellow-400 transition-colors flex items-center gap-2 text-sm shadow-sm"
    >
      {copied ? (
        <>
          <CheckCircle2 className="w-4 h-4" /> Copied
        </>
      ) : (
        <>
          <Copy className="w-4 h-4" /> Copy
        </>
      )}
    </button>
  )
}

function FileExtractor({
  onExtract,
  placeholder = 'Upload PDF/DOCX or Paste Text below',
}: {
  onExtract: (text: string) => void
  placeholder?: string
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    setLoading(true)
    setError('')
    try {
      const res = await extractOutreachSource(file)
      onExtract(res.text)
    } catch (err: any) {
      setError(err.message || 'Extract failed')
    } finally {
      setLoading(false)
      if (e.target) e.target.value = ''
    }
  }

  return (
    <div className="mb-2">
      <div className="flex items-center gap-3">
        <label className="cursor-pointer inline-flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-700 rounded-lg text-sm font-semibold hover:bg-blue-100 transition-colors">
          <Upload className="w-4 h-4" />
          {loading ? 'Extracting...' : 'Upload File'}
          <input type="file" accept=".pdf,.docx" className="hidden" onChange={handleFile} disabled={loading} />
        </label>
        <span className="text-xs text-gray-400">{placeholder}</span>
      </div>
      {error && <p className="text-red-500 text-xs mt-1">{error}</p>}
    </div>
  )
}

function UrlExtractor({
  onExtract,
  placeholder = 'https://...',
}: {
  onExtract: (text: string) => void
  placeholder?: string
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [url, setUrl] = useState('')

  async function handleExtract() {
    if (!url.trim()) return
    setLoading(true)
    setError('')
    try {
      const res = await extractOutreachSource(url.trim())
      onExtract(res.text)
      setUrl('')
    } catch (err: any) {
      setError(err.message || 'Extract failed. Please try saving as PDF instead.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mb-2">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={placeholder}
          className="flex-1 px-3 py-2 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
        />
        <button
          onClick={handleExtract}
          disabled={loading || !url.trim()}
          className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-semibold hover:bg-gray-200 disabled:opacity-50 flex items-center gap-2"
        >
          {loading ? <Loader className="w-4 h-4 animate-spin" /> : <LinkIcon className="w-4 h-4" />}
          Extract URL
        </button>
      </div>
      {error && (
        <p className="text-red-500 text-xs mt-1 flex items-center gap-1">
          <AlertTriangle className="w-3 h-3" /> {error}
        </p>
      )}
    </div>
  )
}

const INTENT_OPTIONS: { value: OutreachIntent; label: string }[] = [
  { value: 'direct_application', label: '🎯 Direct Application (Hard Pitch)' },
  { value: 'referral_request', label: '🤝 Referral Request (Soft Ask to Employee)' },
  { value: 'informational_interview', label: '☕ Informational Interview (Networking)' },
  { value: 'agency_recruiter', label: '👔 Agency Recruiter (Headhunter Pitch)' },
]

interface OutreachFormProps {
  form: OutreachFormData
  updateForm: (
    updates: Partial<OutreachFormData> | ((prev: OutreachFormData) => Partial<OutreachFormData>),
  ) => void
  loading: boolean
  error: string | null
  onGenerate: () => void
  onEnrich: () => void
  enriching: boolean
  enrichError: string | null
}

function OutreachForm({
  form,
  updateForm,
  loading,
  error,
  onGenerate,
  onEnrich,
  enriching,
  enrichError,
}: OutreachFormProps) {
  const atLeastOneOutput = form.outputs.email || form.outputs.linkedIn
  const canSubmit =
    !loading &&
    form.cvText.trim().length > 0 &&
    form.targetCompany.trim().length > 0 &&
    form.targetRole.trim().length > 0 &&
    atLeastOneOutput

  const canSearch = form.targetCompany.trim().length > 0 && form.targetRole.trim().length > 0

  return (
    <div className="space-y-8">
      {/* Section 1 — Identity */}
      <div className="p-8 bg-white border border-gray-200 rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
        <h3 className="text-xl font-serif font-bold text-blue-900 mb-6 flex items-center gap-2">
          <span className="flex items-center justify-center w-8 h-8 rounded-full bg-blue-100 text-blue-600 text-sm">1</span>
          Who are you? (Identity Context)
        </h3>

        <div className="space-y-6">
          <Field label="Your CV Content" required>
            <FileExtractor onExtract={(t) => updateForm({ cvText: t })} />
            <textarea
              value={form.cvText}
              onChange={(e) => updateForm({ cvText: e.target.value })}
              placeholder="Review or paste your resume content here..."
              className={`${textareaClass} h-40 focus:ring-blue-500`}
            />
          </Field>

          <div className="border-t border-gray-100 pt-6">
            <Field label="Portfolio / Additional Context (Optional)">
              <p className="text-xs text-gray-500 mb-2">
                Add a portfolio URL, case study, or project page. We&apos;ll extract the readable text via Jina.
              </p>
              <UrlExtractor
                placeholder="https://your-portfolio.com or case study link"
                onExtract={(t) =>
                  updateForm({
                    portfolioText: t,
                    portfolioUrl: '',
                  })
                }
              />
              {form.portfolioText && (
                <textarea
                  value={form.portfolioText}
                  onChange={(e) => updateForm({ portfolioText: e.target.value })}
                  placeholder="Extracted portfolio text…"
                  className={`${textareaClass} h-24 focus:ring-blue-500 text-xs`}
                />
              )}
            </Field>
          </div>
        </div>
      </div>

      {/* Section 2 — Target */}
      <div className="p-8 bg-white border border-gray-200 rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
        <h3 className="text-xl font-serif font-bold text-blue-900 mb-6 flex items-center gap-2">
          <span className="flex items-center justify-center w-8 h-8 rounded-full bg-blue-100 text-blue-600 text-sm">2</span>
          The Target
        </h3>
        <div className="space-y-6">
          <div className="grid md:grid-cols-2 gap-6">
            <Field label="Target Company" required>
              <input
                value={form.targetCompany}
                onChange={(e) => updateForm({ targetCompany: e.target.value })}
                placeholder="e.g. OpenAI"
                className={inputClass}
              />
            </Field>
            <Field label="Target Country (Optional)">
              <input
                value={form.targetCountry}
                onChange={(e) => updateForm({ targetCountry: e.target.value })}
                placeholder="e.g. Vietnam, United States, Singapore"
                className={inputClass}
              />
            </Field>
          </div>
          <div className="grid md:grid-cols-2 gap-6">
            <Field label="Target Person Name (Optional)">
              <input
                value={form.targetPersonName}
                onChange={(e) => updateForm({ targetPersonName: e.target.value })}
                placeholder="e.g. Sam Altman"
                className={inputClass}
              />
            </Field>
            <Field label="Target Role" required>
              <input
                value={form.targetRole}
                onChange={(e) => updateForm({ targetRole: e.target.value })}
                placeholder="e.g. HR Manager, Head of Sales"
                className={inputClass}
              />
            </Field>
          </div>
          <Field label="Outreach Intent" required>
            <select
              value={form.intent}
              onChange={(e) => updateForm({ intent: e.target.value as OutreachIntent })}
              className={`${inputClass} bg-gray-50`}
            >
              {INTENT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Additional Context Links (Optional)">
            <p className="text-xs text-gray-500 mb-3">
              Add a title + URL for each piece of context (job description, recent article, mutual
              project, etc.). We&apos;ll extract the page content via Jina and use it both when
              re-ranking enrichment results and when generating the message.
            </p>
            <ManualContextManager
              contexts={form.manualContexts}
              onUpdate={(updater: (prev: ManualContextLink[]) => ManualContextLink[]) =>
                updateForm((prev: OutreachFormData) => ({
                  manualContexts: updater(prev.manualContexts),
                }))
              }
            />
          </Field>
        </div>
      </div>

      {/* Section 3 — Enrichment */}
      <EnrichmentPanel
        experienceLevel={form.experienceLevel}
        onChangeExperienceLevel={(level: ExperienceLevel) => updateForm({ experienceLevel: level })}
        enrichmentResults={form.enrichmentResults}
        selectedHiringCard={form.selectedHiringCard}
        selectedSocialCard={form.selectedSocialCard}
        onSelectHiring={(card: EnrichmentCard) => updateForm({ selectedHiringCard: card })}
        onSelectSocial={(card: EnrichmentCard) => updateForm({ selectedSocialCard: card })}
        onSearch={onEnrich}
        loading={enriching}
        error={enrichError}
        canSearch={canSearch}
      />

      {/* Section 4 — Output preferences */}
      <div className="p-8 bg-white border border-gray-200 rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
        <h3 className="text-xl font-serif font-bold text-blue-900 mb-4 flex items-center gap-2">
          <span className="flex items-center justify-center w-8 h-8 rounded-full bg-blue-100 text-blue-600 text-sm">4</span>
          What to generate
        </h3>
        <p className="ml-10 mb-4 text-sm text-gray-500">
          Pick which messages you want. Unselected ones are skipped to save tokens.
        </p>
        <div className="ml-10 flex flex-wrap gap-6">
          <label className="flex items-center gap-3 cursor-pointer">
            <Checkbox
              checked={form.outputs.email}
              onCheckedChange={(checked) =>
                updateForm({
                  outputs: { ...form.outputs, email: checked === true },
                })
              }
            />
            <span className="text-sm font-semibold text-blue-900">📧 Email</span>
          </label>
          <label className="flex items-center gap-3 cursor-pointer">
            <Checkbox
              checked={form.outputs.linkedIn}
              onCheckedChange={(checked) =>
                updateForm({
                  outputs: { ...form.outputs, linkedIn: checked === true },
                })
              }
            />
            <span className="text-sm font-semibold text-blue-900">💼 LinkedIn message</span>
          </label>
        </div>
        {!atLeastOneOutput && (
          <p className="ml-10 mt-3 text-xs text-red-500">Select at least one output.</p>
        )}
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-6 py-4 text-sm text-red-700 flex items-center gap-3 shadow-sm">
          <AlertTriangle className="w-5 h-5 flex-shrink-0" />
          {error}
        </div>
      )}

      <button
        onClick={onGenerate}
        disabled={!canSubmit}
        className="w-full px-6 py-5 bg-gradient-to-r from-yellow-500 to-yellow-400 text-blue-900 rounded-2xl text-lg font-bold hover:from-yellow-400 hover:to-yellow-300 transition-all shadow-lg hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3 transform hover:-translate-y-0.5"
      >
        {loading ? (
          <>
            <Loader className="w-6 h-6 animate-spin" /> Generating Magic...
          </>
        ) : (
          <>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-6 w-6"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            Generate Messages
          </>
        )}
      </button>
    </div>
  )
}

export function OutreachScreen() {
  const {
    form,
    updateForm,
    results,
    setResults,
    loading,
    error,
    generate,
    enrich,
    enriching,
    enrichError,
  } = useOutreach()

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div className="text-center mb-12">
        <h1 className="text-4xl sm:text-5xl font-serif font-extrabold text-blue-900 mb-4 tracking-tight">
          Recruitment Outreach Generator
        </h1>
        <p className="text-gray-600 text-lg sm:text-xl max-w-2xl mx-auto">
          Generate highly personalized, intent-driven outreach scripts instantly. Powered by Exa
          search for real-time hiring + social signals.
        </p>
      </div>

      {!results ? (
        <OutreachForm
          form={form}
          updateForm={updateForm}
          loading={loading}
          error={error}
          onGenerate={generate}
          onEnrich={enrich}
          enriching={enriching}
          enrichError={enrichError}
        />
      ) : (
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="mb-8 flex items-center justify-between bg-white p-4 rounded-xl border border-gray-100 shadow-sm">
            <button
              onClick={() => setResults(null)}
              className="px-4 py-2 text-yellow-600 font-semibold hover:bg-yellow-50 rounded-lg flex items-center gap-2 transition-colors"
            >
              &larr; Create Another
            </button>
            <div className="flex items-center gap-2 text-sm font-semibold text-white bg-gradient-to-r from-blue-900 to-blue-800 px-4 py-1.5 rounded-full shadow-inner">
              <CheckCircle2 className="h-4 w-4" />
              {results.intent
                .split('_')
                .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                .join(' ')}
            </div>
          </div>

          <div className="space-y-8">
            {results.linkedInMessage !== undefined && (
              <div className="bg-white rounded-2xl p-8 border border-gray-200 shadow-[0_8px_30px_rgb(0,0,0,0.04)] relative overflow-hidden">
                <div className="absolute top-0 left-0 w-1 h-full bg-blue-500" />
                <h3 className="text-xl font-serif font-bold text-blue-900 mb-6 flex items-center gap-2">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-blue-500"
                  >
                    <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"></path>
                    <rect x="2" y="9" width="4" height="12"></rect>
                    <circle cx="4" cy="4" r="2"></circle>
                  </svg>
                  LinkedIn Connection Note
                </h3>
                <div className="bg-gray-50 rounded-xl p-6 border border-gray-100 mb-6 text-base text-gray-800 leading-relaxed min-h-[100px]">
                  {results.linkedInMessage}
                </div>
                <div className="flex items-center justify-between">
                  <span
                    className={`text-xs font-bold px-3 py-1 rounded-full ${
                      results.linkedInMessage.length > 300
                        ? 'bg-red-100 text-red-600'
                        : 'bg-green-100 text-green-700'
                    }`}
                  >
                    {results.linkedInMessage.length}/300 characters
                  </span>
                  <CopyButton text={results.linkedInMessage} />
                </div>
              </div>
            )}

            {results.email && (
              <div className="bg-white rounded-2xl p-8 border border-gray-200 shadow-[0_8px_30px_rgb(0,0,0,0.04)] relative overflow-hidden">
                <div className="absolute top-0 left-0 w-1 h-full bg-yellow-500" />
                <h3 className="text-xl font-serif font-bold text-blue-900 mb-6 flex items-center gap-2">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-yellow-500"
                  >
                    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
                    <polyline points="22,6 12,13 2,6"></polyline>
                  </svg>
                  Email Version
                </h3>

                <div className="mb-8">
                  <p className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-3">Subject Line</p>
                  <div className="bg-gray-50 rounded-xl px-5 py-4 border border-gray-100 flex items-center justify-between gap-4">
                    <span className="text-base text-gray-900 font-semibold">{results.email.subject}</span>
                    <CopyButton text={results.email.subject} />
                  </div>
                </div>

                <div>
                  <p className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-3">Email Body</p>
                  <div className="bg-gray-50 rounded-xl p-6 border border-gray-100 mb-6 text-base text-gray-800 whitespace-pre-wrap leading-relaxed min-h-[200px]">
                    {results.email.body}
                  </div>
                  <div className="flex justify-end">
                    <CopyButton text={results.email.body} />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

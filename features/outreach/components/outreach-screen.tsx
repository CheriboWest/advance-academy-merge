'use client'

import { useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  Loader,
  Plus,
  Trash2,
} from 'lucide-react'
import { useOutreach } from '@/features/outreach/hooks/use-outreach'
import type { ExperienceEntry, OutreachFormData } from '@/features/outreach/types'

function Section({
  title,
  defaultOpen = false,
  children,
}: {
  title: string
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-6 py-4 bg-gray-50 hover:bg-gray-100 transition-colors"
      >
        <h3 className="text-lg font-serif font-semibold text-blue-900">{title}</h3>
        {open ? (
          <ChevronUp className="w-5 h-5 text-gray-500" />
        ) : (
          <ChevronDown className="w-5 h-5 text-gray-500" />
        )}
      </button>
      {open && <div className="px-6 py-5 space-y-4">{children}</div>}
    </div>
  )
}

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
      <label className="block text-sm font-semibold text-blue-900 mb-1.5">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  )
}

const inputClass =
  'w-full px-4 py-2.5 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-yellow-500 text-sm'
const textareaClass = `${inputClass} min-h-24 resize-y`

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
      className="px-4 py-2 bg-yellow-500 text-blue-900 rounded-lg font-medium hover:bg-yellow-400 transition-colors flex items-center gap-2 text-sm"
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

function TagInput({
  value,
  onChange,
  placeholder,
}: {
  value: string[]
  onChange: (tags: string[]) => void
  placeholder?: string
}) {
  const [input, setInput] = useState('')

  function handleKeyDown(event: React.KeyboardEvent) {
    if ((event.key === 'Enter' || event.key === ',') && input.trim()) {
      event.preventDefault()
      onChange([...value, input.trim()])
      setInput('')
    }
  }

  function remove(index: number) {
    onChange(value.filter((_, i) => i !== index))
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-2">
        {value.map((tag, index) => (
          <span
            key={`${tag}-${index}`}
            className="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-100 text-blue-900 rounded-md text-sm"
          >
            {tag}
            <button type="button" onClick={() => remove(index)} className="hover:text-red-600">
              <Trash2 className="w-3 h-3" />
            </button>
          </span>
        ))}
      </div>
      <input
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder ?? 'Type and press Enter to add'}
        className={inputClass}
      />
    </div>
  )
}

function ExperienceList({
  entries,
  onChange,
}: {
  entries: ExperienceEntry[]
  onChange: (entries: ExperienceEntry[]) => void
}) {
  function update(index: number, field: keyof ExperienceEntry, value: string) {
    const updated = entries.map((entry, i) => (i === index ? { ...entry, [field]: value } : entry))
    onChange(updated)
  }

  function add() {
    onChange([...entries, { title: '', company: '', description: '', duration: '' }])
  }

  function remove(index: number) {
    if (entries.length <= 1) return
    onChange(entries.filter((_, i) => i !== index))
  }

  return (
    <div className="space-y-4">
      {entries.map((entry, index) => (
        <div key={index} className="border border-gray-200 rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-gray-500">Experience {index + 1}</span>
            {entries.length > 1 && (
              <button
                type="button"
                onClick={() => remove(index)}
                className="text-red-500 hover:text-red-700"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <input
              placeholder="Job title"
              value={entry.title}
              onChange={(e) => update(index, 'title', e.target.value)}
              className={inputClass}
            />
            <input
              placeholder="Company"
              value={entry.company}
              onChange={(e) => update(index, 'company', e.target.value)}
              className={inputClass}
            />
          </div>
          <input
            placeholder="Duration (e.g., Jan 2020 - Present)"
            value={entry.duration}
            onChange={(e) => update(index, 'duration', e.target.value)}
            className={inputClass}
          />
          <textarea
            placeholder="Description"
            value={entry.description}
            onChange={(e) => update(index, 'description', e.target.value)}
            className={`${inputClass} min-h-16 resize-y`}
          />
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        className="flex items-center gap-2 text-sm font-medium text-yellow-600 hover:text-yellow-700"
      >
        <Plus className="w-4 h-4" /> Add Experience
      </button>
    </div>
  )
}

function OutreachForm({
  form,
  updateForm,
  loading,
  error,
  onGenerate,
}: {
  form: OutreachFormData
  updateForm: (updates: Partial<OutreachFormData>) => void
  loading: boolean
  error: string | null
  onGenerate: () => void
}) {
  const canSubmit =
    !loading &&
    form.headline &&
    form.about &&
    form.targetName &&
    form.targetCompany &&
    form.whyThisCompany &&
    form.roleTitle &&
    form.recruiterName &&
    form.desiredTitle &&
    form.desiredLocation

  return (
    <div className="space-y-4">
      <Section title="LinkedIn Profile" defaultOpen>
        <Field label="Headline" required>
          <input
            value={form.headline}
            onChange={(e) => updateForm({ headline: e.target.value })}
            placeholder="e.g., Senior Product Manager | B2B SaaS"
            className={inputClass}
          />
        </Field>
        <Field label="About" required>
          <textarea
            value={form.about}
            onChange={(e) => updateForm({ about: e.target.value })}
            placeholder="Paste your LinkedIn about section..."
            className={textareaClass}
          />
        </Field>
        <Field label="Experience">
          <ExperienceList
            entries={form.experience}
            onChange={(experience) => updateForm({ experience })}
          />
        </Field>
        <Field label="Skills">
          <TagInput
            value={form.skills}
            onChange={(skills) => updateForm({ skills })}
            placeholder="Type a skill and press Enter"
          />
        </Field>
        <Field label="Posts (optional)">
          <TagInput
            value={form.posts}
            onChange={(posts) => updateForm({ posts })}
            placeholder="Paste post excerpts, press Enter to add each"
          />
        </Field>
      </Section>

      <Section title="Target Company & Person">
        <div className="grid md:grid-cols-2 gap-4">
          <Field label="Contact Name" required>
            <input
              value={form.targetName}
              onChange={(e) => updateForm({ targetName: e.target.value })}
              placeholder="e.g., Sarah Chen"
              className={inputClass}
            />
          </Field>
          <Field label="Their Role">
            <input
              value={form.targetRole}
              onChange={(e) => updateForm({ targetRole: e.target.value })}
              placeholder="e.g., VP of Engineering"
              className={inputClass}
            />
          </Field>
          <Field label="Company" required>
            <input
              value={form.targetCompany}
              onChange={(e) => updateForm({ targetCompany: e.target.value })}
              placeholder="e.g., TechFlow Systems"
              className={inputClass}
            />
          </Field>
          <Field label="Industry">
            <input
              value={form.targetIndustry}
              onChange={(e) => updateForm({ targetIndustry: e.target.value })}
              placeholder="e.g., Enterprise SaaS"
              className={inputClass}
            />
          </Field>
        </div>
        <Field label="Why This Company" required>
          <textarea
            value={form.whyThisCompany}
            onChange={(e) => updateForm({ whyThisCompany: e.target.value })}
            placeholder="What specifically draws you to this company?"
            className={textareaClass}
          />
        </Field>
        <div className="grid md:grid-cols-2 gap-4">
          <Field label="Recent Activity">
            <input
              value={form.recentActivity}
              onChange={(e) => updateForm({ recentActivity: e.target.value })}
              placeholder="e.g., Posted about Series B funding"
              className={inputClass}
            />
          </Field>
          <Field label="Company Signal">
            <input
              value={form.companySignal}
              onChange={(e) => updateForm({ companySignal: e.target.value })}
              placeholder="e.g., Expanding to APAC market"
              className={inputClass}
            />
          </Field>
          <Field label="Hiring Manager">
            <input
              value={form.hiringManager}
              onChange={(e) => updateForm({ hiringManager: e.target.value })}
              placeholder="e.g., John Smith"
              className={inputClass}
            />
          </Field>
          <Field label="Hiring Manager Role">
            <input
              value={form.hiringManagerRole}
              onChange={(e) => updateForm({ hiringManagerRole: e.target.value })}
              placeholder="e.g., Director of Product"
              className={inputClass}
            />
          </Field>
        </div>
      </Section>

      <Section title="Role Details">
        <div className="grid md:grid-cols-2 gap-4">
          <Field label="Role Title" required>
            <input
              value={form.roleTitle}
              onChange={(e) => updateForm({ roleTitle: e.target.value })}
              placeholder="e.g., Senior Product Manager"
              className={inputClass}
            />
          </Field>
          <Field label="Department">
            <input
              value={form.department}
              onChange={(e) => updateForm({ department: e.target.value })}
              placeholder="e.g., Product"
              className={inputClass}
            />
          </Field>
        </div>
        <Field label="Key Requirements">
          <TagInput
            value={form.keyRequirements}
            onChange={(keyRequirements) => updateForm({ keyRequirements })}
            placeholder="Type a requirement and press Enter"
          />
        </Field>
        <Field label="Implied Pain">
          <textarea
            value={form.impliedPain}
            onChange={(e) => updateForm({ impliedPain: e.target.value })}
            placeholder="What problem is this role solving? e.g., Need to improve product-market fit for enterprise segment"
            className={textareaClass}
          />
        </Field>
      </Section>

      <Section title="Recruiter Info">
        <div className="grid md:grid-cols-2 gap-4">
          <Field label="Recruiter Name" required>
            <input
              value={form.recruiterName}
              onChange={(e) => updateForm({ recruiterName: e.target.value })}
              placeholder="e.g., Alex Rivera"
              className={inputClass}
            />
          </Field>
          <Field label="Recruiter Type">
            <select
              value={form.recruiterType}
              onChange={(e) =>
                updateForm({ recruiterType: e.target.value as 'agency' | 'in-house' })
              }
              className={inputClass}
            >
              <option value="agency">Agency</option>
              <option value="in-house">In-House</option>
            </select>
          </Field>
        </div>
        <Field label="Specialization">
          <input
            value={form.specialization}
            onChange={(e) => updateForm({ specialization: e.target.value })}
            placeholder="e.g., Tech leadership roles"
            className={inputClass}
          />
        </Field>
        <Field label="Active Roles">
          <TagInput
            value={form.activeRoles}
            onChange={(activeRoles) => updateForm({ activeRoles })}
            placeholder="Type a role title and press Enter"
          />
        </Field>
      </Section>

      <Section title="Your Desired Role">
        <div className="grid md:grid-cols-2 gap-4">
          <Field label="Desired Title" required>
            <input
              value={form.desiredTitle}
              onChange={(e) => updateForm({ desiredTitle: e.target.value })}
              placeholder="e.g., Senior Product Manager"
              className={inputClass}
            />
          </Field>
          <Field label="Location" required>
            <input
              value={form.desiredLocation}
              onChange={(e) => updateForm({ desiredLocation: e.target.value })}
              placeholder="e.g., San Francisco, CA / Remote"
              className={inputClass}
            />
          </Field>
        </div>
        <Field label="Salary Expectation">
          <input
            value={form.salaryExpectation}
            onChange={(e) => updateForm({ salaryExpectation: e.target.value })}
            placeholder="e.g., $180k-$220k"
            className={inputClass}
          />
        </Field>
      </Section>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <button
        onClick={onGenerate}
        disabled={!canSubmit}
        className="w-full px-6 py-3 bg-yellow-500 text-blue-900 rounded-lg font-semibold hover:bg-yellow-400 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {loading ? (
          <>
            <Loader className="w-4 h-4 animate-spin" /> Generating Outreach...
          </>
        ) : (
          'Generate Outreach Messages'
        )}
      </button>
    </div>
  )
}

export function OutreachScreen() {
  const { form, updateForm, results, setResults, loading, error, generate } = useOutreach()

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <h1 className="text-4xl font-serif font-bold text-blue-900 mb-4">
        Recruitment Outreach Generator
      </h1>
      <p className="text-gray-600 text-lg mb-8">
        Generate personalized outreach scripts to connect with recruiters.
      </p>

      {!results ? (
        <OutreachForm
          form={form}
          updateForm={updateForm}
          loading={loading}
          error={error}
          onGenerate={generate}
        />
      ) : (
        <div>
          <div className="mb-8">
            <button
              onClick={() => setResults(null)}
              className="px-4 py-2 text-yellow-600 font-medium hover:bg-yellow-50 rounded-lg"
            >
              &larr; Generate New Messages
            </button>
          </div>

          <div className="space-y-6">
            {/* LinkedIn Message */}
            <div className="bg-gray-50 rounded-xl p-8">
              <h3 className="text-xl font-serif font-semibold text-blue-900 mb-4">
                LinkedIn Message
              </h3>
              <div className="bg-white rounded-lg p-6 border border-gray-200 mb-4 text-sm text-gray-700">
                {results.linkedInMessage}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-400">
                  {results.linkedInMessage.length}/300 characters
                </span>
                <CopyButton text={results.linkedInMessage} />
              </div>
            </div>

            {/* Email */}
            <div className="bg-gray-50 rounded-xl p-8">
              <h3 className="text-xl font-serif font-semibold text-blue-900 mb-4">
                Cold Email
              </h3>

              <div className="mb-4">
                <p className="text-sm font-semibold text-blue-900 mb-2">Subject Line Options</p>
                <div className="space-y-2">
                  <div className="bg-white rounded-lg px-4 py-3 border border-gray-200 flex items-center gap-3">
                    <span className="text-xs font-medium text-yellow-600 bg-yellow-100 px-2 py-0.5 rounded">
                      Curiosity
                    </span>
                    <span className="text-sm text-gray-700">
                      {results.email.subjectLines.curiosity}
                    </span>
                    <CopyButton text={results.email.subjectLines.curiosity} />
                  </div>
                  <div className="bg-white rounded-lg px-4 py-3 border border-gray-200 flex items-center gap-3">
                    <span className="text-xs font-medium text-blue-600 bg-blue-100 px-2 py-0.5 rounded">
                      Specific
                    </span>
                    <span className="text-sm text-gray-700">
                      {results.email.subjectLines.specific}
                    </span>
                    <CopyButton text={results.email.subjectLines.specific} />
                  </div>
                  <div className="bg-white rounded-lg px-4 py-3 border border-gray-200 flex items-center gap-3">
                    <span className="text-xs font-medium text-gray-600 bg-gray-200 px-2 py-0.5 rounded">
                      Direct
                    </span>
                    <span className="text-sm text-gray-700">
                      {results.email.subjectLines.direct}
                    </span>
                    <CopyButton text={results.email.subjectLines.direct} />
                  </div>
                </div>
              </div>

              <div>
                <p className="text-sm font-semibold text-blue-900 mb-2">Email Body</p>
                <div className="bg-white rounded-lg p-6 border border-gray-200 mb-4 text-sm text-gray-700 whitespace-pre-wrap">
                  {results.email.body}
                </div>
                <div className="flex justify-end">
                  <CopyButton text={results.email.body} />
                </div>
              </div>
            </div>

            {/* Recruiter Pitch */}
            <div className="bg-gray-50 rounded-xl p-8">
              <h3 className="text-xl font-serif font-semibold text-blue-900 mb-4">
                Recruiter Pitch
              </h3>
              {results.recruiterPitch.warning && (
                <div className="mb-4 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                  {results.recruiterPitch.warning}
                </div>
              )}
              <div className="bg-white rounded-lg p-6 border border-gray-200 mb-4 text-sm text-gray-700 whitespace-pre-wrap">
                {results.recruiterPitch.pitch}
              </div>
              <div className="flex justify-end">
                <CopyButton text={results.recruiterPitch.pitch} />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Upload, Trash2, CheckCircle, ArrowLeft, AlertCircle } from 'lucide-react'

interface CvVersionSummary {
  id: string
  name: string
  detectedField: 'tech' | 'business' | 'marketing' | null
  isActive: boolean
  bulletCount: number
  openGapCount: number
  createdAt: string
}

interface BulletWithGaps {
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

export function CvLibraryScreen() {
  const [versions, setVersions] = useState<CvVersionSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/cv-library/versions')
      if (!res.ok) throw new Error('Failed to load CVs')
      setVersions(await res.json())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  if (selectedId) {
    return (
      <CvDetail
        versionId={selectedId}
        onBack={() => {
          setSelectedId(null)
          refresh()
        }}
      />
    )
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-4xl font-serif font-bold text-blue-900 mb-2">CV Library</h1>
        <p className="text-gray-600 text-lg">
          Upload a CV once. We&apos;ll extract every bullet, find the 5 most important missing details
          per bullet, and store the evidence you provide so future interviews can use it.
        </p>
      </div>

      <UploadCard onUploaded={refresh} />

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />
          <p className="text-red-700 text-sm">{error}</p>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-gray-500">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      ) : versions.length === 0 ? (
        <p className="text-gray-500 text-sm">No CVs yet. Upload one above to get started.</p>
      ) : (
        <div className="space-y-3">
          {versions.map((v) => (
            <div
              key={v.id}
              className="border border-gray-200 rounded-xl p-4 flex items-center justify-between bg-white"
            >
              <button onClick={() => setSelectedId(v.id)} className="flex-1 text-left">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-semibold text-blue-900">{v.name}</h3>
                  {v.isActive && (
                    <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 text-xs rounded-full font-medium">
                      Active
                    </span>
                  )}
                  {v.detectedField && (
                    <span className="px-2 py-0.5 bg-blue-50 text-blue-700 text-xs rounded-full">
                      {v.detectedField}
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-500">
                  {v.bulletCount} bullets · {v.openGapCount} gaps remaining
                </p>
              </button>
              <div className="flex items-center gap-2">
                {!v.isActive && (
                  <button
                    onClick={async () => {
                      await fetch(`/api/cv-library/versions/${v.id}/activate`, { method: 'POST' })
                      refresh()
                    }}
                    className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50"
                  >
                    Make active
                  </button>
                )}
                <button
                  onClick={async () => {
                    if (!confirm(`Delete "${v.name}"? This removes all its bullets, gaps, and artifacts.`))
                      return
                    await fetch(`/api/cv-library/versions/${v.id}`, { method: 'DELETE' })
                    refresh()
                  }}
                  className="p-2 text-gray-400 hover:text-red-600"
                  aria-label="Delete CV"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function UploadCard({ onUploaded }: { onUploaded: () => void }) {
  const [name, setName] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  const submit = async () => {
    if (!file || !name.trim()) return
    setBusy(true)
    setErr(null)
    setInfo(null)
    try {
      const fd = new FormData()
      fd.append('name', name.trim())
      fd.append('file', file)
      const res = await fetch('/api/cv-library/versions', { method: 'POST', body: fd })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error || data?.message || 'Upload failed')
      }
      const data = await res.json()
      setInfo(`Uploaded! ${data.bulletCount} bullets, ${data.gapCount} gaps generated.`)
      setName('')
      setFile(null)
      onUploaded()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-5 mb-6">
      <h2 className="text-sm font-semibold text-blue-900 mb-3">Upload a new CV</h2>
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder='Name this CV (e.g. "2025 SWE CV")'
          disabled={busy}
          className="flex-1 p-3 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-200"
        />
        <input
          type="file"
          accept=".pdf,.docx"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          disabled={busy}
          className="flex-1 p-2 text-sm bg-white border border-gray-200 rounded-xl"
        />
        <button
          onClick={submit}
          disabled={busy || !file || !name.trim()}
          className="flex items-center justify-center gap-2 px-5 py-3 bg-blue-900 text-white rounded-xl text-sm font-semibold hover:bg-blue-800 disabled:opacity-40"
        >
          {busy ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" /> Parsing CV…
            </>
          ) : (
            <>
              <Upload className="w-4 h-4" /> Upload
            </>
          )}
        </button>
      </div>
      {err && (
        <p className="mt-2 text-xs text-red-600 flex items-center gap-1.5">
          <AlertCircle className="w-3.5 h-3.5" /> {err}
        </p>
      )}
      {info && (
        <p className="mt-2 text-xs text-emerald-700 flex items-center gap-1.5">
          <CheckCircle className="w-3.5 h-3.5" /> {info}
        </p>
      )}
      <p className="mt-2 text-xs text-gray-500">
        Parsing usually takes 20-60s depending on CV length. PDF or DOCX only.
      </p>
    </div>
  )
}

function CvDetail({ versionId, onBack }: { versionId: string; onBack: () => void }) {
  const [bullets, setBullets] = useState<BulletWithGaps[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/cv-library/versions/${versionId}/bullets`)
      if (res.ok) setBullets(await res.json())
    } finally {
      setLoading(false)
    }
  }, [versionId])

  useEffect(() => {
    refresh()
  }, [refresh])

  const totalGaps = bullets.reduce((s, b) => s + b.gaps.length, 0)
  const filledGaps = bullets.reduce(
    (s, b) => s + b.gaps.filter((g) => g.status !== 'open').length,
    0,
  )

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <button
        onClick={onBack}
        className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-800 mb-4"
      >
        <ArrowLeft className="w-4 h-4" /> Back to library
      </button>
      <h1 className="text-3xl font-serif font-bold text-blue-900 mb-2">Fill in the gaps</h1>
      <p className="text-gray-600 mb-6">
        For each bullet on your CV, answer the 5 most important questions an interviewer would ask.
        Anything you fill in here will be reused automatically across every future interview prep
        session.
      </p>

      <div className="mb-6 p-3 bg-gray-50 rounded-xl text-sm">
        <strong>{filledGaps}</strong> of {totalGaps} gaps filled
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-gray-500">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading bullets…
        </div>
      ) : (
        <div className="space-y-6">
          {bullets.map((b) => (
            <BulletCard key={b.id} bullet={b} onChanged={refresh} />
          ))}
        </div>
      )}
    </div>
  )
}

function BulletCard({ bullet, onChanged }: { bullet: BulletWithGaps; onChanged: () => void }) {
  return (
    <div className="border border-gray-200 rounded-xl p-5 bg-white">
      {bullet.sectionPath && (
        <p className="text-xs text-gray-400 mb-1">{bullet.sectionPath}</p>
      )}
      <p className="text-sm font-medium text-gray-900 mb-4">&ldquo;{bullet.bulletText}&rdquo;</p>
      <div className="space-y-3">
        {bullet.gaps.map((g) => (
          <GapForm key={g.id} gap={g} onChanged={onChanged} />
        ))}
      </div>
    </div>
  )
}

function GapForm({
  gap,
  onChanged,
}: {
  gap: BulletWithGaps['gaps'][number]
  onChanged: () => void
}) {
  const [mode, setMode] = useState<'text' | 'url' | 'file'>('text')
  const [text, setText] = useState('')
  const [url, setUrl] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const submit = async () => {
    setBusy(true)
    setErr(null)
    try {
      let res: Response
      if (mode === 'file' && file) {
        const fd = new FormData()
        fd.append('file', file)
        res = await fetch(`/api/cv-library/gaps/${gap.id}/artifacts`, { method: 'POST', body: fd })
      } else if (mode === 'url' && url.trim()) {
        res = await fetch(`/api/cv-library/gaps/${gap.id}/artifacts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: url.trim() }),
        })
      } else if (mode === 'text' && text.trim()) {
        res = await fetch(`/api/cv-library/gaps/${gap.id}/artifacts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: text.trim() }),
        })
      } else {
        return
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error || 'Failed')
      }
      setText('')
      setUrl('')
      setFile(null)
      onChanged()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed')
    } finally {
      setBusy(false)
    }
  }

  const skip = async () => {
    setBusy(true)
    try {
      await fetch(`/api/cv-library/gaps/${gap.id}/skip`, { method: 'POST' })
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  const isAnswered = gap.status === 'answered'
  const isSkipped = gap.status === 'skipped'

  return (
    <div
      className={`border rounded-lg p-3 ${
        isAnswered ? 'border-emerald-200 bg-emerald-50/40' : isSkipped ? 'border-gray-200 bg-gray-50' : 'border-gray-200'
      }`}
    >
      <div className="flex items-start gap-2 mb-2">
        <span
          className={`mt-0.5 text-xs font-bold w-5 h-5 rounded-full flex items-center justify-center ${
            isAnswered
              ? 'bg-emerald-500 text-white'
              : isSkipped
                ? 'bg-gray-300 text-gray-600'
                : 'bg-yellow-400 text-blue-900'
          }`}
        >
          {gap.ordinal}
        </span>
        <div className="flex-1">
          <p className="text-sm font-medium text-gray-800">{gap.question}</p>
          {gap.rationale && <p className="text-xs text-gray-500 mt-0.5">{gap.rationale}</p>}
        </div>
      </div>

      {gap.artifacts.length > 0 && (
        <div className="mb-2 space-y-1">
          {gap.artifacts.map((a) => (
            <p key={a.id} className="text-xs text-emerald-700 line-clamp-2">
              ✓ {a.sourceType.toUpperCase()}: {a.contentText?.slice(0, 200) || a.sourceUrl || '(file)'}
            </p>
          ))}
        </div>
      )}

      {!isSkipped && (
        <>
          <div className="flex gap-1 mb-2">
            {(['text', 'url', 'file'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`px-2 py-1 text-xs rounded ${
                  mode === m ? 'bg-blue-900 text-white' : 'bg-gray-100 text-gray-600'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
          {mode === 'text' && (
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Type your answer…"
              rows={2}
              className="w-full p-2 text-sm border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-300"
            />
          )}
          {mode === 'url' && (
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://github.com/.../README.md or any public URL"
              className="w-full p-2 text-sm border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-300"
            />
          )}
          {mode === 'file' && (
            <input
              type="file"
              accept=".pdf,.docx"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="w-full p-1 text-sm"
            />
          )}
          {err && <p className="text-xs text-red-600 mt-1">{err}</p>}
          <div className="flex items-center gap-2 mt-2">
            <button
              onClick={submit}
              disabled={busy}
              className="px-3 py-1 text-xs bg-blue-900 text-white rounded font-medium hover:bg-blue-800 disabled:opacity-40"
            >
              {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Save'}
            </button>
            {!isAnswered && (
              <button
                onClick={skip}
                disabled={busy}
                className="text-xs text-gray-500 hover:text-gray-700"
              >
                Skip
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}

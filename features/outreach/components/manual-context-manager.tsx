'use client'

import { useState } from 'react'
import { AlertTriangle, CheckCircle2, Loader, Plus, Trash2 } from 'lucide-react'
import type { ManualContextLink } from '@/features/outreach/types'
import { extractOutreachSource } from '@/features/outreach/api/frontend-client'

interface ManualContextManagerProps {
  contexts: ManualContextLink[]
  onUpdate: (
    updater: (prev: ManualContextLink[]) => ManualContextLink[],
  ) => void
}

export function ManualContextManager({ contexts, onUpdate }: ManualContextManagerProps) {
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')

  async function addContext() {
    const trimmedTitle = title.trim()
    const trimmedUrl = url.trim()
    if (!trimmedTitle || !trimmedUrl) return

    const id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`

    const newLink: ManualContextLink = {
      id,
      title: trimmedTitle,
      url: trimmedUrl,
      status: 'loading',
      extractedText: '',
    }

    onUpdate((prev) => [...prev, newLink])
    setTitle('')
    setUrl('')

    try {
      const res = await extractOutreachSource(trimmedUrl)
      onUpdate((prev) =>
        prev.map((c) =>
          c.id === id
            ? { ...c, status: 'success', extractedText: res.text }
            : c,
        ),
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to extract'
      onUpdate((prev) =>
        prev.map((c) =>
          c.id === id ? { ...c, status: 'error', errorMessage: message } : c,
        ),
      )
    }
  }

  function removeContext(id: string) {
    onUpdate((prev) => prev.filter((c) => c.id !== id))
  }

  function updateExtractedText(id: string, text: string) {
    onUpdate((prev) =>
      prev.map((c) => (c.id === id ? { ...c, extractedText: text } : c)),
    )
  }

  return (
    <div className="space-y-4">
      {contexts.length > 0 && (
        <div className="space-y-3">
          {contexts.map((c) => (
            <div
              key={c.id}
              className="rounded-xl border border-gray-200 bg-gray-50 p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="rounded bg-blue-100 px-2 py-0.5 text-xs font-bold text-blue-800">
                      {c.title}
                    </span>
                    <a
                      href={c.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-blue-500 hover:underline truncate max-w-[260px]"
                    >
                      {c.url}
                    </a>
                    {c.status === 'loading' && (
                      <span className="inline-flex items-center gap-1 text-xs text-gray-500">
                        <Loader className="h-3 w-3 animate-spin" /> Extracting…
                      </span>
                    )}
                    {c.status === 'success' && (
                      <span className="inline-flex items-center gap-1 text-xs text-green-600">
                        <CheckCircle2 className="h-3 w-3" /> Extracted
                      </span>
                    )}
                    {c.status === 'error' && (
                      <span className="inline-flex items-center gap-1 text-xs text-red-500">
                        <AlertTriangle className="h-3 w-3" /> {c.errorMessage}
                      </span>
                    )}
                  </div>

                  {c.status === 'success' && (
                    <textarea
                      value={c.extractedText}
                      onChange={(e) => updateExtractedText(c.id, e.target.value)}
                      className="mt-2 w-full min-h-20 resize-y rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => removeContext(c.id)}
                  className="rounded p-1 text-red-500 hover:bg-red-50"
                  aria-label="Remove context"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="rounded-xl border border-dashed border-gray-300 bg-white p-4 space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">
          Add a context link
        </p>
        <div className="flex flex-col gap-3 md:flex-row">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title (e.g. Job Description)"
            className="md:w-1/3 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://..."
            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addContext()
              }
            }}
          />
          <button
            type="button"
            onClick={addContext}
            disabled={!title.trim() || !url.trim()}
            className="inline-flex items-center justify-center gap-1 rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" /> Add
          </button>
        </div>
      </div>
    </div>
  )
}

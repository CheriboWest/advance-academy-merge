'use client'

import { useState } from 'react'
import { Loader2, Plus, Sparkles, Trash2 } from 'lucide-react'
import type { CoachingSession, ContextGap, ContextReport } from '@advance-academy/contracts/coaching'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useCoachingAction, useUpdateCoachingSession } from '../hooks/use-coaching'

/**
 * The Context Desk (ticket T3.5 / T5).
 *
 * Shown when Stage 0 decided the booking was too thin to generate from. The
 * design point: the coach should only be here for the hard cases. A booking with
 * a real CV, a full JD and a findable company generates on its own and they
 * never see this screen — otherwise the tool has just moved the manual work
 * rather than removed it.
 *
 * Two things they can add, and only two, because they are the two that matter:
 * pages the research missed, and knowledge the system cannot derive.
 */

const SEVERITY_STYLE: Record<ContextGap['severity'], string> = {
  blocking: 'border-red-300 bg-red-50 text-red-900',
  important: 'border-yellow-300 bg-yellow-50 text-yellow-900',
  nice_to_have: 'border-gray-200 bg-gray-50 text-gray-700',
}

const SEVERITY_LABEL: Record<ContextGap['severity'], string> = {
  blocking: 'Blocking',
  important: 'Important',
  nice_to_have: 'Optional',
}

function GapList({ report }: { report: ContextReport }) {
  if (report.gaps.length === 0) {
    return (
      <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
        Nothing missing — this would have generated on its own.
      </p>
    )
  }
  return (
    <div className="space-y-2">
      {report.gaps.map((gap) => (
        <div key={gap.id} className={`rounded-md border p-3 ${SEVERITY_STYLE[gap.severity]}`}>
          <p className="text-xs font-semibold uppercase tracking-wide opacity-70">
            {SEVERITY_LABEL[gap.severity]}
          </p>
          <p className="mt-1 text-sm font-medium">{gap.label}</p>
          <p className="mt-0.5 text-sm opacity-80">→ {gap.action}</p>
        </div>
      ))}
    </div>
  )
}

export function ContextDesk({ session }: { session: CoachingSession }) {
  const update = useUpdateCoachingSession(session.id)
  const action = useCoachingAction(session.id)

  const [notes, setNotes] = useState(session.coachNotes ?? '')
  const [urls, setUrls] = useState<string[]>(session.contextRefs.extraUrls ?? [])
  const [draftUrl, setDraftUrl] = useState('')
  const [saved, setSaved] = useState(false)

  const report = session.contextReport as ContextReport | null
  const busy = update.isPending || action.isPending

  const addUrl = () => {
    const url = draftUrl.trim()
    if (!/^https?:\/\//i.test(url) || urls.includes(url)) return
    setUrls((prev) => [...prev, url].slice(0, 8))
    setDraftUrl('')
    setSaved(false)
  }

  const save = () =>
    update.mutate(
      { coachNotes: notes, extraUrls: urls },
      { onSuccess: () => setSaved(true) },
    )

  // Save before generating: the notes and URLs the coach just typed are the
  // whole reason to regenerate, and losing them to a click ordering bug would
  // burn four Sonnet calls producing the same thin pack again.
  const saveAndGenerate = () =>
    update.mutate(
      { coachNotes: notes, extraUrls: urls },
      { onSuccess: () => action.mutate({ action: 'generate', payload: { force: true } }) },
    )

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-yellow-300 bg-yellow-50 p-4">
        <h2 className="text-base font-semibold text-yellow-900">
          Not enough to build a pack from yet
        </h2>
        <p className="mt-1 text-sm text-yellow-900/80">
          Generation stopped before the expensive steps. Add what you can below, then generate.
        </p>
      </div>

      {report ? (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold">What is missing</h3>
          <GapList report={report} />
        </section>
      ) : null}

      <section className="space-y-3">
        <div>
          <Label htmlFor="extra-url">Pages to read</Label>
          <p className="text-xs text-muted-foreground">
            A careers page, a recent article, a founder interview — anything the search missed.
          </p>
        </div>
        <div className="flex gap-2">
          <Input
            id="extra-url"
            type="url"
            value={draftUrl}
            placeholder="https://…"
            onChange={(e) => setDraftUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addUrl()
              }
            }}
          />
          <Button type="button" variant="outline" onClick={addUrl} disabled={!draftUrl.trim()}>
            <Plus className="mr-1 h-4 w-4" />
            Add
          </Button>
        </div>
        {urls.length > 0 ? (
          <ul className="space-y-1">
            {urls.map((url) => (
              <li key={url} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate">{url}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setUrls((prev) => prev.filter((u) => u !== url))
                    setSaved(false)
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="space-y-2">
        <div>
          <Label htmlFor="coach-notes">Your notes on this student</Label>
          <p className="text-xs text-muted-foreground">
            Goes straight into the prompt. This is the only way to tell the pipeline something it
            cannot work out — &ldquo;she freezes on competency questions&rdquo;, &ldquo;I placed two
            people here last year&rdquo;.
          </p>
        </div>
        <Textarea
          id="coach-notes"
          rows={5}
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value)
            setSaved(false)
          }}
          placeholder="What do you already know about this student or this company that the tools cannot see?"
        />
      </section>

      {update.error || action.error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {((update.error ?? action.error) as Error).message}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={saveAndGenerate} disabled={busy}>
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
          Save and generate
        </Button>
        <Button variant="outline" onClick={save} disabled={busy}>
          Save only
        </Button>
        {saved ? <span className="text-sm text-green-700">Saved.</span> : null}
        <span className="text-xs text-muted-foreground">
          Generating runs four model calls and takes a few minutes.
        </span>
      </div>
    </div>
  )
}

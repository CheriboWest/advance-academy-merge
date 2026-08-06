'use client'

import { useState } from 'react'
import { CheckCircle2, Loader2, Plus, Trash2 } from 'lucide-react'
import type { ActionItem, CoachingSession, SessionNotes } from '@advance-academy/contracts/coaching'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useSaveSessionNotes, useSessionPractice } from '../hooks/use-coaching'

/**
 * What came out of the hour (ticket T6.5).
 *
 * This is what stops the tool being a document generator. A coaching
 * relationship runs over months; without a record, every session starts with the
 * coach reconstructing the last one from memory, which is the same manual work
 * the pack removed at the other end.
 *
 * `nextTime` is separate from `summary` on purpose: the summary is what
 * happened, and next time is the one thing the coach wants waiting for them when
 * they open this student again.
 */

/**
 * How the student did on the mock they ran against this pack (ticket T7).
 *
 * The reason a coach opens this before the session: knowing they scored 4/10 on
 * substance, or never practised at all, changes how the hour should be spent —
 * and it is knowledge that otherwise only surfaces halfway through it.
 */
function PracticeRuns({ sessionId }: { sessionId: string }) {
  const { data, isLoading } = useSessionPractice(sessionId)
  if (isLoading || !data) return null

  if (data.count === 0) {
    return (
      <section className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
        They have not practised these questions yet.
      </section>
    )
  }

  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold">Mock interviews on this pack ({data.count})</h3>
      {data.runs.map((run) => {
        const report = run.report as { overallIRS?: Record<string, { score?: number }> } | null
        const irs = report?.overallIRS ?? {}
        const scores = (['integrity', 'relevance', 'substance'] as const)
          .map((k) => (typeof irs[k]?.score === 'number' ? `${k} ${irs[k].score}` : null))
          .filter(Boolean)
        return (
          <div key={run.id} className="rounded-md border p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{run.label ?? 'Mock interview'}</span>
              <span className="text-xs text-muted-foreground">
                {new Date(run.createdAt).toLocaleString()}
              </span>
            </div>
            <p className="mt-0.5 text-muted-foreground">
              {scores.length > 0 ? scores.join(' · ') : 'No score recorded'}
            </p>
          </div>
        )
      })}
    </section>
  )
}

export function SessionNotesPanel({ session }: { session: CoachingSession }) {
  const save = useSaveSessionNotes(session.id)
  const existing = session.sessionNotes as SessionNotes | null

  const [summary, setSummary] = useState(existing?.summary ?? '')
  const [nextTime, setNextTime] = useState(existing?.nextTime ?? '')
  const [items, setItems] = useState<ActionItem[]>(existing?.actionItems ?? [])
  const [draft, setDraft] = useState('')

  const addItem = () => {
    const text = draft.trim()
    if (!text) return
    setItems((prev) => [...prev, { text, done: false }].slice(0, 20))
    setDraft('')
  }

  const persist = (markDone = false) =>
    save.mutate({ summary, nextTime, actionItems: items, markDone })

  const canFinish = session.status === 'approved'

  return (
    <div className="space-y-6">
      {session.status === 'done' ? (
        <div className="flex items-center gap-2 rounded-md border border-green-300 bg-green-50 p-3 text-sm text-green-900">
          <CheckCircle2 className="h-4 w-4" />
          This session is marked as done.
        </div>
      ) : null}

      <PracticeRuns sessionId={session.id} />

      <section className="space-y-2">
        <Label htmlFor="notes-summary">How did it go?</Label>
        <Textarea
          id="notes-summary"
          rows={6}
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="What you covered, what landed, what they struggled with."
        />
      </section>

      <section className="space-y-2">
        <div>
          <Label>Action items</Label>
          <p className="text-xs text-muted-foreground">
            What they agreed to do before the interview. Tick them off next time.
          </p>
        </div>
        <div className="flex gap-2">
          <Input
            value={draft}
            placeholder="Complete one SQL exercise on Mode…"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addItem()
              }
            }}
          />
          <Button type="button" variant="outline" onClick={addItem} disabled={!draft.trim()}>
            <Plus className="mr-1 h-4 w-4" />
            Add
          </Button>
        </div>
        {items.length > 0 ? (
          <ul className="space-y-1">
            {items.map((item, i) => (
              <li key={i} className="flex items-center gap-2 rounded-md border px-3 py-2">
                <Checkbox
                  checked={item.done}
                  onCheckedChange={() =>
                    setItems((prev) =>
                      prev.map((x, idx) => (idx === i ? { ...x, done: !x.done } : x)),
                    )
                  }
                />
                <span
                  className={`min-w-0 flex-1 text-sm ${item.done ? 'text-muted-foreground line-through' : ''}`}
                >
                  {item.text}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setItems((prev) => prev.filter((_, idx) => idx !== i))}
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
          <Label htmlFor="notes-next">For next time</Label>
          <p className="text-xs text-muted-foreground">
            Waiting for you when you open this student again.
          </p>
        </div>
        <Textarea
          id="notes-next"
          rows={3}
          value={nextTime}
          onChange={(e) => setNextTime(e.target.value)}
          placeholder="Start with the competency answers — she still rushes them."
        />
      </section>

      {save.error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {(save.error as Error).message}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" onClick={() => persist(false)} disabled={save.isPending}>
          {save.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
          Save notes
        </Button>
        {canFinish ? (
          <Button onClick={() => persist(true)} disabled={save.isPending}>
            <CheckCircle2 className="mr-1 h-4 w-4" />
            Save and mark done
          </Button>
        ) : null}
        {save.isSuccess ? <span className="text-sm text-green-700">Saved.</span> : null}
        {existing?.savedAt ? (
          <span className="ml-auto text-xs text-muted-foreground">
            Last saved {new Date(existing.savedAt).toLocaleString()}
          </span>
        ) : null}
      </div>
    </div>
  )
}

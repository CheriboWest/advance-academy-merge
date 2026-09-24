'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CalendarClock, CheckCircle2, Info, Loader2 } from 'lucide-react'
import type { CreateCoachingSessionRequest } from '@advance-academy/contracts/coaching'
import { HttpClientError } from '@/shared/api/http-client'
import { useAccount } from '@/shared/hooks/use-account'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { useBookCoachingSession, useCoachingContext, useCoachingSessions } from '../hooks/use-coaching'
import { ContextPicker, defaultSelection, type ContextSelection } from './context-picker'
import { StudentPack } from './student-pack'

/**
 * Booking a coaching session (ticket T2).
 *
 * The whole student-facing surface of the coaching tool. Everything after this
 * belongs to the coach, so the form is written to collect the things a coach
 * cannot get any other way — the JD, which round it is, who is running it, and
 * what the student is actually afraid of — and to reuse everything the app
 * already holds rather than asking for it twice.
 */

const MAX_SLOTS = 3

/** Empty strings so the inputs stay controlled from the first render. */
const EMPTY_FORM = {
  companyName: '',
  companyUrl: '',
  jdText: '',
  stage: '',
  interviewerRole: '',
  worryText: '',
  interviewAt: '',
}

function FieldHint({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-muted-foreground">{children}</p>
}

function Section({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <section className="space-y-4 rounded-lg border p-5">
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        {description ? <p className="mt-0.5 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </section>
  )
}

export function CoachingScreen() {
  const router = useRouter()
  const { data: account } = useAccount()
  const { data: context, isLoading: contextLoading, error: contextError } = useCoachingContext()
  const { data: sessionList } = useCoachingSessions()
  const book = useBookCoachingSession()

  const [form, setForm] = useState(EMPTY_FORM)
  const [slots, setSlots] = useState<string[]>([''])
  const [selection, setSelection] = useState<ContextSelection | null>(null)
  const [openSessionId, setOpenSessionId] = useState<string | null>(null)

  // Seed the picker once the inventory lands. Guarded on `selection` being null
  // so a background refetch never silently un-ticks a choice mid-form.
  useEffect(() => {
    if (context?.inventory && selection === null) {
      setSelection(defaultSelection(context.inventory))
    }
  }, [context, selection])

  const set = (key: keyof typeof EMPTY_FORM) => (value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }))

  const isAdmin = account?.isAdmin ?? false
  const quota = account?.coachingCredits ?? null
  // Admins book on students' behalf and are never metered, so `null` here means
  // unlimited rather than unknown.
  const outOfQuota = !isAdmin && quota !== null && quota < 1
  const notMembership = !isAdmin && account?.tier === 'trial'

  const canSubmit = useMemo(
    () => form.companyName.trim().length > 0 && form.jdText.trim().length >= 40,
    [form.companyName, form.jdText],
  )

  const bookingError =
    book.error instanceof HttpClientError
      ? book.error.payload.message
      : book.error instanceof Error
        ? book.error.message
        : null

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    const body: CreateCoachingSessionRequest = {
      companyName: form.companyName.trim(),
      jdText: form.jdText.trim(),
      ...(form.companyUrl.trim() ? { companyUrl: form.companyUrl.trim() } : {}),
      ...(form.stage.trim() ? { stage: form.stage.trim() } : {}),
      ...(form.interviewerRole.trim() ? { interviewerRole: form.interviewerRole.trim() } : {}),
      ...(form.worryText.trim() ? { worryText: form.worryText.trim() } : {}),
      // datetime-local gives a local wall-clock string; the backend normalises it.
      ...(form.interviewAt ? { interviewAt: new Date(form.interviewAt).toISOString() } : {}),
      proposedSlots: slots.filter(Boolean).map((s) => new Date(s).toISOString()),
      ...(selection
        ? {
            contextRefs: {
              cvVersionId: selection.cvVersionId,
              toolResultIds: selection.toolResultIds,
              cvAnalysisJobIds: selection.cvAnalysisJobIds,
            },
          }
        : {}),
    }
    book.mutate(body)
  }

  // ── Reading an approved pack ──
  if (openSessionId) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-8">
        <StudentPack
          sessionId={openSessionId}
          onBack={() => setOpenSessionId(null)}
          // Hand the session to the Interview Lab through the URL (ticket T7).
          // The setup step reads `?coaching=` and fetches the context from it,
          // so the pack itself never has to be carried through client state.
          onPractise={(id) => router.push(`/?view=interview&coaching=${encodeURIComponent(id)}`)}
        />
      </main>
    )
  }

  // ── Booked ──
  if (book.isSuccess) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-16 text-center">
        <CheckCircle2 className="mx-auto h-12 w-12 text-green-600" />
        <h1 className="mt-4 text-2xl font-semibold">Your session is booked</h1>
        <p className="mt-2 text-muted-foreground">
          Your coach will prepare for it and confirm a time with you. You will see the prep once
          they have reviewed it.
        </p>
        <Button className="mt-6" variant="outline" onClick={() => book.reset()}>
          Book another
        </Button>
      </main>
    )
  }

  // ── Gated ──
  if (notMembership) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-16 text-center">
        <CalendarClock className="mx-auto h-12 w-12 text-muted-foreground" />
        <h1 className="mt-4 text-2xl font-semibold">Coaching is part of Mentorship</h1>
        <p className="mt-2 text-muted-foreground">
          One-to-one sessions with a coach are included with Mentorship. Upgrade your account to
          book one.
        </p>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Book a coaching session</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Tell your coach about the interview and they will come prepared — company research, the
          questions you are likely to get, and how to answer them from your own experience.
        </p>
        <p className="mt-2 text-sm">
          {isAdmin ? (
            <span className="text-muted-foreground">Admin — sessions are not metered for you.</span>
          ) : (
            <span className={outOfQuota ? 'text-destructive' : 'text-muted-foreground'}>
              {quota === null ? '' : `${quota} session${quota === 1 ? '' : 's'} left on your plan.`}
            </span>
          )}
        </p>
      </header>

      {sessionList && sessionList.sessions.length > 0 ? (
        <section className="mb-8 space-y-2">
          <h2 className="text-base font-semibold">Your sessions</h2>
          <div className="space-y-2">
            {sessionList.sessions.map((s) => {
              // A pack only exists for the student once the coach approves it,
              // so anything earlier is deliberately not clickable.
              const readable = s.status === 'approved' || s.status === 'done'
              return (
                <button
                  key={s.id}
                  type="button"
                  disabled={!readable}
                  onClick={() => setOpenSessionId(s.id)}
                  className={`flex w-full items-center gap-3 rounded-md border p-3 text-left transition-colors ${
                    readable ? 'hover:bg-muted/50' : 'cursor-default opacity-70'
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {s.companyName}
                  </span>
                  {s.interviewAt ? (
                    <span className="whitespace-nowrap text-xs text-muted-foreground">
                      {new Date(s.interviewAt).toLocaleDateString()}
                    </span>
                  ) : null}
                  <span
                    className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${
                      readable ? 'bg-green-100 text-green-800' : 'bg-card text-muted-foreground'
                    }`}
                  >
                    {readable ? 'Ready to read' : 'Your coach is preparing it'}
                  </span>
                </button>
              )
            })}
          </div>
        </section>
      ) : null}

      <form onSubmit={handleSubmit} className="space-y-6">
        <Section
          title="The interview"
          description="The job description is what the whole pack is built against, so paste all of it."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="companyName">Company *</Label>
              <Input
                id="companyName"
                value={form.companyName}
                onChange={(e) => set('companyName')(e.target.value)}
                placeholder="Monzo Bank"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="companyUrl">Company website</Label>
              <Input
                id="companyUrl"
                type="url"
                value={form.companyUrl}
                onChange={(e) => set('companyUrl')(e.target.value)}
                placeholder="https://monzo.com"
              />
              <FieldHint>Without this, the research has nothing first-hand to read.</FieldHint>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="jdText">Job description *</Label>
            <Textarea
              id="jdText"
              value={form.jdText}
              onChange={(e) => set('jdText')(e.target.value)}
              rows={8}
              placeholder="Paste the full advert — responsibilities, requirements, everything."
              required
            />
            <FieldHint>
              {form.jdText.trim().length} characters. Under 400 and your coach will be asked to fill
              in the gaps by hand.
            </FieldHint>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="stage">Which round?</Label>
              <Input
                id="stage"
                value={form.stage}
                onChange={(e) => set('stage')(e.target.value)}
                placeholder="Final round"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="interviewerRole">Who is interviewing you?</Label>
              <Input
                id="interviewerRole"
                value={form.interviewerRole}
                onChange={(e) => set('interviewerRole')(e.target.value)}
                placeholder="Head of Data"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="interviewAt">Interview date</Label>
              <Input
                id="interviewAt"
                type="datetime-local"
                value={form.interviewAt}
                onChange={(e) => set('interviewAt')(e.target.value)}
              />
            </div>
          </div>
          <FieldHint>
            The round and the interviewer decide which questions you get — worth filling in.
          </FieldHint>
        </Section>

        <Section
          title="What worries you most?"
          description="One or two lines. This is the single answer that most often decides where the hour goes."
        >
          <Textarea
            value={form.worryText}
            onChange={(e) => set('worryText')(e.target.value)}
            rows={3}
            placeholder="I freeze when they ask about a time I failed, and I have no idea how to explain my career gap."
          />
        </Section>

        <Section
          title="What your coach should look at"
          description="Everything you have already done in the app. Nothing to upload again."
        >
          {contextLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : contextError ? (
            <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              Could not load your previous work. You can still book — your coach will ask for what
              they need.
            </p>
          ) : context && selection ? (
            <ContextPicker
              inventory={context.inventory}
              selection={selection}
              onChange={setSelection}
            />
          ) : null}
        </Section>

        <Section
          title="When are you free?"
          description="Offer a few windows and your coach will confirm one."
        >
          <div className="space-y-2">
            {slots.map((slot, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  type="datetime-local"
                  value={slot}
                  onChange={(e) =>
                    setSlots((prev) => prev.map((s, idx) => (idx === i ? e.target.value : s)))
                  }
                />
                {slots.length > 1 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setSlots((prev) => prev.filter((_, idx) => idx !== i))}
                  >
                    Remove
                  </Button>
                ) : null}
              </div>
            ))}
            {slots.length < MAX_SLOTS ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setSlots((prev) => [...prev, ''])}
              >
                Add another time
              </Button>
            ) : null}
          </div>
        </Section>

        {bookingError ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
            {bookingError}
          </div>
        ) : null}

        {outOfQuota ? (
          <div className="flex gap-2 rounded-md border border-yellow-500/40 bg-yellow-50 p-4 text-sm text-yellow-900">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              You have used the coaching session included with your Mentorship. Ask your coach if
              you need another.
            </span>
          </div>
        ) : null}

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={!canSubmit || outOfQuota || book.isPending}>
            {book.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Booking…
              </>
            ) : (
              'Book the session'
            )}
          </Button>
          {!canSubmit ? (
            <span className="text-xs text-muted-foreground">
              A company and a job description are needed.
            </span>
          ) : null}
        </div>
      </form>
    </main>
  )
}

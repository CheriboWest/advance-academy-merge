'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { CoachingSessionStatus, CoachingSessionSummary } from '@advance-academy/contracts/coaching'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useCoachingSessions } from '../hooks/use-coaching'

/**
 * The coach's queue and month calendar (ticket T2.5).
 *
 * Ordered by the student's real interview date, not by when they booked. A
 * session for Thursday matters more than one booked yesterday for next month,
 * and sorting by booking order buries exactly the case that is about to expire.
 *
 * The calendar is a CSS grid rather than a date-picker library: it shows booked
 * sessions and links to them, which is all a one-person coaching operation needs.
 * Clash detection is deliberately absent — the coach can see the clash.
 */

const STATUS_STYLE: Record<CoachingSessionStatus, { label: string; className: string }> = {
  draft: { label: 'Booked', className: 'bg-card text-foreground' },
  generating: { label: 'Generating…', className: 'bg-primary/10 text-primary' },
  context_needed: { label: 'Needs context', className: 'bg-secondary/15 text-highlight-ink' },
  ready: { label: 'Ready to review', className: 'bg-purple-100 text-purple-900' },
  failed: { label: 'Failed', className: 'bg-red-100 text-red-800' },
  approved: { label: 'Approved', className: 'bg-green-100 text-green-800' },
  done: { label: 'Done', className: 'bg-card text-muted-foreground' },
  cancelled: { label: 'Cancelled', className: 'bg-card text-subtle-foreground' },
}

/** Sessions still needing the coach, most urgent first. */
const OPEN_STATUSES: CoachingSessionStatus[] = ['draft', 'generating', 'context_needed', 'ready', 'failed']

function StatusBadge({ status }: { status: CoachingSessionStatus }) {
  const style = STATUS_STYLE[status] ?? STATUS_STYLE.draft
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${style.className}`}>{style.label}</span>
}

function daysUntil(iso: string | null): number | null {
  if (!iso) return null
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return null
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  return Math.round((startOfDay(then) - startOfDay(new Date())) / 86_400_000)
}

/** "in 3 days" / "tomorrow" / "2 days ago" — the number the coach actually reads. */
function urgency(iso: string | null): { text: string; className: string } | null {
  const days = daysUntil(iso)
  if (days === null) return null
  if (days < 0) return { text: `${Math.abs(days)}d ago`, className: 'text-muted-foreground' }
  if (days === 0) return { text: 'today', className: 'text-red-600 font-semibold' }
  if (days === 1) return { text: 'tomorrow', className: 'text-red-600 font-semibold' }
  if (days <= 3) return { text: `in ${days} days`, className: 'text-orange-600 font-medium' }
  return { text: `in ${days} days`, className: 'text-muted-foreground' }
}

function QueueRow({ session }: { session: CoachingSessionSummary }) {
  const when = urgency(session.interviewAt)
  return (
    <Link
      href={`/admin/coaching/${session.id}`}
      className="flex flex-wrap items-center gap-3 rounded-md border p-3 transition-colors hover:bg-muted/50"
    >
      <StatusBadge status={session.status} />
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{session.companyName}</span>
      {session.stage ? (
        <Badge variant="secondary" className="text-[10px]">
          {session.stage}
        </Badge>
      ) : null}
      <span className={`whitespace-nowrap text-xs ${when?.className ?? 'text-muted-foreground'}`}>
        {when ? `Interview ${when.text}` : 'No interview date'}
      </span>
    </Link>
  )
}

// ── Month grid ──────────────────────────────────────────────────────────────

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** Monday-first offset for the 1st of the month. */
function leadingBlanks(year: number, month: number): number {
  return (new Date(year, month, 1).getDay() + 6) % 7
}

function sameDay(iso: string | null, year: number, month: number, day: number): boolean {
  if (!iso) return false
  const d = new Date(iso)
  return d.getFullYear() === year && d.getMonth() === month && d.getDate() === day
}

function MonthCalendar({ sessions }: { sessions: CoachingSessionSummary[] }) {
  const today = new Date()
  const [cursor, setCursor] = useState({ year: today.getFullYear(), month: today.getMonth() })

  const daysInMonth = new Date(cursor.year, cursor.month + 1, 0).getDate()
  const blanks = leadingBlanks(cursor.year, cursor.month)

  const shift = (delta: number) => {
    const next = new Date(cursor.year, cursor.month + delta, 1)
    setCursor({ year: next.getFullYear(), month: next.getMonth() })
  }

  const monthLabel = new Date(cursor.year, cursor.month, 1).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  })

  return (
    <div className="rounded-lg border p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold">{monthLabel}</h2>
        <div className="flex gap-1">
          <Button variant="outline" size="sm" onClick={() => shift(-1)} aria-label="Previous month">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCursor({ year: today.getFullYear(), month: today.getMonth() })}
          >
            Today
          </Button>
          <Button variant="outline" size="sm" onClick={() => shift(1)} aria-label="Next month">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-xs text-muted-foreground">
        {WEEKDAYS.map((d) => (
          <div key={d} className="py-1 font-medium">
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: blanks }).map((_, i) => (
          <div key={`blank-${i}`} />
        ))}
        {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((day) => {
          const isToday =
            cursor.year === today.getFullYear() &&
            cursor.month === today.getMonth() &&
            day === today.getDate()
          // Both dates land on the grid: the coaching slot is when the coach is
          // busy, the interview is the deadline they are working towards.
          const onDay = sessions.filter(
            (s) =>
              sameDay(s.scheduledAt, cursor.year, cursor.month, day) ||
              sameDay(s.interviewAt, cursor.year, cursor.month, day),
          )
          return (
            <div
              key={day}
              className={`min-h-20 rounded-md border p-1 text-left ${
                isToday ? 'border-primary bg-primary/5' : 'border-transparent bg-muted/30'
              }`}
            >
              <div className={`text-xs ${isToday ? 'font-bold text-primary' : 'text-muted-foreground'}`}>
                {day}
              </div>
              <div className="mt-0.5 space-y-0.5">
                {onDay.slice(0, 3).map((s) => {
                  const isCoaching = sameDay(s.scheduledAt, cursor.year, cursor.month, day)
                  return (
                    <Link
                      key={`${s.id}-${isCoaching ? 'c' : 'i'}`}
                      href={`/admin/coaching/${s.id}`}
                      title={`${isCoaching ? 'Coaching session' : 'Interview'} · ${s.companyName}`}
                      className={`block truncate rounded px-1 py-0.5 text-[10px] leading-tight ${
                        isCoaching
                          ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                          : 'bg-secondary/25 text-highlight-ink hover:bg-secondary/90'
                      }`}
                    >
                      {s.companyName}
                    </Link>
                  )
                })}
                {onDay.length > 3 ? (
                  <div className="px-1 text-[10px] text-muted-foreground">+{onDay.length - 3} more</div>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>

      <div className="mt-3 flex gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded bg-primary" /> coaching session
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded bg-secondary/25" /> their interview
        </span>
      </div>
    </div>
  )
}

export function CoachQueue() {
  const { data, isLoading, error } = useCoachingSessions('all')
  const sessions = useMemo(() => data?.sessions ?? [], [data])

  const open = useMemo(
    () =>
      sessions
        .filter((s) => OPEN_STATUSES.includes(s.status))
        .sort((a, b) => {
          // No interview date sinks to the bottom: there is no deadline to miss.
          const av = a.interviewAt ? new Date(a.interviewAt).getTime() : Number.MAX_SAFE_INTEGER
          const bv = b.interviewAt ? new Date(b.interviewAt).getTime() : Number.MAX_SAFE_INTEGER
          return av - bv
        }),
    [sessions],
  )
  const settled = useMemo(() => sessions.filter((s) => !OPEN_STATUSES.includes(s.status)), [sessions])

  if (error) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/5 p-6 text-sm text-destructive">
        Could not load the coaching queue: {(error as Error).message}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h2 className="text-base font-semibold">
          Needs you {open.length > 0 ? `(${open.length})` : ''}
        </h2>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : open.length === 0 ? (
          <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
            Nothing waiting. Bookings appear here the moment a student submits one.
          </p>
        ) : (
          <div className="space-y-2">
            {open.map((s) => (
              <QueueRow key={s.id} session={s} />
            ))}
          </div>
        )}
      </section>

      <MonthCalendar sessions={sessions} />

      {settled.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-base font-semibold">Settled ({settled.length})</h2>
          <div className="space-y-2">
            {settled.map((s) => (
              <QueueRow key={s.id} session={s} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}

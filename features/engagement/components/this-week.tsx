'use client'

import Link from 'next/link'
import { CalendarClock, CheckCircle2, Circle, Trophy } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { useJobBoardSummary, useSavedJobs } from '@/features/job-tracking/hooks/use-job-tracking'
import { useEngagement, useSetEmailReminders } from '../hooks/use-engagement'

/**
 * Home dashboard block: this week's tasks, points, and follow-ups due.
 * Tasks tick themselves off from real activity; there is nothing to check by
 * hand. Points use a trophy, never the coin icon — they are a score, not credits.
 */
export function ThisWeek() {
  const { data, isLoading, error } = useEngagement()
  const { data: jobs } = useSavedJobs()
  const { followUpsDue } = useJobBoardSummary(jobs?.jobs)
  const setReminders = useSetEmailReminders()

  if (isLoading) return <Skeleton className="h-64 w-full rounded-xl" />
  if (error || !data) {
    return <p className="text-sm text-muted-foreground">Your weekly goals are unavailable right now.</p>
  }

  const doneCount = data.tasks.filter((t) => t.done).length

  return (
    <section aria-labelledby="this-week" className="rounded-xl border bg-background p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="this-week" className="font-serif text-2xl font-semibold text-primary">
            This week
          </h2>
          <p className="text-sm text-muted-foreground">
            {doneCount} of {data.tasks.length} goals done. They tick off as you go.
          </p>
        </div>
        <span
          className="inline-flex items-center gap-1.5 rounded-full bg-secondary/15 px-3 py-1.5 text-sm font-medium text-primary"
          title="Points for finished goals. Not credits — they can't be spent."
        >
          <Trophy className="h-4 w-4 text-highlight-ink" />
          {data.pointsThisWeek} pts this week · {data.pointsTotal} total
        </span>
      </div>

      {followUpsDue.length > 0 ? (
        <Link
          href="/jobs"
          className="mt-4 flex items-center gap-2 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-900 hover:bg-orange-100"
        >
          <CalendarClock className="h-4 w-4 shrink-0" />
          {followUpsDue.length === 1
            ? `Follow up on ${followUpsDue[0].title} today`
            : `${followUpsDue.length} follow-ups due`}
        </Link>
      ) : null}

      <ul className="mt-4 space-y-3">
        {data.tasks.map((task) => (
          <li key={task.key} className="flex items-center gap-3">
            {task.done ? (
              <CheckCircle2 className="h-5 w-5 shrink-0 text-green-700" aria-label="Done" />
            ) : (
              <Circle className="h-5 w-5 shrink-0 text-muted-foreground" aria-label="Not done yet" />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                {task.done ? (
                  <span className="text-sm text-muted-foreground line-through">{task.title}</span>
                ) : (
                  <Link href={task.href} className="text-sm font-medium text-primary hover:underline">
                    {task.title}
                  </Link>
                )}
                <span className="text-xs tabular-nums text-muted-foreground">
                  {task.progress}/{task.target} · +{task.points} pts
                </span>
              </div>
              {task.target > 1 ? (
                <div
                  className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={task.target}
                  aria-valuenow={task.progress}
                  aria-label={task.title}
                >
                  <div className="h-full bg-primary" style={{ width: `${(task.progress / task.target) * 100}%` }} />
                </div>
              ) : null}
            </div>
          </li>
        ))}
      </ul>

      <label className="mt-5 flex items-center gap-2 text-sm text-muted-foreground">
        <input
          type="checkbox"
          checked={data.emailReminders}
          disabled={setReminders.isPending}
          onChange={(e) => setReminders.mutate(e.target.checked)}
          className="h-4 w-4 accent-primary"
        />
        Email me when goals are still open on Friday, and on follow-up days
      </label>
    </section>
  )
}

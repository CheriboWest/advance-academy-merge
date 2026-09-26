'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  Brain,
  CalendarClock,
  Check,
  ClipboardList,
  Copy,
  ExternalLink,
  FileSignature,
  History,
  MapPin,
  Pencil,
  Trash2,
} from 'lucide-react'
import {
  SAVED_JOB_STATUSES,
  SAVED_JOB_STATUS_LABELS,
  type SavedJob,
  type SavedJobStatus,
} from '@advance-academy/contracts/job-tracking'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Skeleton } from '@/components/ui/skeleton'
import {
  todayLocalDay,
  useChangeSavedJobStatus,
  useDeleteSavedJob,
  useSavedJob,
} from '../hooks/use-job-tracking'
import { JobStatusBadge, STATUS_TONE } from './job-status-badge'

const SOURCE_LABEL: Record<SavedJob['source'], string> = {
  manual: 'Added by you',
  dream_company: 'Dream Company',
  career_hub: 'Career Hub',
}

function formatDay(day: string | null): string | null {
  if (!day) return null
  const d = new Date(`${day}T12:00:00`)
  return Number.isNaN(d.getTime()) ? day : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '')
  } catch {
    return url
  }
}

/** The letter written for this job, folded away until asked for. */
function CoverLetterPanel({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard blocked: the text is on screen to select by hand.
    }
  }
  return (
    <details className="mt-3 rounded-md bg-card p-3 text-sm">
      <summary className="cursor-pointer font-medium">
        <FileSignature className="mr-1.5 inline h-3.5 w-3.5" />
        Cover letter
      </summary>
      <p className="mt-2 whitespace-pre-wrap font-serif leading-relaxed">{text}</p>
      <Button variant="outline" size="sm" className="mt-2" onClick={copy}>
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </details>
  )
}

/** Status changes and the creation event, newest first. Fetched only when opened. */
function Timeline({ jobId }: { jobId: string }) {
  const { data, isLoading, error } = useSavedJob(jobId)
  if (isLoading) return <Skeleton className="h-16 w-full" />
  if (error) return <p className="text-xs text-red-700">Could not load the timeline.</p>
  if (!data?.events.length) return <p className="text-xs text-muted-foreground">No changes yet.</p>
  return (
    <ol className="space-y-1.5">
      {data.events.map((ev) => (
        <li key={ev.id} className="flex flex-wrap items-baseline gap-x-2 text-xs">
          <span className="text-muted-foreground tabular-nums">{new Date(ev.createdAt).toLocaleString()}</span>
          <span>
            {ev.fromStatus ? (
              <>
                {SAVED_JOB_STATUS_LABELS[ev.fromStatus]} → <strong>{SAVED_JOB_STATUS_LABELS[ev.toStatus]}</strong>
              </>
            ) : (
              <>
                Added as <strong>{SAVED_JOB_STATUS_LABELS[ev.toStatus]}</strong>
              </>
            )}
          </span>
          {ev.note ? <span className="text-muted-foreground">— {ev.note}</span> : null}
        </li>
      ))}
    </ol>
  )
}

interface JobCardProps {
  job: SavedJob
  onEdit: (job: SavedJob) => void
}

/**
 * One tracked job. Status is a native <select> rather than drag-and-drop: it
 * works one-handed on a phone, needs no library, and every change still lands
 * in job_events through the same endpoint a kanban would call.
 */
export function JobCard({ job, onEdit }: JobCardProps) {
  const [showTimeline, setShowTimeline] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const changeStatus = useChangeSavedJobStatus(job.id)
  const remove = useDeleteSavedJob()

  const today = todayLocalDay()
  const open = job.status !== 'offer' && job.status !== 'rejected'
  const followUpDue = open && Boolean(job.nextFollowUpAt && job.nextFollowUpAt <= today)
  const deadlineSoon = open && Boolean(job.deadlineAt && job.deadlineAt <= today)

  const handleStatus = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const next = e.target.value as SavedJobStatus
    setError(null)
    try {
      await changeStatus.mutateAsync({ status: next })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change the status.')
    }
  }

  const handleDelete = async () => {
    setError(null)
    try {
      await remove.mutateAsync(job.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the job.')
    } finally {
      setConfirmDelete(false)
    }
  }

  return (
    <article className="rounded-lg border bg-background p-4 shadow-xs">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-primary">{job.title}</h3>
            <JobStatusBadge status={job.status} />
          </div>
          <p className="mt-0.5 text-sm text-foreground">
            {job.companyName ?? <span className="text-muted-foreground">Company not set</span>}
            {job.salaryText ? <span className="text-muted-foreground"> · {job.salaryText}</span> : null}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {job.location ? (
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-3 w-3" />
                {job.location}
              </span>
            ) : null}
            {job.jobUrl ? (
              <a
                href={job.jobUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                <ExternalLink className="h-3 w-3" />
                {hostOf(job.jobUrl)}
              </a>
            ) : null}
            <span>{SOURCE_LABEL[job.source]}</span>
            {job.sponsorVisa === true ? <span className="text-green-700">Visa sponsor</span> : null}
            {job.sponsorVisa === false ? <span>No sponsorship</span> : null}
          </div>
        </div>

        <label className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
          <span className="sr-only sm:not-sr-only">Status</span>
          <select
            value={job.status}
            onChange={handleStatus}
            disabled={changeStatus.isPending}
            aria-label={`Status for ${job.title}`}
            className={`h-9 rounded-md border px-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-ring ${STATUS_TONE[job.status]}`}
          >
            {SAVED_JOB_STATUSES.map((s) => (
              <option key={s} value={s}>
                {SAVED_JOB_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {(job.deadlineAt || job.nextFollowUpAt || job.appliedAt) && (
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {job.appliedAt ? (
            <span className="text-muted-foreground">Applied {new Date(job.appliedAt).toLocaleDateString()}</span>
          ) : null}
          {job.deadlineAt ? (
            <span className={deadlineSoon ? 'font-medium text-red-700' : 'text-muted-foreground'}>
              Deadline {formatDay(job.deadlineAt)}
            </span>
          ) : null}
          {job.nextFollowUpAt ? (
            <span
              className={`inline-flex items-center gap-1 ${followUpDue ? 'font-medium text-orange-700' : 'text-muted-foreground'}`}
            >
              <CalendarClock className="h-3 w-3" />
              Follow up {formatDay(job.nextFollowUpAt)}
              {followUpDue ? ' · due' : ''}
            </span>
          ) : null}
        </div>
      )}

      {job.notes ? <p className="mt-3 whitespace-pre-wrap text-sm text-foreground">{job.notes}</p> : null}

      {job.coverLetterText ? <CoverLetterPanel text={job.coverLetterText} /> : null}

      {error ? (
        <p role="alert" className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-1 border-t border-border pt-3">
        {open ? (
          <Button variant="outline" size="sm" asChild>
            <Link href={`/jobs/${job.id}/apply`}>
              <ClipboardList className="h-3.5 w-3.5" />
              Prepare application
            </Link>
          </Button>
        ) : null}
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/cover-letter?savedJob=${job.id}`}>
            <FileSignature className="h-3.5 w-3.5" />
            Cover letter
          </Link>
        </Button>
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/?view=interview&savedJob=${job.id}`}>
            <Brain className="h-3.5 w-3.5" />
            Interview prep
          </Link>
        </Button>
        <Button variant="ghost" size="sm" onClick={() => onEdit(job)}>
          <Pencil className="h-3.5 w-3.5" />
          Edit
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setShowTimeline((v) => !v)} aria-expanded={showTimeline}>
          <History className="h-3.5 w-3.5" />
          {showTimeline ? 'Hide timeline' : 'Timeline'}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto text-red-700 hover:bg-red-50 hover:text-red-800"
          onClick={() => setConfirmDelete(true)}
          disabled={remove.isPending}
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete
        </Button>
      </div>

      {showTimeline ? (
        <div className="mt-3 rounded-md bg-card p-3">
          <Timeline jobId={job.id} />
        </div>
      ) : null}

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this job?</AlertDialogTitle>
            <AlertDialogDescription>
              “{job.title}”{job.companyName ? ` at ${job.companyName}` : ''} and its timeline will be removed. This
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-red-600 hover:bg-red-700">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </article>
  )
}


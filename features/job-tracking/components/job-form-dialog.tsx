'use client'

import { useEffect, useState } from 'react'
import type {
  CreateSavedJobRequest,
  SavedJob,
  UpdateSavedJobRequest,
} from '@advance-academy/contracts/job-tracking'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { HttpClientError } from '@/shared/api/http-client'
import { useCreateSavedJob, useUpdateSavedJob } from '../hooks/use-job-tracking'

/** Values a caller can pre-fill (deep link from Career Hub, or the Save button). */
export interface JobFormPrefill {
  title?: string
  companyName?: string
  jobUrl?: string
  location?: string
}

interface FormState {
  title: string
  companyName: string
  location: string
  jobUrl: string
  salaryText: string
  deadlineAt: string
  nextFollowUpAt: string
  appliedAt: string
  notes: string
}

const EMPTY: FormState = {
  title: '',
  companyName: '',
  location: '',
  jobUrl: '',
  salaryText: '',
  deadlineAt: '',
  nextFollowUpAt: '',
  appliedAt: '',
  notes: '',
}

/** `YYYY-MM-DD` for a date input from an ISO instant, or '' when unset. */
function dayOf(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

function fromJob(job: SavedJob): FormState {
  return {
    title: job.title,
    companyName: job.companyName ?? '',
    location: job.location ?? '',
    jobUrl: job.jobUrl ?? '',
    salaryText: job.salaryText ?? '',
    deadlineAt: job.deadlineAt ?? '',
    nextFollowUpAt: job.nextFollowUpAt ?? '',
    appliedAt: dayOf(job.appliedAt),
    notes: job.notes ?? '',
  }
}

function fromPrefill(prefill: JobFormPrefill | undefined): FormState {
  return {
    ...EMPTY,
    title: prefill?.title ?? '',
    companyName: prefill?.companyName ?? '',
    jobUrl: prefill?.jobUrl ?? '',
    location: prefill?.location ?? '',
  }
}

/** Empty string → null so the backend clears the column rather than storing ''. */
const orNull = (v: string) => (v.trim() ? v.trim() : null)

interface JobFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Editing an existing card; omit to create a new one. */
  job?: SavedJob
  prefill?: JobFormPrefill
  /** Called with the saved card, after the list has been refreshed. */
  onSaved?: (job: SavedJob) => void
}

/**
 * Add / edit form for one card. Native date inputs on purpose: they give a
 * proper picker on phones for free, and the tracker has to work at 400px.
 * No LLM anywhere in here — pasting a URL stores the URL, nothing is fetched.
 */
export function JobFormDialog({ open, onOpenChange, job, prefill, onSaved }: JobFormDialogProps) {
  const isEdit = Boolean(job)
  const [form, setForm] = useState<FormState>(job ? fromJob(job) : fromPrefill(prefill))
  const [error, setError] = useState<string | null>(null)

  const create = useCreateSavedJob()
  const update = useUpdateSavedJob(job?.id ?? '')
  const pending = create.isPending || update.isPending

  // Reset whenever the dialog is (re)opened for a different card or prefill.
  useEffect(() => {
    if (open) {
      setForm(job ? fromJob(job) : fromPrefill(prefill))
      setError(null)
    }
  }, [open, job, prefill])

  const set = (key: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!form.title.trim()) {
      setError('A job title is required.')
      return
    }
    try {
      if (job) {
        const patch: UpdateSavedJobRequest = {
          title: form.title.trim(),
          companyName: orNull(form.companyName),
          location: orNull(form.location),
          jobUrl: orNull(form.jobUrl),
          salaryText: orNull(form.salaryText),
          deadlineAt: orNull(form.deadlineAt),
          nextFollowUpAt: orNull(form.nextFollowUpAt),
          appliedAt: form.appliedAt ? new Date(`${form.appliedAt}T12:00:00`).toISOString() : null,
          notes: orNull(form.notes),
        }
        const res = await update.mutateAsync(patch)
        onSaved?.(res.job)
      } else {
        const body: CreateSavedJobRequest = {
          title: form.title.trim(),
          companyName: orNull(form.companyName),
          location: orNull(form.location),
          jobUrl: orNull(form.jobUrl),
          salaryText: orNull(form.salaryText),
          deadlineAt: orNull(form.deadlineAt),
          notes: orNull(form.notes),
          source: 'manual',
        }
        const res = await create.mutateAsync(body)
        onSaved?.(res.job)
      }
      onOpenChange(false)
    } catch (err) {
      if (err instanceof HttpClientError && err.status === 409) {
        setError('This link is already in your tracker.')
      } else {
        setError(err instanceof Error ? err.message : 'Could not save the job.')
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit job' : 'Add a job'}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Update the details, dates and notes on this card.'
              : 'Paste the link and fill in what you know. You can edit everything later.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="job-title">Job title *</Label>
            <Input id="job-title" value={form.title} onChange={set('title')} maxLength={200} required autoFocus />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="job-company">Company</Label>
              <Input id="job-company" value={form.companyName} onChange={set('companyName')} maxLength={200} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="job-location">Location</Label>
              <Input id="job-location" value={form.location} onChange={set('location')} maxLength={200} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="job-url">Job link</Label>
            <Input
              id="job-url"
              type="url"
              inputMode="url"
              placeholder="https://…"
              value={form.jobUrl}
              onChange={set('jobUrl')}
              maxLength={2000}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="job-salary">Salary</Label>
              <Input id="job-salary" placeholder="£40k–£55k" value={form.salaryText} onChange={set('salaryText')} maxLength={100} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="job-deadline">Deadline</Label>
              <Input id="job-deadline" type="date" value={form.deadlineAt} onChange={set('deadlineAt')} />
            </div>
          </div>

          {isEdit ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="job-follow-up">Next follow-up</Label>
                <Input id="job-follow-up" type="date" value={form.nextFollowUpAt} onChange={set('nextFollowUpAt')} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="job-applied">Applied on</Label>
                <Input id="job-applied" type="date" value={form.appliedAt} onChange={set('appliedAt')} />
              </div>
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="job-notes">Notes</Label>
            <Textarea id="job-notes" rows={3} value={form.notes} onChange={set('notes')} maxLength={5000} />
          </div>

          {error ? (
            <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Saving…' : isEdit ? 'Save changes' : 'Add job'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

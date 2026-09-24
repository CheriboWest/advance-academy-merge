'use client'

import { SAVED_JOB_STATUS_LABELS, type SavedJobStatus } from '@advance-academy/contracts/job-tracking'

/** One colour per stage so a mixed list scans without reading every label. */
export const STATUS_TONE: Record<SavedJobStatus, string> = {
  saved: 'bg-card text-foreground',
  preparing: 'bg-yellow-50 text-yellow-800 border-yellow-200',
  applied: 'bg-blue-50 text-blue-800 border-blue-200',
  follow_up: 'bg-orange-50 text-orange-800 border-orange-200',
  interview: 'bg-purple-50 text-purple-800 border-purple-200',
  offer: 'bg-green-50 text-green-800 border-green-200',
  rejected: 'bg-red-50 text-red-700 border-red-200',
}

export function JobStatusBadge({ status }: { status: SavedJobStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_TONE[status]}`}
    >
      {SAVED_JOB_STATUS_LABELS[status]}
    </span>
  )
}

'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Bookmark, BookmarkCheck, Loader2 } from 'lucide-react'
import type { CreateSavedJobRequest } from '@advance-academy/contracts/job-tracking'
import { Button } from '@/components/ui/button'
import { HttpClientError } from '@/shared/api/http-client'
import { useCreateSavedJob } from '../hooks/use-job-tracking'

type State = 'idle' | 'saved' | 'exists' | 'error'

interface SaveJobButtonProps {
  /** Everything the tool already knows about the listing. `title` is required. */
  job: CreateSavedJobRequest
  className?: string
}

/**
 * "Save" for any tool that shows a vacancy. One click writes a `saved` card;
 * a link already on the board comes back as 409 and the button says so instead
 * of creating a twin (AC7). No LLM, no credits.
 */
export function SaveJobButton({ job, className }: SaveJobButtonProps) {
  const [state, setState] = useState<State>('idle')
  const create = useCreateSavedJob()

  const handleClick = async (e: React.MouseEvent) => {
    // The button sits inside cards that are otherwise links.
    e.preventDefault()
    e.stopPropagation()
    if (state === 'saved' || state === 'exists') return
    try {
      await create.mutateAsync(job)
      setState('saved')
    } catch (err) {
      setState(err instanceof HttpClientError && err.status === 409 ? 'exists' : 'error')
    }
  }

  if (state === 'saved' || state === 'exists') {
    return (
      <Link
        href="/jobs"
        onClick={(e) => e.stopPropagation()}
        className={`inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-green-700 hover:underline ${className ?? ''}`}
        title="Open your job tracker"
      >
        <BookmarkCheck className="h-3.5 w-3.5" />
        {state === 'saved' ? 'Saved' : 'Already saved'}
      </Link>
    )
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={handleClick}
      disabled={create.isPending}
      className={className}
      title={state === 'error' ? 'Could not save — try again' : 'Save to my jobs'}
    >
      {create.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bookmark className="h-3.5 w-3.5" />}
      {state === 'error' ? 'Retry' : 'Save'}
    </Button>
  )
}

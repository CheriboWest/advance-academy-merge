'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { GenerateCoverLetterRequest } from '@advance-academy/contracts/cover-letter'
import { generateCoverLetter } from '../api/frontend-client'

/** A letter written for a tracked job lands on its card, so the board refetches. */
export function useGenerateCoverLetter() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: GenerateCoverLetterRequest) => generateCoverLetter(body),
    onSuccess: (res) => {
      if (!res.savedJobId) return
      queryClient.invalidateQueries({ queryKey: ['saved-jobs'] })
      queryClient.invalidateQueries({ queryKey: ['saved-job', res.savedJobId] })
    },
    retry: false,
  })
}

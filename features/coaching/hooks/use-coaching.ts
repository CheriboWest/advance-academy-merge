'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createCoachingSession,
  getCoachingContext,
  getCoachingSessionDetail,
  listCoachingSessions,
  listSessionPractice,
  runCoachingAction,
  saveSessionNotes,
  updateCoachingPack,
  updateCoachingSession,
  type CoachingAction,
} from '../api/frontend-client'
import type {
  CreateCoachingSessionRequest,
  SaveSessionNotesRequest,
  UpdateCoachingPackRequest,
  UpdateCoachingSessionRequest,
} from '@advance-academy/contracts/coaching'

/**
 * What this student has that a coaching pack could be built from.
 *
 * Held for the session: the inventory only changes when they run another tool,
 * which cannot happen while they are filling in the booking form.
 */
export function useCoachingContext(enabled = true) {
  return useQuery({
    queryKey: ['coaching-context'],
    queryFn: () => getCoachingContext(),
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
  })
}

export function useCoachingSessions(scope?: 'all') {
  return useQuery({
    queryKey: ['coaching-sessions', scope ?? 'mine'],
    queryFn: () => listCoachingSessions(scope),
    // The coach's queue moves while they are looking at it — a pack finishing
    // generating is the whole reason they have the page open.
    refetchInterval: scope === 'all' ? 30_000 : false,
    retry: false,
  })
}

// ── Coach workspace (ticket T5) ─────────────────────────────────────────────

/**
 * One session for the console.
 *
 * Polls while the pipeline is running, and stops as soon as it settles. Four
 * Sonnet stages take minutes; without this the coach would sit on a stale
 * "generating…" until they thought to reload.
 */
export function useCoachingSession(id: string | null) {
  return useQuery({
    queryKey: ['coaching-session', id],
    queryFn: () => getCoachingSessionDetail(id!),
    enabled: Boolean(id),
    refetchInterval: (query) =>
      query.state.data?.session.status === 'generating' ? 10_000 : false,
    retry: false,
  })
}

function useSessionMutation<TVars, TData>(
  id: string,
  fn: (vars: TVars) => Promise<TData>,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['coaching-session', id] })
      queryClient.invalidateQueries({ queryKey: ['coaching-sessions'] })
    },
    retry: false,
  })
}

export function useUpdateCoachingSession(id: string) {
  return useSessionMutation(id, (body: UpdateCoachingSessionRequest) =>
    updateCoachingSession(id, body),
  )
}

export function useUpdateCoachingPack(id: string) {
  return useSessionMutation(id, (body: UpdateCoachingPackRequest) => updateCoachingPack(id, body))
}

/**
 * Mocks run against this pack (ticket T7).
 *
 * Read by both sides: the student sees whether they have practised, the coach
 * sees how it went before the session.
 */
export function useSessionPractice(id: string | null) {
  return useQuery({
    queryKey: ['coaching-practice', id],
    queryFn: () => listSessionPractice(id!),
    enabled: Boolean(id),
    retry: false,
  })
}

export function useSaveSessionNotes(id: string) {
  return useSessionMutation(id, (body: SaveSessionNotesRequest) => saveSessionNotes(id, body))
}

export function useCoachingAction(id: string) {
  return useSessionMutation(
    id,
    ({ action, payload }: { action: CoachingAction; payload?: Record<string, unknown> }) =>
      runCoachingAction<unknown>(id, action, payload ?? {}),
  )
}

export function useBookCoachingSession() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (body: CreateCoachingSessionRequest) => createCoachingSession(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['coaching-sessions'] })
      // Booking spends the coaching quota, and the header reads it from the
      // account summary — stale here means the student sees a session they no
      // longer have.
      queryClient.invalidateQueries({ queryKey: ['account-me'] })
    },
    // No retry: a booking is not idempotent, and a silent second attempt would
    // charge the student twice for one form submission.
    retry: false,
  })
}

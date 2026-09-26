'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getEngagement, updateEngagementSettings } from '../api/frontend-client'

const KEY = ['engagement'] as const

export function useEngagement() {
  return useQuery({ queryKey: KEY, queryFn: getEngagement, retry: false })
}

export function useSetEmailReminders() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (emailReminders: boolean) => updateEngagementSettings({ emailReminders }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY }),
    retry: false,
  })
}

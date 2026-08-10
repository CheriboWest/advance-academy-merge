'use client'

import { useQuery } from '@tanstack/react-query'
import { getAdminPerson } from '../api/frontend-client'

/**
 * The person behind the drawer.
 *
 * `id` is null while the drawer is closed, which disables the query — opening
 * the drawer is what triggers the fetch, so listing a hundred rows costs a
 * hundred nothing.
 */
export function useAdminPerson(id: string | null) {
  return useQuery({
    queryKey: ['admin-person', id],
    queryFn: () => getAdminPerson(id!),
    enabled: Boolean(id),
    retry: false, // 403/404 should surface immediately, not retry
  })
}

'use client'

import { useMemo, useState } from 'react'
import { useAdminUsers, useUpdateAdminUser } from '../hooks/use-admin-users'
import { HttpClientError } from '@/shared/api/http-client'
import type { AdminUserPatch, AdminUserRow } from '@/types/admin'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

const TIER_FILTERS = ['', 'trial', 'membership'] as const

const selectClass =
  'h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring'

/** Quick top-up buttons — the amounts an admin actually reaches for. */
const CREDIT_STEPS = [1, 5, 10] as const

function CreditControls({
  user,
  onPatch,
  busy,
}: {
  user: AdminUserRow
  onPatch: (patch: AdminUserPatch) => void
  busy: boolean
}) {
  return (
    <div className="flex items-center gap-1">
      <Button
        variant="outline"
        size="sm"
        className="h-7 px-2"
        disabled={busy || user.credit_balance === 0}
        onClick={() => onPatch({ creditDelta: -1 })}
        title="Remove one credit"
      >
        −1
      </Button>
      {CREDIT_STEPS.map((n) => (
        <Button
          key={n}
          variant="outline"
          size="sm"
          className="h-7 px-2"
          disabled={busy}
          onClick={() => onPatch({ creditDelta: n })}
          title={`Add ${n} credit${n === 1 ? '' : 's'}`}
        >
          +{n}
        </Button>
      ))}
    </div>
  )
}

export function UsersTable() {
  const [search, setSearch] = useState('')
  const [tier, setTier] = useState('')

  const filters = useMemo(
    () => ({ search: search.trim() || undefined, tier: tier || undefined }),
    [search, tier],
  )
  const { data, isLoading, isFetching, error, refetch } = useAdminUsers(filters)
  const update = useUpdateAdminUser()

  const rows = data?.users ?? []
  const forbidden = error instanceof HttpClientError && error.status === 403
  // Which row is mid-request — used to disable just that row's buttons.
  const pendingId = update.isPending ? update.variables?.userId : undefined

  const patch = (userId: string, p: AdminUserPatch) => update.mutate({ userId, patch: p })

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Email
          <input
            className={selectClass}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="search by email"
          />
        </label>

        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Tier
          <select className={selectClass} value={tier} onChange={(e) => setTier(e.target.value)}>
            {TIER_FILTERS.map((t) => (
              <option key={t} value={t}>
                {t === '' ? 'All tiers' : t}
              </option>
            ))}
          </select>
        </label>

        <div className="ml-auto">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? 'Refreshing…' : 'Refresh'}
          </Button>
        </div>
      </div>

      {update.error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {(update.error as Error).message}
        </div>
      ) : null}

      {/* States */}
      {forbidden ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-6 text-sm text-destructive">
          You don&apos;t have admin access. Ask an administrator to switch on{' '}
          <code>is_admin</code> for your account, or add your user id to{' '}
          <code>ADMIN_USER_IDS</code>.
        </div>
      ) : error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-6 text-sm text-destructive">
          Failed to load users: {(error as Error).message}
        </div>
      ) : isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {rows.length} account{rows.length === 1 ? '' : 's'}
            {isFetching ? ' · updating…' : ''}
          </p>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Tier</TableHead>
                  <TableHead className="text-right">Credits</TableHead>
                  <TableHead>Adjust</TableHead>
                  <TableHead className="text-center">Referrals</TableHead>
                  <TableHead className="text-center">Used a tool</TableHead>
                  <TableHead>Joined</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                      No accounts match these filters.
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((u) => {
                    const busy = pendingId === u.id
                    return (
                      <TableRow key={u.id} className={busy ? 'opacity-60' : undefined}>
                        <TableCell className="font-medium">
                          {u.email ?? '—'}
                          {u.is_admin ? (
                            <Badge variant="destructive" className="ml-2">
                              admin
                            </Badge>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          <Badge variant={u.tier === 'membership' ? 'default' : 'secondary'}>
                            {u.tier}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {u.is_admin ? '∞' : u.credit_balance}
                        </TableCell>
                        <TableCell>
                          <CreditControls
                            user={u}
                            busy={busy}
                            onPatch={(p) => patch(u.id, p)}
                          />
                        </TableCell>
                        <TableCell className="text-center tabular-nums">
                          {u.referral_count}
                        </TableCell>
                        <TableCell className="text-center">
                          {u.first_tool_used_at ? '✓' : '—'}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {new Date(u.created_at).toLocaleDateString()}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            {u.tier === 'trial' ? (
                              <Button
                                size="sm"
                                disabled={busy}
                                onClick={() => patch(u.id, { tier: 'membership' })}
                              >
                                Upgrade
                              </Button>
                            ) : (
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={busy}
                                onClick={() => patch(u.id, { tier: 'trial' })}
                              >
                                Downgrade
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={busy}
                              onClick={() => patch(u.id, { isAdmin: !u.is_admin })}
                            >
                              {u.is_admin ? 'Revoke admin' : 'Make admin'}
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  )
}

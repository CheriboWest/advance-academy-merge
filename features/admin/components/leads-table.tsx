'use client'

import { useMemo, useState } from 'react'
import { useLeads } from '../hooks/use-leads'
import { HttpClientError } from '@/shared/api/http-client'
import type { LeadRow } from '@/types/leads'
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

const SOURCES = ['', 'quiz'] as const
const STATUSES = ['', 'new', 'confirmed', 'unsub'] as const

const CSV_COLUMNS: (keyof LeadRow)[] = [
  'id',
  'email',
  'name',
  'source',
  'utm_source',
  'readiness_score',
  'consent_marketing',
  'double_optin',
  'status',
  'created_at',
]

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function toCsv(rows: LeadRow[]): string {
  const header = CSV_COLUMNS.join(',')
  const lines = rows.map((r) => CSV_COLUMNS.map((c) => csvCell(r[c])).join(','))
  return [header, ...lines].join('\n')
}

function downloadCsv(rows: LeadRow[]) {
  const blob = new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'candidate_leads.csv'
  a.click()
  URL.revokeObjectURL(url)
}

function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'confirmed') return 'default'
  if (status === 'unsub') return 'destructive'
  return 'secondary'
}

const selectClass =
  'h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring'

export function LeadsTable() {
  const [source, setSource] = useState('')
  const [status, setStatus] = useState('')
  const [channel, setChannel] = useState('')

  const filters = useMemo(
    () => ({
      source: source || undefined,
      status: status || undefined,
      utmSource: channel.trim() || undefined,
    }),
    [source, status, channel],
  )
  const { data, isLoading, isFetching, error, refetch } = useLeads(filters)

  const rows = data?.leads ?? []
  const forbidden = error instanceof HttpClientError && error.status === 403

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Source
          <select
            className={selectClass}
            value={source}
            onChange={(e) => setSource(e.target.value)}
          >
            {SOURCES.map((s) => (
              <option key={s} value={s}>
                {s === '' ? 'All sources' : s}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Status
          <select
            className={selectClass}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s === '' ? 'All statuses' : s}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Channel (utm_source)
          <input
            className={selectClass}
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
            placeholder="e.g. fb_group"
          />
        </label>

        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? 'Refreshing…' : 'Refresh'}
          </Button>
          <Button
            size="sm"
            onClick={() => downloadCsv(rows)}
            disabled={rows.length === 0}
          >
            Download CSV
          </Button>
        </div>
      </div>

      {/* States */}
      {forbidden ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-6 text-sm text-destructive">
          You don&apos;t have admin access to view leads. Ask an administrator to add your
          account to <code>ADMIN_USER_IDS</code>.
        </div>
      ) : error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-6 text-sm text-destructive">
          Failed to load leads: {(error as Error).message}
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
            {rows.length} lead{rows.length === 1 ? '' : 's'}
            {isFetching ? ' · updating…' : ''}
          </p>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-center">Consent</TableHead>
                  <TableHead className="text-center">Confirmed</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                      No leads match these filters yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{r.email}</TableCell>
                      <TableCell>{r.name ?? '—'}</TableCell>
                      <TableCell>{r.source}</TableCell>
                      <TableCell>{r.utm_source ?? '—'}</TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(r.status)}>{r.status}</Badge>
                      </TableCell>
                      <TableCell className="text-center">{r.consent_marketing ? '✓' : '—'}</TableCell>
                      <TableCell className="text-center">{r.double_optin ? '✓' : '—'}</TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {new Date(r.created_at).toLocaleString()}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  )
}

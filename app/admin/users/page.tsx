'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { AdminUser, UserStatus } from '@advance-academy/contracts'
import { useAuth } from '@/features/auth/context/AuthContext'
import { authedFetch } from '@/shared/auth/authed-fetch'

const TABS: Array<{ value: UserStatus; label: string }> = [
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
]

export default function AdminUsersPage() {
  const { account, loading: authLoading } = useAuth()
  const [tab, setTab] = useState<UserStatus>('pending')
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    authedFetch(`/api/admin/users?status=${tab}`)
      .then(async (res) => {
        const body = await res.json()
        if (cancelled) return
        if (!res.ok) throw new Error(body?.message ?? 'Could not load users.')
        setUsers(body as AdminUser[])
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load users.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [tab])

  async function review(userId: string, status: 'approved' | 'rejected') {
    setBusyId(userId)
    setError(null)
    try {
      const res = await authedFetch(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.message ?? 'Could not update the account.')
      setUsers((prev) => prev.filter((u) => u.id !== userId))
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not update the account.')
    } finally {
      setBusyId(null)
    }
  }

  if (authLoading) return null

  if (!account?.isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-8 text-center">
          <h1 className="text-xl font-serif font-bold text-blue-900 mb-2">Admins only</h1>
          <p className="text-sm text-gray-500 mb-6">You don&apos;t have access to this page.</p>
          <Link href="/" className="text-sm font-semibold text-blue-900 hover:text-yellow-600 transition-colors">
            Back to the tools
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-10">
      <div className="mx-auto w-full max-w-4xl">
        <div className="mb-6">
          <h1 className="text-2xl font-serif font-bold text-blue-900">Account approvals</h1>
          <p className="mt-1 text-sm text-gray-500">
            New sign-ups can&apos;t use any tool until they&apos;re approved here.
          </p>
        </div>

        <div className="mb-4 flex gap-2">
          {TABS.map((t) => (
            <button
              key={t.value}
              onClick={() => setTab(t.value)}
              className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
                tab === t.value
                  ? 'bg-blue-900 text-white'
                  : 'bg-white text-blue-900 hover:bg-gray-100 border border-gray-200'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {error && <p className="mb-4 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

        <div className="bg-white rounded-2xl shadow-xl overflow-hidden">
          {loading ? (
            <p className="p-8 text-center text-sm text-gray-500">Loading…</p>
          ) : users.length === 0 ? (
            <p className="p-8 text-center text-sm text-gray-500">
              {tab === 'pending' ? 'Nothing waiting for review.' : `No ${tab} accounts.`}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Email</th>
                    <th className="px-4 py-3 font-medium">Signed up</th>
                    {tab === 'pending' && <th className="px-4 py-3 font-medium text-right">Action</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {users.map((u) => (
                    <tr key={u.id}>
                      <td className="px-4 py-3">
                        <span className="font-medium text-blue-900">{u.email}</span>
                        {u.full_name && <span className="block text-xs text-gray-500">{u.full_name}</span>}
                      </td>
                      <td className="px-4 py-3 text-gray-500">
                        {new Date(u.created_at).toLocaleDateString('en-GB', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </td>
                      {tab === 'pending' && (
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-2">
                            <button
                              disabled={busyId === u.id}
                              onClick={() => void review(u.id, 'approved')}
                              className="rounded-lg bg-yellow-500 px-3 py-1.5 text-xs font-semibold text-blue-900 hover:bg-yellow-400 disabled:opacity-50 transition"
                            >
                              Approve
                            </button>
                            <button
                              disabled={busyId === u.id}
                              onClick={() => void review(u.id, 'rejected')}
                              className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition"
                            >
                              Reject
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <p className="mt-6 text-center">
          <Link href="/" className="text-sm font-semibold text-blue-900 hover:text-yellow-600 transition-colors">
            Back to the tools
          </Link>
        </p>
      </div>
    </div>
  )
}

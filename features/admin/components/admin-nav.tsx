'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ArrowLeft, Shield } from 'lucide-react'

const TABS = [
  { href: '/admin/coaching', label: 'Coaching', hint: 'Booked sessions and their prep packs' },
  { href: '/admin/users', label: 'Users', hint: 'Accounts, tiers and credits' },
  { href: '/admin/leads', label: 'Leads', hint: 'Emails captured before signup' },
] as const

/**
 * Shared header for every /admin page: a way back into the app, and tabs between
 * the admin screens. Rendered from app/admin/layout.tsx so a new admin page
 * picks it up for free.
 */
export function AdminNav() {
  const pathname = usePathname()

  return (
    <div className="mb-8 border-b">
      <div className="mb-4 flex items-center justify-between">
        <span className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Shield className="h-4 w-4" />
          Admin
        </span>
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to app
        </Link>
      </div>

      <nav className="flex gap-1">
        {TABS.map((tab) => {
          // Prefix match so a detail page (/admin/coaching/<id>) keeps its tab lit.
          const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`)
          return (
            <Link
              key={tab.href}
              href={tab.href}
              title={tab.hint}
              aria-current={active ? 'page' : undefined}
              className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
                active
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {tab.label}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}

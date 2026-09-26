'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Bookmark,
  Building2,
  ChevronDown,
  Coins,
  History,
  LogOut,
  Menu,
  Search,
  Shield,
  Target,
  X,
} from 'lucide-react'
import type { NavItem, ViewName } from '@/shared/types/navigation'
import { TOOL_GROUPS, findToolItem } from '@/shared/config/navigation'
import { useAuth } from '@/features/auth/context/AuthContext'
import { useAccount } from '@/shared/hooks/use-account'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

interface NavigationProps {
  currentView: ViewName
  onNavigate: (view: ViewName) => void
}

/*
 * One set of interaction classes for the whole bar. The previous version spelled
 * the hover out per element and landed on `hover:bg-card` — #F3F4F6 against
 * a white bar, a step so small it reads as nothing happening. The idle state
 * here moves both the background and the text colour on hover, which is what
 * makes a target feel live; `duration-150` keeps it immediate rather than a
 * fade the eye reads as lag.
 */
const NAV_BASE =
  'inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-150'
const NAV_IDLE = 'text-muted-foreground hover:bg-primary/10 hover:text-primary'
const NAV_ACTIVE = 'bg-primary text-primary-foreground hover:bg-primary/90'

/** Wallet balance pill. Admins spend nothing, so they see ∞ rather than a number. */
function CreditPill({ credits, isAdmin }: { credits: number; isAdmin: boolean }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full bg-primary/5 px-3 py-1.5 text-sm font-medium text-primary"
      title={isAdmin ? 'Admins are not charged credits' : 'Credits left'}
    >
      <Coins className="h-4 w-4 text-highlight-ink" />
      {isAdmin ? '∞' : credits}
    </span>
  )
}

/**
 * The six tools behind one trigger.
 *
 * They used to sit in the bar as six more text links, which — with Home,
 * History, Admin, the credit pill and Sign out alongside — overflowed the
 * 1280px container on every laptop screen and gave the bar no shape at all.
 * Grouping them costs one click and buys a labelled, described menu; the
 * trigger carries the active tool's name so "where am I" is still answered
 * without opening anything.
 */
function ToolsMenu({
  currentView,
  onNavigate,
}: {
  currentView: ViewName
  onNavigate: (view: ViewName) => void
}) {
  const active = findToolItem(currentView)
  const TriggerIcon = active?.icon

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={`${NAV_BASE} ${active ? NAV_ACTIVE : NAV_IDLE} cursor-pointer data-[state=open]:bg-primary/10 data-[state=open]:text-primary`}
      >
        {TriggerIcon ? <TriggerIcon className="h-4 w-4" /> : null}
        {active ? active.label : 'Tools'}
        <ChevronDown className="h-4 w-4 opacity-60" />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-80">
        {TOOL_GROUPS.map((group, index) => (
          <DropdownMenuGroup key={group.label}>
            {index > 0 ? <DropdownMenuSeparator /> : null}
            <DropdownMenuLabel className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {group.label}
            </DropdownMenuLabel>
            {group.items.map((item) => (
              <ToolMenuItem
                key={item.view}
                item={item}
                active={item.view === currentView}
                onSelect={() => onNavigate(item.view)}
              />
            ))}
          </DropdownMenuGroup>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function ToolMenuItem({
  item,
  active,
  onSelect,
}: {
  item: NavItem
  active: boolean
  onSelect: () => void
}) {
  const Icon = item.icon
  return (
    <DropdownMenuItem
      onSelect={onSelect}
      // shadcn's menu items ship `cursor-default`; in a menu of navigation
      // targets that is the same dead-feeling affordance the bar had.
      className="cursor-pointer items-start gap-3 py-2.5"
    >
      <span
        className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
          active ? 'bg-primary text-primary-foreground' : 'bg-secondary/15 text-primary'
        }`}
      >
        <Icon className="h-4 w-4" />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="text-sm font-medium text-primary">{item.label}</span>
        <span className="text-xs leading-snug text-muted-foreground whitespace-normal">
          {item.description}
        </span>
      </span>
    </DropdownMenuItem>
  )
}

export function Navigation({ currentView, onNavigate }: NavigationProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const { signOut } = useAuth()
  const router = useRouter()
  // Undefined while loading or signed out — render nothing rather than a
  // flash of "0 credits" or an Admin link the user can't actually open.
  const { data: account } = useAccount()

  const handleNavigate = (view: ViewName) => {
    setMobileMenuOpen(false)
    // Tools on their own route (Job Search, Job Tracker, Cover Letter) are
    // routed here so no page's `onNavigate` has to know about them.
    const href = findToolItem(view)?.href
    if (href) return router.push(href)
    onNavigate(view)
  }

  const handleSignOut = async () => {
    setMobileMenuOpen(false)
    await signOut()
    router.push('/login')
  }

  return (
    <nav className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center gap-3">
          <button
            onClick={() => handleNavigate('home')}
            className="flex shrink-0 items-center gap-2 rounded-lg px-1 py-1 transition-opacity duration-150 hover:opacity-80"
            aria-label="Advance Academy home"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary">
              <Target className="h-5 w-5 text-highlight-ink" />
            </span>
            <span className="font-serif text-xl font-semibold text-primary">Advance Academy</span>
          </button>

          {/* Desktop: tools behind one trigger, records next to them. */}
          <div className="ml-4 hidden items-center gap-1 md:flex">
            <ToolsMenu currentView={currentView} onNavigate={handleNavigate} />
            <button
              onClick={() => handleNavigate('history')}
              aria-current={currentView === 'history' ? 'page' : undefined}
              className={`${NAV_BASE} ${currentView === 'history' ? NAV_ACTIVE : NAV_IDLE}`}
            >
              <History className="h-4 w-4" />
              History
            </button>
            {/* A real route, not a `?view=`, so Career Hub can deep-link into it. */}
            <Link
              href="/jobs"
              aria-current={currentView === 'jobs' ? 'page' : undefined}
              className={`${NAV_BASE} ${currentView === 'jobs' ? NAV_ACTIVE : NAV_IDLE}`}
            >
              <Bookmark className="h-4 w-4" />
              Jobs
            </Link>
            {/* Career Hub's public employer directory. No `aria-current`: it
                renders its own page without this bar, so `currentView` never
                names it. */}
            <Link href="/search" className={`${NAV_BASE} ${NAV_IDLE}`}>
              <Search className="h-4 w-4" />
              Job Search
            </Link>
          </div>

          {/* Account cluster, pushed right and separated from the navigation. */}
          <div className="ml-auto hidden items-center gap-2 md:flex">
            {account ? <CreditPill credits={account.credits} isAdmin={account.isAdmin} /> : null}
            {/* One link, not the five coach pages — that workspace carries its
                own sidebar, and listing them here would be the same menu twice.
                Gated on `isAdmin` because coach and admin are one set. */}
            {account?.isAdmin ? (
              <Link href="/coach/dashboard" className={`${NAV_BASE} ${NAV_IDLE}`}>
                <Building2 className="h-4 w-4" />
                Coach
              </Link>
            ) : null}
            {account?.isAdmin ? (
              <Link href="/admin/users" className={`${NAV_BASE} ${NAV_IDLE}`}>
                <Shield className="h-4 w-4" />
                Admin
              </Link>
            ) : null}
            <span className="mx-1 h-6 w-px bg-muted" aria-hidden="true" />
            <button onClick={handleSignOut} className={`${NAV_BASE} ${NAV_IDLE}`}>
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </div>

          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="ml-auto rounded-lg p-2 text-muted-foreground transition-colors duration-150 hover:bg-primary/10 hover:text-primary md:hidden"
            aria-expanded={mobileMenuOpen}
            aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
          >
            {mobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </div>

        {/* Mobile: the same taxonomy, opened out — no room to hide it behind a
            second layer of menu, and no hover to rely on either. */}
        {mobileMenuOpen && (
          <div className="flex flex-col gap-1 pb-4 md:hidden">
            {TOOL_GROUPS.map((group) => (
              <div key={group.label} className="mt-2 first:mt-0">
                <p className="px-3 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {group.label}
                </p>
                {group.items.map((item) => {
                  const Icon = item.icon
                  return (
                    <button
                      key={item.view}
                      onClick={() => handleNavigate(item.view)}
                      aria-current={currentView === item.view ? 'page' : undefined}
                      className={`${NAV_BASE} w-full justify-start ${
                        currentView === item.view ? NAV_ACTIVE : NAV_IDLE
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                      {item.label}
                    </button>
                  )
                })}
              </div>
            ))}

            <div className="mt-3 border-t pt-3">
              <button
                onClick={() => handleNavigate('history')}
                aria-current={currentView === 'history' ? 'page' : undefined}
                className={`${NAV_BASE} w-full justify-start ${
                  currentView === 'history' ? NAV_ACTIVE : NAV_IDLE
                }`}
              >
                <History className="h-4 w-4" />
                History
              </button>
              <Link
                href="/jobs"
                onClick={() => setMobileMenuOpen(false)}
                aria-current={currentView === 'jobs' ? 'page' : undefined}
                className={`${NAV_BASE} w-full justify-start ${
                  currentView === 'jobs' ? NAV_ACTIVE : NAV_IDLE
                }`}
              >
                <Bookmark className="h-4 w-4" />
                Jobs
              </Link>
              <Link
                href="/search"
                onClick={() => setMobileMenuOpen(false)}
                className={`${NAV_BASE} w-full justify-start ${NAV_IDLE}`}
              >
                <Search className="h-4 w-4" />
                Job Search
              </Link>
              {account?.isAdmin ? (
                <Link
                  href="/coach/dashboard"
                  onClick={() => setMobileMenuOpen(false)}
                  className={`${NAV_BASE} w-full justify-start ${NAV_IDLE}`}
                >
                  <Building2 className="h-4 w-4" />
                  Coach
                </Link>
              ) : null}
              {account?.isAdmin ? (
                <Link
                  href="/admin/users"
                  onClick={() => setMobileMenuOpen(false)}
                  className={`${NAV_BASE} w-full justify-start ${NAV_IDLE}`}
                >
                  <Shield className="h-4 w-4" />
                  Admin
                </Link>
              ) : null}
              <button
                onClick={handleSignOut}
                className={`${NAV_BASE} w-full justify-start ${NAV_IDLE}`}
              >
                <LogOut className="h-4 w-4" />
                Sign out
              </button>
              {account ? (
                <div className="px-3 py-2">
                  <CreditPill credits={account.credits} isAdmin={account.isAdmin} />
                </div>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </nav>
  )
}

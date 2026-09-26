import type { ReactNode } from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/shared/utils/cn'

// The one back link. It sits top-left, as the first thing in the page content.
// -ml-2.5 cancels the sm button's svg padding so the arrow lines up with the heading.
const BASE = '-ml-2.5 text-muted-foreground'

type BackLinkProps = { children: ReactNode; className?: string } & (
  | { href: string; onClick?: never }
  | { onClick: () => void; href?: never }
)

export function BackLink({ href, onClick, children, className }: BackLinkProps) {
  const inner = (
    <>
      <ArrowLeft className="size-4" />
      {children}
    </>
  )
  return href ? (
    <Button asChild variant="ghost" size="sm" className={cn(BASE, className)}>
      <Link href={href}>{inner}</Link>
    </Button>
  ) : (
    <Button type="button" onClick={onClick} variant="ghost" size="sm" className={cn(BASE, className)}>
      {inner}
    </Button>
  )
}

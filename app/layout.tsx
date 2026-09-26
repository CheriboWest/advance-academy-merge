import type { Metadata } from 'next'
import { preload } from 'react-dom'
import { Analytics } from '@vercel/analytics/next'
import { AppProviders } from '@/app/providers'
import './globals.css'

/*
 * Inter and Playfair Display are self-hosted — the @font-face rules at the top
 * of globals.css say why next/font/google had to go. Preload the latin files
 * every page renders, as next/font used to, so text doesn't flash in the
 * fallback face first.
 */
const LATIN_FONTS = ['/fonts/inter-latin.woff2', '/fonts/playfair-display-latin.woff2']

export const metadata: Metadata = {
  title: 'Advance Academy | Career Acceleration Platform',
  description: 'Accelerate your career with AI-powered tools for dream companies, recruitment outreach, CV optimization, and interview preparation.',
  generator: 'v0.app',
  icons: {
    icon: [
      {
        url: '/icon-light-32x32.png',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/icon-dark-32x32.png',
        media: '(prefers-color-scheme: dark)',
      },
      {
        url: '/icon.svg',
        type: 'image/svg+xml',
      },
    ],
    apple: '/apple-icon.png',
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  for (const href of LATIN_FONTS) preload(href, { as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' })
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="font-sans antialiased">
        <AppProviders>{children}</AppProviders>
        <Analytics />
      </body>
    </html>
  )
}

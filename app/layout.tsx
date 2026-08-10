import type { Metadata } from 'next'
import { Playfair_Display, Inter } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import { AppProviders } from '@/app/providers'
import './globals.css'

/*
 * Both fonts expose a CSS variable and both variables are put on <body> below,
 * because `--font-sans` / `--font-serif` in globals.css resolve through them.
 * The serif previously had no variable at all and globals.css named the family
 * literally ("Playfair Display") — that happens to match what next/font emits
 * today, but it is an implementation detail of the loader, not a contract, and
 * it silently degrades every heading to Times if it ever changes.
 */
const playfair = Playfair_Display({
  subsets: ['latin'],
  weight: ['400', '600', '700'],
  variable: '--font-playfair',
})
const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })

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
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} ${playfair.variable} ${inter.className} antialiased`}>
        <AppProviders>{children}</AppProviders>
        <Analytics />
      </body>
    </html>
  )
}

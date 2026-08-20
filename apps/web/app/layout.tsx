import type { Metadata } from "next";
import Link from "next/link";
import { Instrument_Serif, Inter_Tight } from "next/font/google";

import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { Navbar } from "@/components/navbar";
import { PageContainer } from "@/components/page-container";

const displaySerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  weight: "400",
  style: ["normal", "italic"],
  subsets: ["latin"],
});

const bodySans = Inter_Tight({
  variable: "--font-inter-tight",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "CareerHub UK — Which UK companies are hiring right now",
    template: "%s · CareerHub UK",
  },
  description:
    "Search UK companies and jobs, or manage outreach as a coach. A company and job discovery platform for students.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en-GB" suppressHydrationWarning>
      <body
        className={`${displaySerif.variable} ${bodySans.variable} min-h-dvh bg-background font-sans antialiased`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <div className="flex min-h-dvh flex-col">
            <Navbar />
            <main className="flex-1 pb-16">{children}</main>
            <footer className="border-t border-border">
              <PageContainer className="flex flex-col gap-2 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
                <p>© {new Date().getFullYear()} CareerHub UK</p>
                <div className="flex items-center gap-4">
                  <span>Built for students exploring UK employers.</span>
                  <Link
                    href="/coach/login"
                    className="underline decoration-border underline-offset-4 transition-colors hover:text-foreground hover:decoration-foreground"
                  >
                    Coach sign-in
                  </Link>
                </div>
              </PageContainer>
            </footer>
          </div>
        </ThemeProvider>
      </body>
    </html>
  );
}

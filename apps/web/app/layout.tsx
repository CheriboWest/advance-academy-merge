import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { Navbar } from "@/components/navbar";
import { PageContainer } from "@/components/page-container";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "CareerHub UK — Find UK employers faster",
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
        className={`${geistSans.variable} ${geistMono.variable} min-h-dvh bg-background font-sans antialiased`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <div className="flex min-h-dvh flex-col">
            <Navbar />
            <main className="flex-1 py-8 sm:py-12">{children}</main>
            <footer className="border-t border-border/60 py-8">
              <PageContainer className="flex flex-col items-center justify-between gap-2 text-sm text-muted-foreground sm:flex-row">
                <p>© {new Date().getFullYear()} CareerHub UK</p>
                <p>Built for students exploring UK employers.</p>
              </PageContainer>
            </footer>
          </div>
        </ThemeProvider>
      </body>
    </html>
  );
}

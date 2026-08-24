import type { Metadata } from "next";
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
    default: "Advance Academy: Which UK companies are hiring right now",
    template: "%s · Advance Academy",
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
          defaultTheme="light"
          disableTransitionOnChange
        >
          <div className="flex min-h-dvh flex-col">
            <Navbar />
            <main className="flex-1 pb-16">{children}</main>
            <footer className="mt-auto bg-primary text-primary-foreground">
              <PageContainer className="py-8 text-center text-sm">
                <p>© {new Date().getFullYear()} Advance Academy</p>
              </PageContainer>
            </footer>
          </div>
        </ThemeProvider>
      </body>
    </html>
  );
}
